import { z } from 'zod';
import { randomUUID } from 'node:crypto';

import { db } from '@/lib/db';
import type { AutopilotConfig } from '@/lib/types';
import { getAiModelRuntimeProvider } from '@/lib/ai-models';
import { evaluateFeatureFlag } from '@/lib/feature-flags/evaluate';
import { compileAutopilotFlowToWorkflow } from './autopilot-compat';
import { createDefaultNodeHandlerRegistry } from './node-handlers';
import { ModelFallbackChain, type GenerateRequest, type GenerateResult, type ModelAdapter, type ModelInfo, type ModelHealth, type ModelStreamEvent, type StructuredGenerateRequest } from './model-adapter';
import { PostgresWorkflowPersistence } from './postgres-persistence';
import { ToolRegistry } from './tools';
import type { ModelConfiguration, WorkflowDefinition, WorkflowExecution, WorkflowValidationResult } from './types';
import { WorkflowDefinitionSchema } from './schemas';
import { validateWorkflowDefinition } from './validator';
import { WorkflowExecutor } from './executor';

type Queryable = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }>;
};

type RolloutContext = {
  workspaceId?: string | null;
  userId?: string | null;
  requestId?: string | null;
};

type FeatureFlagStore = {
  defaults?: Record<string, unknown>;
  flags?: Record<string, Record<string, unknown>>;
};

export type WorkflowRuntimeV2RolloutMode =
  | 'shadow_compile'
  | 'shadow_execution'
  | 'canary_execution'
  | 'primary_execution';

type AutopilotWorkflowRuntimeV2Mode = 'off' | 'shadow' | 'primary' | null | undefined;

const FLAG_NAMES: Record<WorkflowRuntimeV2RolloutMode, string> = {
  shadow_compile: 'workflow_runtime_v2_shadow_compile',
  shadow_execution: 'workflow_runtime_v2_shadow_execution',
  canary_execution: 'workflow_runtime_v2_canary_execution',
  primary_execution: 'workflow_runtime_v2_primary_execution',
};

const ENV_NAMES: Record<WorkflowRuntimeV2RolloutMode, string> = {
  shadow_compile: 'WORKFLOW_RUNTIME_V2_SHADOW_COMPILE',
  shadow_execution: 'WORKFLOW_RUNTIME_V2_SHADOW_EXECUTION',
  canary_execution: 'WORKFLOW_RUNTIME_V2_CANARY_EXECUTION',
  primary_execution: 'WORKFLOW_RUNTIME_V2_PRIMARY_EXECUTION',
};

function asBoolean(value: string | undefined): boolean | null {
  if (value == null || value.trim() === '') return null;
  if (['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())) return true;
  if (['0', 'false', 'no', 'off'].includes(value.trim().toLowerCase())) return false;
  return null;
}

function parseSettingsValue(value: unknown): FeatureFlagStore | null {
  if (!value) return null;
  if (typeof value === 'object') return value as FeatureFlagStore;
  if (typeof value !== 'string') return null;
  try {
    return JSON.parse(value) as FeatureFlagStore;
  } catch {
    return null;
  }
}

async function loadFeatureFlags(database: Queryable = db): Promise<FeatureFlagStore | null> {
  try {
    const result = await database.query(
      'SELECT value FROM public.system_settings WHERE key = $1 LIMIT 1',
      ['feature_flags'],
    );
    return parseSettingsValue(result.rows[0]?.value);
  } catch (error) {
    console.warn('[WORKFLOW_RUNTIME_V2_ROLLOUT] Failed to load feature flags:', error);
    return null;
  }
}

export async function isWorkflowRuntimeV2ModeEnabled(
  mode: WorkflowRuntimeV2RolloutMode,
  context: RolloutContext = {},
  database: Queryable = db,
): Promise<boolean> {
  const envOverride = asBoolean(process.env[ENV_NAMES[mode]]);
  if (envOverride != null) return envOverride;

  const store = await loadFeatureFlags(database);
  const flagName = FLAG_NAMES[mode];
  const result = evaluateFeatureFlag(
    flagName,
    store?.flags?.[flagName],
    store?.defaults,
    {
      releaseChannel: process.env.APP_RELEASE_CHANNEL || 'stable',
      workspaceId: context.workspaceId || undefined,
      userId: context.userId || undefined,
      requestId: context.requestId || undefined,
    },
  );
  return result.enabled;
}

function configEnablesMode(
  configMode: AutopilotWorkflowRuntimeV2Mode,
  rolloutMode: WorkflowRuntimeV2RolloutMode,
) {
  if (configMode === 'primary') return true;
  if (configMode === 'shadow') {
    return rolloutMode === 'shadow_compile' || rolloutMode === 'shadow_execution';
  }
  return false;
}

function modelConfigurationFromAutopilot(config: Pick<AutopilotConfig, 'ai_model'>): ModelConfiguration {
  const model = config.ai_model || process.env.DEFAULT_AUTOPILOT_MODEL || 'gemini-2.0-flash';
  const provider = getAiModelRuntimeProvider(model);
  return {
    provider,
    model,
    temperature: 0.2,
    maxOutputTokens: 2048,
    supportsTools: true,
    supportsStructuredOutput: true,
    supportsStreaming: true,
    timeoutMs: 60_000,
    maxRetries: 2,
  };
}

export function compileAutopilotConfigForWorkflowRuntimeV2(input: {
  config: Pick<AutopilotConfig, 'id' | 'workspace_id' | 'name' | 'ai_model' | 'flow_graph' | 'workflow_runtime_v2_mode'>;
  version: string;
  status?: WorkflowDefinition['status'];
  metadata?: Record<string, unknown>;
}): {
  workflow: WorkflowDefinition | null;
  validation: WorkflowValidationResult | null;
  error?: string;
} {
  if (!input.config.flow_graph) {
    return { workflow: null, validation: null, error: 'flow_graph_missing' };
  }
  const workflow = compileAutopilotFlowToWorkflow({
    configId: input.config.id,
    workspaceId: input.config.workspace_id,
    name: input.config.name,
    graph: input.config.flow_graph,
    version: input.version,
    model: modelConfigurationFromAutopilot(input.config),
  });
  workflow.status = input.status || workflow.status;
  workflow.metadata = {
    ...(workflow.metadata || {}),
    ...(input.metadata || {}),
  };
  const validation = validateWorkflowDefinition(workflow);
  return { workflow, validation };
}

export async function shadowCompileAutopilotWorkflowRuntimeV2(input: {
  config: Pick<AutopilotConfig, 'id' | 'workspace_id' | 'name' | 'ai_model' | 'flow_graph' | 'workflow_runtime_v2_mode'>;
  version: string;
  userId?: string | null;
  database?: Queryable;
}): Promise<{
  enabled: boolean;
  saved: boolean;
  valid: boolean;
  workflowId?: string;
  workflowVersion?: string;
  error?: string;
  validation?: WorkflowValidationResult | null;
}> {
  const database = input.database || db;
  const enabled = configEnablesMode(input.config.workflow_runtime_v2_mode, 'shadow_compile')
    || await isWorkflowRuntimeV2ModeEnabled('shadow_compile', {
      workspaceId: input.config.workspace_id,
      userId: input.userId,
    }, database);
  if (!enabled) return { enabled: false, saved: false, valid: false };

  const compiled = compileAutopilotConfigForWorkflowRuntimeV2({
    config: input.config,
    version: input.version,
    status: 'published',
    metadata: {
      rolloutMode: 'shadow_compile',
      source: 'autopilot_publish',
    },
  });
  if (!compiled.workflow || !compiled.validation) {
    return {
      enabled: true,
      saved: false,
      valid: false,
      error: compiled.error || 'compile_failed',
      validation: compiled.validation,
    };
  }
  if (!compiled.validation.valid) {
    return {
      enabled: true,
      saved: false,
      valid: false,
      workflowId: compiled.workflow.id,
      workflowVersion: compiled.workflow.version,
      validation: compiled.validation,
      error: compiled.validation.errors.map((issue) => issue.message).join(' '),
    };
  }
  await new PostgresWorkflowPersistence(database as any).saveWorkflowDefinition(compiled.workflow);
  return {
    enabled: true,
    saved: true,
    valid: true,
    workflowId: compiled.workflow.id,
    workflowVersion: compiled.workflow.version,
    validation: compiled.validation,
  };
}

class ShadowModelAdapter implements ModelAdapter {
  async listModels(): Promise<ModelInfo[]> {
    return [{ id: 'workflow-runtime-v2-shadow-model' }];
  }

  async healthCheck(): Promise<ModelHealth> {
    return { ok: true, latencyMs: 0, models: ['workflow-runtime-v2-shadow-model'] };
  }

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    return {
      model: request.model,
      text: 'shadow_runtime_noop',
      toolRequests: [],
    };
  }

  async generateStructured<T>(request: StructuredGenerateRequest<T>): Promise<T> {
    const value = request.schemaName.startsWith('workflow_router_')
      ? { routeId: '__shadow_no_route__', confidence: 0 }
      : request.schemaName.startsWith('workflow_extract_')
        ? { output: {} }
        : {
            type: 'final',
            response: 'shadow_runtime_noop',
            completionStatus: 'completed',
            statePatch: { __workflowRuntimeV2Shadow: true },
          };
    return request.schema.parse(value);
  }

  async *stream(request: GenerateRequest): AsyncIterable<ModelStreamEvent> {
    yield { type: 'started', model: request.model };
    yield { type: 'completed', model: request.model };
  }

  async supportsTools(): Promise<boolean> {
    return false;
  }

  async supportsStructuredOutput(): Promise<boolean> {
    return true;
  }
}

export async function runAutopilotWorkflowRuntimeV2Shadow(input: {
  config: Pick<AutopilotConfig,
    | 'id' | 'workspace_id' | 'name' | 'ai_model' | 'flow_graph'
    | 'workflow_runtime_v2_mode' | 'workflow_builder_mode' | 'workflow_definition'
    | 'active_workflow_id' | 'active_workflow_version'>;
  customerMessage: string;
  chatId?: string | null;
  sourceMessageId?: string | null;
  userId?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<{
  enabled: boolean;
  status: 'disabled' | 'skipped' | 'completed' | 'waiting' | 'failed';
  executionId?: string;
  workflowId?: string;
  workflowVersion?: string;
  error?: string;
  externalSideEffects: number;
  simulatedResponses?: number;
  simulatedHandoffs?: number;
}> {
  const requestId = input.sourceMessageId || randomUUID();
  const enabled = configEnablesMode(input.config.workflow_runtime_v2_mode, 'shadow_execution')
    || await isWorkflowRuntimeV2ModeEnabled('shadow_execution', {
      workspaceId: input.config.workspace_id,
      userId: input.userId,
      requestId,
    });
  if (!enabled) return { enabled: false, status: 'disabled', externalSideEffects: 0 };

  const nativeDraft = input.config.workflow_builder_mode === 'native_v2'
    ? WorkflowDefinitionSchema.safeParse(input.config.workflow_definition)
    : null;
  const compiled = nativeDraft?.success
    ? (() => {
        const workflow = WorkflowDefinitionSchema.parse({
          ...nativeDraft.data,
          id: `shadow:${input.config.id}`,
          version: `shadow-${input.config.id}`,
          status: 'draft',
          metadata: {
            ...(nativeDraft.data.metadata || {}),
            rolloutMode: 'shadow_execution',
            source: 'autopilot_runtime',
            sourceMessageId: input.sourceMessageId || null,
            ...(input.metadata || {}),
          },
          updatedAt: new Date().toISOString(),
        });
        return { workflow, validation: validateWorkflowDefinition(workflow) };
      })()
    : compileAutopilotConfigForWorkflowRuntimeV2({
        config: input.config,
        version: `shadow-${input.config.id}`,
        status: 'draft',
        metadata: {
          rolloutMode: 'shadow_execution',
          source: 'autopilot_runtime',
          sourceMessageId: input.sourceMessageId || null,
          ...(input.metadata || {}),
        },
      });
  if (!compiled.workflow || !compiled.validation?.valid) {
    return {
      enabled: true,
      status: 'skipped',
      externalSideEffects: 0,
      error: ('error' in compiled ? compiled.error : undefined)
        || compiled.validation?.errors.map((issue) => issue.message).join(' ')
        || 'invalid_workflow',
    };
  }

  const persistence = new PostgresWorkflowPersistence(db);
  const modelConfig = modelConfigurationFromAutopilot(input.config);
  const shadowAdapter = new ShadowModelAdapter();
  let simulatedResponses = 0;
  let simulatedHandoffs = 0;
  const handlers = createDefaultNodeHandlerRegistry({
    resolveModelChain: async () => new ModelFallbackChain([{
      adapter: shadowAdapter,
      config: {
        ...modelConfig,
        provider: 'shadow',
        model: 'workflow-runtime-v2-shadow-model',
        supportsTools: false,
      },
    }]),
    resolveToolRegistry: async () => new ToolRegistry(() => false),
    retrieveKnowledge: async () => [],
    sendResponse: async (message) => {
      simulatedResponses += 1;
      return { shadow: true, simulated: true, message };
    },
    handoff: async () => {
      simulatedHandoffs += 1;
      return { shadow: true, simulated: true, handedOff: false };
    },
  });
  const executor = new WorkflowExecutor(persistence, handlers, {
    defaultNodeTimeoutMs: 5_000,
    lockLeaseMs: 15_000,
  });

  try {
    const execution = await executor.start({
      workflow: compiled.workflow,
      input: {
        customerMessage: input.customerMessage,
        message: input.customerMessage,
        text: input.customerMessage,
      },
      context: {
        shadow: true,
        source: 'autopilot_runtime',
        sourceMessageId: input.sourceMessageId || null,
        metadata: input.metadata || {},
      },
      sessionId: input.chatId || undefined,
      conversationId: input.chatId || undefined,
      executionId: `shadow_${input.config.id}_${requestId.replace(/[^a-zA-Z0-9_-]/g, '_')}`,
    }, {
      workerId: 'workflow-runtime-v2-shadow',
      maxSteps: 20,
    });
    return {
      enabled: true,
      status: execution.status === 'failed' ? 'failed' : execution.status === 'waiting' ? 'waiting' : 'completed',
      executionId: execution.executionId,
      workflowId: execution.workflowId,
      workflowVersion: execution.workflowVersion,
      error: execution.failure?.message,
      externalSideEffects: 0,
      simulatedResponses,
      simulatedHandoffs,
    };
  } catch (error) {
    console.warn('[WORKFLOW_RUNTIME_V2_SHADOW] Execution failed:', error);
    return {
      enabled: true,
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
      externalSideEffects: 0,
      simulatedResponses,
      simulatedHandoffs,
    };
  }
}

export async function recordWorkflowRuntimeV2ModelCapabilities(input: {
  provider: string;
  model: string;
  profile: {
    tools: boolean;
    structuredOutput: boolean;
    streaming: boolean;
    maxContextTokens?: number;
    maxOutputTokens?: number;
    latencyP50Ms?: number;
    latencyP95Ms?: number;
  };
  source?: string;
  database?: Queryable;
}) {
  const database = input.database || db;
  const now = new Date().toISOString();
  await database.query(
    `INSERT INTO workflow_model_capabilities (
       provider, model, tool_calling, structured_output, streaming,
       recommended_max_tools, recommended_context_size, evaluation_metadata,
       last_evaluated_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $9)
     ON CONFLICT (provider, model) DO UPDATE
     SET tool_calling = EXCLUDED.tool_calling,
         structured_output = EXCLUDED.structured_output,
         streaming = EXCLUDED.streaming,
         recommended_max_tools = EXCLUDED.recommended_max_tools,
         recommended_context_size = EXCLUDED.recommended_context_size,
         evaluation_metadata = EXCLUDED.evaluation_metadata,
         last_evaluated_at = EXCLUDED.last_evaluated_at,
         updated_at = EXCLUDED.updated_at`,
    [
      input.provider,
      input.model,
      input.profile.tools ? 'supported' : 'unsupported',
      input.profile.structuredOutput,
      input.profile.streaming,
      input.profile.tools ? 20 : 0,
      input.profile.maxContextTokens ?? 32_768,
      JSON.stringify({
        maxOutputTokens: input.profile.maxOutputTokens ?? null,
        latencyP50Ms: input.profile.latencyP50Ms ?? null,
        latencyP95Ms: input.profile.latencyP95Ms ?? null,
        source: input.source || 'runtime_v2_rollout',
      }),
      now,
    ],
  );
}

export const WorkflowRuntimeV2FlagSchema = z.object({
  shadowCompile: z.boolean(),
  shadowExecution: z.boolean(),
  canaryExecution: z.boolean(),
  primaryExecution: z.boolean(),
});

export async function getWorkflowRuntimeV2FlagSnapshot(
  context: RolloutContext = {},
  database: Queryable = db,
) {
  return WorkflowRuntimeV2FlagSchema.parse({
    shadowCompile: await isWorkflowRuntimeV2ModeEnabled('shadow_compile', context, database),
    shadowExecution: await isWorkflowRuntimeV2ModeEnabled('shadow_execution', context, database),
    canaryExecution: await isWorkflowRuntimeV2ModeEnabled('canary_execution', context, database),
    primaryExecution: await isWorkflowRuntimeV2ModeEnabled('primary_execution', context, database),
  });
}
