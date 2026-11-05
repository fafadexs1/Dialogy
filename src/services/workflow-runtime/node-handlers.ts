import { z } from 'zod';
import { DataOperationSchema, executeDataOperation } from './data-operations';
import { toolboxManifests } from './toolbox-catalog';
import { validateSchema } from 'genkit/schema';
import { executeAgentNode } from './agent-loop';
import type { ModelFallbackChain } from './model-adapter';
import type {
  AgentNodeConfig,
  NodeExecutionResult,
  NodeHandler,
  NodeHandlerRegistry as NodeHandlerRegistryContract,
  NodeRuntimeInput,
  WorkflowExecution,
  WorkflowNode,
} from './types';
import { AgentNodeConfigSchema } from './schemas';
import { isQueueableTeamReason } from '../chat-distribution/queueable-reasons';
import { evaluateWorkflowGoalCompletion } from './goal-completion';
import { executeSandboxedWorkflowCode } from './code-sandbox';
import { executeJsonataTransform } from './jsonata-runtime';
import type { ToolRegistry } from './tools';
import {
  createId,
  isRecord,
  materializeValue,
  mergeStatePatch,
  readPath,
  renderTemplate,
  stableStringify,
  statePatchAtPath,
  withTimeout,
} from './utils';

type AgentDependencyContext = {
  execution: WorkflowExecution;
  node: WorkflowNode;
  modelNode: WorkflowNode;
  toolNodes: WorkflowNode[];
  memoryNode?: WorkflowNode;
  knowledgeNodes: WorkflowNode[];
  guardrailNodes: WorkflowNode[];
};

export type WorkflowHandlerDependencies = {
  executeToolbox?: (input: NodeRuntimeInput) => Promise<NodeExecutionResult>;
  executeStudioFlow?: (input: NodeRuntimeInput) => Promise<NodeExecutionResult>;
  stopStudioFlow?: NonNullable<NodeHandler['stop']>;
  executePublishedAgent?: (input: NodeRuntimeInput) => Promise<NodeExecutionResult>;
  stopPublishedAgent?: NonNullable<NodeHandler['stop']>;
  executeLinkedAgent?: (input: NodeRuntimeInput) => Promise<Record<string, unknown>>;
  resolveModelChain?: (context: AgentDependencyContext) => Promise<ModelFallbackChain>;
  resolveToolRegistry?: (context: AgentDependencyContext) => Promise<ToolRegistry>;
  loadMemory?: (context: AgentDependencyContext) => Promise<Record<string, unknown>>;
  retrieveKnowledge?: (context: AgentDependencyContext) => Promise<Array<Record<string, unknown>>>;
  applyGuardrails?: (
    phase: 'input' | 'output',
    value: Record<string, unknown>,
    context: AgentDependencyContext,
  ) => Promise<Record<string, unknown>>;
  executePrompt?: (input: NodeRuntimeInput) => Promise<NodeExecutionResult>;
  sendResponse?: (
    message: string,
    input: NodeRuntimeInput,
  ) => Promise<Record<string, unknown>>;
  sendMedia?: (
    media: { type: string; url: string; file?: unknown; caption?: string; fileName?: string; mimeType?: string },
    input: NodeRuntimeInput,
  ) => Promise<Record<string, unknown>>;
  sendTyping?: (
    durationMs: number,
    input: NodeRuntimeInput,
  ) => Promise<Record<string, unknown>>;
  handoff?: (input: NodeRuntimeInput) => Promise<Record<string, unknown>>;
  /**
   * Called only after `handoff` failed because the destination team cannot take the chat right now
   * (offline, full, paused, outside hours). Returns `{ queued: true }` once the customer has an owner
   * (the team queue). Absent in sandboxes and previews: the failure is then reported as before.
   */
  queueHandoff?: (
    input: NodeRuntimeInput,
    failure: { reasonCode: string; teamId: string; error: string },
  ) => Promise<Record<string, unknown>>;
  closeConversation?: (input: NodeRuntimeInput) => Promise<Record<string, unknown>>;
  loadState?: (input: NodeRuntimeInput) => Promise<Record<string, unknown>>;
  saveState?: (input: NodeRuntimeInput) => Promise<Record<string, unknown>>;
  executeSubflow?: (input: NodeRuntimeInput) => Promise<Record<string, unknown>>;
  executeHttp?: (input: NodeRuntimeInput) => Promise<Record<string, unknown>>;
  executeIntegration?: (input: NodeRuntimeInput) => Promise<Record<string, unknown>>;
  executePlatformAction?: (input: NodeRuntimeInput) => Promise<NodeExecutionResult>;
};

export class WorkflowNodeHandlerRegistry implements NodeHandlerRegistryContract {
  private readonly handlers = new Map<string, NodeHandler>();

  register(handler: NodeHandler): this {
    if (this.handlers.has(handler.type)) {
      throw new Error(`Node handler ${handler.type} is already registered.`);
    }
    this.handlers.set(handler.type, handler);
    return this;
  }

  get(nodeType: string): NodeHandler | undefined {
    return this.handlers.get(nodeType);
  }

  listTypes(): string[] {
    return [...this.handlers.keys()].sort();
  }
  wrapExecutions(wrapper: (handler: NodeHandler, input: NodeRuntimeInput) => Promise<NodeExecutionResult>): void {
    for (const [type, handler] of this.handlers) this.handlers.set(type, { ...handler, execute: input => wrapper(handler, input) });
  }
}

function sourceContext(input: NodeRuntimeInput) {
  return {
    ...input.execution.variables,
    input: input.execution.input,
    current: input.input,
    variables: input.execution.variables,
    context: input.execution.context,
    nodeResults: input.execution.nodeResults,
    sessionId: input.execution.sessionId,
    conversationId: input.execution.conversationId,
  };
}

function variableStatePatch(path: unknown, value: unknown): Record<string, unknown> {
  const normalized = String(path || '')
    .replace(/^\{\{\s*|\s*\}\}$/g, '')
    .replace(/^\$\.(?:variables\.)?/, '')
    .replace(/^variables\./, '')
    .trim();
  if (!normalized) return {};
  const segments = normalized.split('.').filter((segment) => segment && !['__proto__', 'prototype', 'constructor'].includes(segment));
  if (segments.length === 0) return {};
  const patch: Record<string, unknown> = {};
  let cursor = patch;
  segments.forEach((segment, index) => {
    if (index === segments.length - 1) cursor[segment] = value;
    else {
      cursor[segment] = {};
      cursor = cursor[segment] as Record<string, unknown>;
    }
  });
  return patch;
}

function resumedMessage(value: unknown): unknown {
  if (!isRecord(value)) return value;
  return value.value ?? value.message ?? value.text ?? value.customerMessage ?? value.input;
}

function visibleAgentResponse(value: unknown): string {
  if (!isRecord(value)) return '';
  return String(value.response || value.question || value.customerMessage || value.summary || '').trim();
}

function success(
  output: Record<string, unknown>,
  statePatch?: Record<string, unknown>,
  selectedOutput = 'success',
): NodeExecutionResult {
  return {
    status: 'success',
    selectedOutput,
    output,
    statePatch,
  };
}

type ConditionDataType = 'auto' | 'string' | 'number' | 'boolean' | 'date';

function coerceConditionDate(value: unknown): Date | null {
  if (value == null) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(value < 1e11 ? value * 1_000 : value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const normalized = String(value).trim();
  if (!normalized) return null;
  const brazilianDate = /^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(normalized);
  if (brazilianDate) {
    const [, day, month, year, hours = '00', minutes = '00', seconds = '00'] = brazilianDate;
    const date = new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hours),
      Number(minutes),
      Number(seconds),
    );
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function coerceConditionValue(value: unknown, dataType: ConditionDataType): unknown {
  if (dataType === 'string') return value == null ? value : String(value);
  if (dataType === 'number') {
    const parsed = Number.parseFloat(String(value));
    return Number.isNaN(parsed) ? value : parsed;
  }
  if (dataType === 'boolean') {
    const normalized = String(value).trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  if (dataType === 'date') return coerceConditionDate(value) || value;
  return value;
}

function compare(left: unknown, operator: string, right: unknown, requestedDataType: unknown = 'auto'): boolean {
  const dataType = ['string', 'number', 'boolean', 'date'].includes(String(requestedDataType))
    ? String(requestedDataType) as ConditionDataType
    : 'auto';
  const dateComparison = operator === 'date_after' || operator === 'date_before';
  const actualLeft = dateComparison ? coerceConditionDate(left) : coerceConditionValue(left, dataType);
  const actualRight = dateComparison ? coerceConditionDate(right) : coerceConditionValue(right, dataType);
  switch (operator) {
    case 'equals':
    case 'eq':
      return actualLeft instanceof Date && actualRight instanceof Date
        ? actualLeft.getTime() === actualRight.getTime()
        : actualLeft === actualRight;
    case 'not_equals':
    case 'neq':
      return !compare(left, 'equals', right, dataType);
    case 'contains':
      return typeof actualLeft === 'string'
        ? actualLeft.toLocaleLowerCase('pt-BR').includes(String(actualRight ?? '').toLocaleLowerCase('pt-BR'))
        : Array.isArray(actualLeft) && actualLeft.includes(actualRight);
    case 'not_contains':
      return !compare(left, 'contains', right, dataType);
    case 'starts_with':
      return typeof actualLeft === 'string'
        && actualLeft.toLocaleLowerCase('pt-BR').startsWith(String(actualRight ?? '').toLocaleLowerCase('pt-BR'));
    case 'ends_with':
      return typeof actualLeft === 'string'
        && actualLeft.toLocaleLowerCase('pt-BR').endsWith(String(actualRight ?? '').toLocaleLowerCase('pt-BR'));
    case 'greater_than':
    case 'gt':
      return Number(actualLeft) > Number(actualRight);
    case 'greater_or_equal':
    case 'gte':
      return Number(actualLeft) >= Number(actualRight);
    case 'less_than':
    case 'lt':
      return Number(actualLeft) < Number(actualRight);
    case 'less_or_equal':
    case 'lte':
      return Number(actualLeft) <= Number(actualRight);
    case 'exists':
      return actualLeft !== undefined && actualLeft !== null && String(actualLeft).trim() !== '';
    case 'not_exists':
      return actualLeft === undefined || actualLeft === null || String(actualLeft).trim() === '';
    case 'is_true':
      return actualLeft === true || String(actualLeft).toLowerCase() === 'true';
    case 'is_false':
      return actualLeft === false || String(actualLeft).toLowerCase() === 'false';
    case 'date_after':
      return actualLeft instanceof Date && actualRight instanceof Date && actualLeft.getTime() > actualRight.getTime();
    case 'date_before':
      return actualLeft instanceof Date && actualRight instanceof Date && actualLeft.getTime() < actualRight.getTime();
    case 'matches':
      try {
        return typeof left === 'string' && new RegExp(String(right)).test(left);
      } catch {
        return false;
      }
    default:
      return false;
  }
}

function resolveConditionOperand(value: unknown, source: Record<string, unknown>) {
  if (typeof value === 'string' && value.startsWith('$.')) return readPath(source, value);
  return materializeValue(value, source);
}

function triggerHandler(type: string): NodeHandler {
  return {
    type,
    execute: async (input) => {
      const requestedOutput = typeof input.execution.context.triggerOutput === 'string'
        ? input.execution.context.triggerOutput.trim()
        : '';
      const configuredDefault = typeof input.node.config.defaultOutput === 'string'
        ? input.node.config.defaultOutput.trim()
        : '';
      const selectedOutput = [requestedOutput, configuredDefault]
        .find((candidate) => candidate && input.node.outputPorts.some((port) => (
          port.id === candidate && port.connectionType === 'main'
        ))) || 'success';
      return success(structuredClone(input.execution.input), undefined, selectedOutput);
    },
  };
}

const setHandler: NodeHandler = {
  type: 'data.set',
  configSchema: z.object({
    assignments: z.record(z.unknown()),
  }).passthrough(),
  execute: async (input) => {
    const source = sourceContext(input);
    const assignments = materializeValue(input.node.config.assignments || {}, source);
    if (!isRecord(assignments)) {
      return {
        status: 'error',
        error: {
          code: 'INVALID_ASSIGNMENTS',
          message: 'Set node assignments must produce an object.',
          retryable: false,
        },
      };
    }
    return success({ ...input.input, ...assignments }, assignments);
  },
};

const transformHandler: NodeHandler = {
  type: 'data.transform',
  configSchema: z.object({
    mode: z.enum(['mapping', 'jsonata']).optional(),
    mappings: z.record(z.unknown()).optional(),
    expression: z.string().optional(),
    source: z.unknown().optional(),
    outputKey: z.string().optional(),
    evaluationTimeoutMs: z.number().int().min(25).max(2_000).optional(),
  }).passthrough(),
  execute: async (input) => {
    const source = sourceContext(input);
    const expression = typeof input.node.config.expression === 'string'
      ? input.node.config.expression.trim()
      : '';
    const usesJsonata = input.node.config.mode === 'jsonata' || Boolean(expression);
    if (usesJsonata) {
      if (!expression) {
        return {
          status: 'error',
          error: { code: 'JSONATA_EXPRESSION_MISSING', message: 'Informe a expressão JSONata da transformação.', retryable: false },
        };
      }
      try {
        const transformed = await executeJsonataTransform({
          expression,
          source: input.node.config.source,
          context: source,
          current: input.input,
          timeoutMs: Number(input.node.config.evaluationTimeoutMs || 250),
        });
        const output = isRecord(transformed) ? transformed : { value: transformed };
        const outputKey = typeof input.node.config.outputKey === 'string'
          ? input.node.config.outputKey.trim()
          : '';
        return success(output, outputKey ? statePatchAtPath(outputKey, transformed) : undefined);
      } catch (cause) {
        const error = cause as Error & { code?: string; retryable?: boolean; details?: Record<string, unknown> };
        return {
          status: 'error',
          error: {
            code: error.code || 'JSONATA_EVALUATION_FAILED',
            message: error.message || 'Não foi possível executar a transformação JSONata.',
            retryable: error.retryable === true,
            details: error.details,
          },
        };
      }
    }
    const mappings = isRecord(input.node.config.mappings) ? input.node.config.mappings : {};
    const transformed = materializeValue(mappings, source);
    const output = isRecord(transformed) ? transformed : {};
    const outputKey = typeof input.node.config.outputKey === 'string'
      ? input.node.config.outputKey.trim()
      : '';
    return success(
      output,
      outputKey ? statePatchAtPath(outputKey, output) : undefined,
    );
  },
};

const ExtractedRecordSchema = z.record(z.unknown());

function modelDependencyContext(input: NodeRuntimeInput): AgentDependencyContext | null {
  const modelNode = input.attachments.model?.[0]
    || input.workflow.nodes.find((node) => node.type === 'ai.model')
    || {
      id: 'default_ai_model',
      type: 'ai.model',
      name: 'Default AI Model',
      position: { x: 0, y: 0 },
      config: {
        model: 'gemini-2.5-flash',
        temperature: 0.7,
      },
      inputPorts: [],
      outputPorts: [],
    };

  return {
    execution: input.execution,
    node: input.node,
    modelNode,
    toolNodes: input.attachments.tool?.length
      ? input.attachments.tool
      : input.workflow.nodes.filter((node) => node.type.startsWith('tool.')),
    memoryNode: input.attachments.memory?.[0]
      || input.workflow.nodes.find((node) => node.type === 'memory.session'),
    knowledgeNodes: input.attachments.knowledge?.length
      ? input.attachments.knowledge
      : input.workflow.nodes.filter((node) => node.type === 'knowledge.rag_retriever'),
    guardrailNodes: input.attachments.guardrail || [],
  };
}

function extractHandler(dependencies: WorkflowHandlerDependencies): NodeHandler {
  return {
    type: 'data.extract',
    execute: async (input) => {
      const dependencyContext = modelDependencyContext(input);
      if (!dependencyContext || !dependencies.resolveModelChain) {
        return {
          status: 'error',
          error: {
            code: 'EXTRACT_MODEL_MISSING',
            message: 'A structured extraction node requires a connected model.',
            retryable: false,
          },
        };
      }
      const jsonSchema = isRecord(input.node.config.schema) ? input.node.config.schema : {};
      const remainingCalls = Math.max(0, input.workflow.settings.maxModelCalls - input.execution.totalModelCalls);
      const maxAttempts = Math.min(remainingCalls, Math.max(1, Math.min(5, Number(input.node.config.maxAttempts || 2))));
      if (maxAttempts === 0) return { status: 'error', error: { code: 'MAX_MODEL_CALLS_REACHED', message: 'O orçamento de extração foi esgotado.', retryable: false } };
      const modelChain = await dependencies.resolveModelChain(dependencyContext);
      let lastValidationErrors: unknown = [];
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const generated = await modelChain.generateStructured({
          messages: [{
            role: 'system',
            content: [
              'Extraia somente os dados presentes na entrada.',
              'Não invente valores ausentes.',
              'Retorne exclusivamente um objeto JSON compatível com o schema fornecido.',
              `Schema: ${stableStringify(jsonSchema)}`,
            ].join('\n'),
          }, {
            role: 'user',
            content: stableStringify(input.input),
          }],
          schema: ExtractedRecordSchema,
          schemaName: `workflow_extract_${input.node.id}`,
          jsonSchema,
          timeoutMs: Number(dependencyContext.modelNode.config.timeoutMs || 60_000),
          signal: input.signal,
        });
        const validation = validateSchema(generated.output, { jsonSchema });
        if (validation.valid) {
          return {
            status: 'route',
            selectedOutput: 'success',
            output: generated.output,
            statePatch: typeof input.node.config.outputKey === 'string' && input.node.config.outputKey.trim()
              ? statePatchAtPath(input.node.config.outputKey.trim(), generated.output)
              : undefined,
            metrics: {
              durationMs: 0,
              model: generated.selected.config.model,
              modelCalls: attempt,
            },
          };
        }
        lastValidationErrors = validation.errors || [];
      }
      return {
        status: 'route',
        selectedOutput: 'invalid_output',
        output: { valid: false, validationErrors: lastValidationErrors },
        metrics: { durationMs: 0, modelCalls: maxAttempts },
      };
    },
  };
}

const templateHandler: NodeHandler = {
  type: 'data.template',
  execute: async (input) => {
    const template = String(input.node.config.template || '');
    const outputKey = String(input.node.config.outputKey || 'text');
    const rendered = renderTemplate(template, sourceContext(input));
    return success({ [outputKey]: rendered }, statePatchAtPath(outputKey, rendered));
  },
};

const ifHandler: NodeHandler = {
  type: 'logic.if',
  execute: async (input) => {
    const source = sourceContext(input);
    const left = resolveConditionOperand(input.node.config.left, source);
    const right = resolveConditionOperand(input.node.config.right, source);
    const matched = compare(left, String(input.node.config.operator || 'equals'), right, input.node.config.dataType);
    return {
      status: 'route',
      selectedOutput: matched ? 'true' : 'false',
      output: { matched, left, right },
    };
  },
};

type SwitchCase = {
  output: string;
  operator?: string;
  value?: unknown;
};

const switchHandler: NodeHandler = {
  type: 'logic.switch',
  execute: async (input) => {
    const source = sourceContext(input);
    const actual = resolveConditionOperand(input.node.config.value, source);
    const cases = Array.isArray(input.node.config.cases)
      ? input.node.config.cases.filter(isRecord) as SwitchCase[]
      : [];
    const selected = cases.find((candidate) => (
      compare(actual, candidate.operator || 'equals', resolveConditionOperand(candidate.value, source))
    ));
    const selectedOutput = selected?.output || String(input.node.config.defaultOutput || 'default');
    return {
      status: 'route',
      selectedOutput,
      output: { value: actual, selectedOutput },
    };
  },
};

const codeHandler: NodeHandler = {
  type: 'data.code',
  configSchema: z.object({
    language: z.literal('javascript').default('javascript'),
    source: z.string().min(1),
    outputKey: z.string().min(1).default('result'),
  }).passthrough(),
  execute: async (input) => {
    const outputKey = String(input.node.config.outputKey || 'result');
    const result = executeSandboxedWorkflowCode({
      source: String(input.node.config.source || ''),
      current: input.input,
      variables: input.execution.variables,
      context: input.execution.context,
      timeoutMs: Number(input.node.timeoutMs || input.node.config.timeoutMs || 2_000),
    });
    return success({ [outputKey]: result }, statePatchAtPath(outputKey, result));
  },
};

const logHandler: NodeHandler = {
  type: 'data.log',
  execute: async (input) => {
    const message = renderTemplate(String(input.node.config.message || '{{current}}'), sourceContext(input));
    const level = ['info', 'warn', 'error'].includes(String(input.node.config.level))
      ? String(input.node.config.level)
      : 'info';
    return success({ ...input.input, log: { level, message } });
  },
};

function interactionHandler(
  type: 'interaction.input' | 'interaction.options' | 'interaction.date' | 'interaction.file' | 'interaction.rating',
  dependencies: WorkflowHandlerDependencies,
): NodeHandler {
  return {
    type,
    execute: async (input) => {
      if (!dependencies.sendResponse) {
        return {
          status: 'error',
          error: {
            code: 'INTERACTION_DELIVERY_NOT_CONFIGURED',
            message: 'O canal atual não possui entrega configurada para perguntas.',
            retryable: false,
          },
        };
      }
      const source = sourceContext(input);
      let prompt = renderTemplate(String(input.node.config.prompt || ''), source);
      const retry = isRecord(input.execution.context.__interactionRetry)
        && input.execution.context.__interactionRetry.nodeId === input.node.id
        ? input.execution.context.__interactionRetry
        : null;
      if (type === 'interaction.options') {
        const options = Array.isArray(input.node.config.options)
          ? input.node.config.options.filter(isRecord)
          : [];
        const renderedOptions = options.map((option, index) => {
          const value = String(option.value || option.label || `Opção ${index + 1}`);
          const label = String(option.label || '').trim();
          return `${index + 1}. ${value}${label && label !== value ? ` — ${label}` : ''}`;
        }).join('\n');
        prompt = [prompt, renderedOptions, String(input.node.config.footer || '')]
          .map((item) => item.trim())
          .filter(Boolean)
          .join('\n\n');
      }
      if (retry) {
        const configuredMessage = retry.reason === 'unrecognized' && type === 'interaction.options'
          ? input.node.config.invalidOptionMessage
          : input.node.config.invalidInputMessage;
        const retryMessage = renderTemplate(
          String(configuredMessage || retry.message || (
            type === 'interaction.options'
              ? 'Não reconheci essa opção. Escolha uma das opções abaixo.'
              : 'Não consegui validar essa resposta. Tente novamente.'
          )),
          source,
        ).trim();
        prompt = [retryMessage, prompt].filter(Boolean).join('\n\n');
      }
      const delivery = await dependencies.sendResponse(prompt, input);
      if (delivery.success === false) {
        return {
          status: 'error',
          error: { code: 'INTERACTION_DELIVERY_FAILED', message: String(delivery.error || 'Falha ao enviar a pergunta.'), retryable: true },
        };
      }
      const waitingSince = new Date();
      const timeoutMs = Math.max(1, Number(input.node.config.timeoutMs || 86_400_000));
      return {
        status: 'waiting',
        selectedOutput: 'resumed',
        waitingReason: 'time',
        resumeToken: createId(`resume_${input.execution.executionId}_${input.node.id}`),
        output: {
          prompt,
          delivery,
          waitingSince: waitingSince.toISOString(),
          timeoutMs,
          expiresAt: new Date(waitingSince.getTime() + timeoutMs).toISOString(),
        },
      };
    },
  };
}

const goalCompletionHandler: NodeHandler = {
  type: 'logic.goal_completion',
  execute: async (input) => {
    const goalCompletion = evaluateWorkflowGoalCompletion(input);
    return {
      status: 'route',
      selectedOutput: goalCompletion.complete ? 'completed' : 'incomplete',
      output: {
        ...input.input,
        goalCompletion,
      },
    };
  },
};

const AiRouterDecisionSchema = z.object({
  routeId: z.string().min(1),
  confidence: z.number().min(0).max(1),
});

function aiRouterHandler(dependencies: WorkflowHandlerDependencies): NodeHandler {
  return {
    type: 'logic.ai_router',
    execute: async (input) => {
      const dependencyContext = modelDependencyContext(input);
      if (!dependencyContext || !dependencies.resolveModelChain) {
        return {
          status: 'error',
          error: {
            code: 'AI_ROUTER_MODEL_MISSING',
            message: 'An AI router requires a connected model.',
            retryable: false,
          },
        };
      }
      const routes = Array.isArray(input.node.config.routes)
        ? input.node.config.routes.filter(isRecord).map((route) => ({
            id: String(route.id || ''),
            label: String(route.label || route.id || ''),
            description: String(route.description || ''),
            examples: Array.isArray(route.examples) ? route.examples.map(String) : [],
          })).filter((route) => route.id)
        : [];
      if (routes.length === 0) {
        return {
          status: 'error',
          error: { code: 'AI_ROUTER_ROUTES_MISSING', message: 'AI router has no configured routes.', retryable: false },
        };
      }
      const modelChain = await dependencies.resolveModelChain(dependencyContext);
      const generated = await modelChain.generateStructured({
        messages: [{
          role: 'system',
          content: [
            'Selecione exatamente uma das rotas permitidas para a entrada recebida.',
            'Não crie novas rotas e não exponha raciocínio interno.',
            `Rotas: ${stableStringify(routes)}`,
          ].join('\n'),
        }, {
          role: 'user',
          content: stableStringify(input.input),
        }],
        schema: AiRouterDecisionSchema,
        schemaName: `workflow_router_${input.node.id}`,
        timeoutMs: Number(dependencyContext.modelNode.config.timeoutMs || 60_000),
        signal: input.signal,
      });
      const allowedRouteIds = new Set(routes.map((route) => route.id));
      const minimumConfidence = Number(input.node.config.minimumConfidence ?? 0.75);
      const lowConfidenceOutput = String(input.node.config.lowConfidenceOutput || 'low_confidence');
      const defaultOutput = String(input.node.config.defaultOutput || 'default');
      const selectedOutput = generated.output.confidence < minimumConfidence
        ? lowConfidenceOutput
        : allowedRouteIds.has(generated.output.routeId)
          ? generated.output.routeId
          : defaultOutput;
      return {
        status: 'route',
        selectedOutput,
        output: {
          routeId: selectedOutput,
          proposedRouteId: generated.output.routeId,
          confidence: generated.output.confidence,
        },
        metrics: {
          durationMs: 0,
          model: generated.selected.config.model,
          modelCalls: 1,
        },
      };
    },
  };
}

const mergeHandler: NodeHandler = {
  type: 'logic.merge',
  execute: async (input) => success(structuredClone(input.input)),
};

const parallelHandler: NodeHandler = {
  type: 'logic.parallel',
  execute: async (input) => {
    const configuredOutputs = Array.isArray(input.node.config.outputs)
      ? input.node.config.outputs.map(String).filter(Boolean)
      : [];
    const availableOutputs = input.node.outputPorts
      .filter((port) => port.connectionType === 'main' && port.id !== 'error')
      .map((port) => port.id);
    const selectedOutputs = configuredOutputs.length > 0 ? configuredOutputs : availableOutputs;
    return {
      status: 'route',
      selectedOutputs,
      output: structuredClone(input.input),
    };
  },
};

function waitHandler(dependencies: WorkflowHandlerDependencies): NodeHandler {
  return {
    type: 'logic.wait',
    execute: async (input) => {
    const mode = String(input.node.config.mode || 'event');
    const waitingSince = new Date();
    const timeoutMs = Math.max(1, Number(input.node.config.timeoutMs || 86_400_000));
    const typing = mode === 'time' && input.node.config.showTyping === true && dependencies.sendTyping
      ? await dependencies.sendTyping(timeoutMs, input)
      : undefined;
    if (typing?.success === false) {
      return {
        status: 'error',
        selectedOutput: 'error',
        error: { code: 'TYPING_DELIVERY_FAILED', message: String(typing.error || 'Falha ao acionar o indicador de digitação.'), retryable: true },
      };
    }
    return {
      status: 'waiting',
      selectedOutput: 'resumed',
      waitingReason: mode,
      resumeToken: createId(`resume_${input.execution.executionId}_${input.node.id}`),
      output: {
        waitingSince: waitingSince.toISOString(),
        resumeEvent: renderTemplate(String(input.node.config.resumeEvent || ''), sourceContext(input)),
        pauseTimeoutWhileWaiting: input.node.config.pauseTimeoutWhileWaiting === true,
        expireWait: input.node.config.expireEvents === true,
        ...(typing ? { typing } : {}),
        ...(mode === 'time' || input.node.config.expireEvents === true ? {
          timeoutMs,
          expiresAt: new Date(waitingSince.getTime() + timeoutMs).toISOString(),
        } : {}),
      },
    };
    },
  };
}

const timeWindowHandler: NodeHandler = {
  type: 'logic.time_window',
  execute: async (input) => {
    const timezone = String(input.node.config.timezone || 'America/Sao_Paulo');
    const startTime = String(input.node.config.startTime || '09:00');
    const endTime = String(input.node.config.endTime || '18:00');
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(new Date());
    const hour = Number(parts.find((part) => part.type === 'hour')?.value || 0);
    const minute = Number(parts.find((part) => part.type === 'minute')?.value || 0);
    const current = hour * 60 + minute;
    const toMinutes = (value: string) => {
      const [hours, minutes] = value.split(':').map(Number);
      if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours! < 0 || hours! > 23 || minutes! < 0 || minutes! > 59) {
        throw new Error(`Horário inválido: ${value}`);
      }
      return hours! * 60 + minutes!;
    };
    const start = toMinutes(startTime);
    const end = toMinutes(endTime);
    const inside = start <= end ? current >= start && current < end : current >= start || current < end;
    return {
      status: 'route',
      selectedOutput: inside ? 'inside' : 'outside',
      output: { inside, timezone, currentTime: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`, startTime, endTime },
    };
  },
};

const gotoHandler: NodeHandler = {
  type: 'logic.goto',
  execute: async (input) => ({
    status: 'route',
    nextNodeId: String(input.node.config.targetNodeId || ''),
    output: structuredClone(input.input),
  }),
};

const loopHandler: NodeHandler = {
  type: 'logic.loop',
  execute: async (input) => {
    const loopState = isRecord(input.execution.variables.__loops)
      ? input.execution.variables.__loops
      : {};
    const stored = loopState[input.node.id];
    const current = isRecord(stored) ? Number(stored.count || 0) : Number(stored || 0);
    const storedStartedAt = isRecord(stored)
      ? new Date(String(stored.startedAt || '')).getTime()
      : Number.NaN;
    const startedAt = Number.isFinite(storedStartedAt) ? storedStartedAt : Date.now();
    const maxIterations = Number(input.node.config.maxIterations || 1);
    const totalTimeoutMs = Math.max(1, Number(input.node.config.totalTimeoutMs || 60_000));
    const exitCondition = input.node.config.exitCondition;
    let shouldExit = false;
    if (isRecord(exitCondition)) {
      const source = sourceContext(input);
      shouldExit = compare(
        resolveConditionOperand(exitCondition.left, source),
        String(exitCondition.operator || 'equals'),
        resolveConditionOperand(exitCondition.right, source),
      );
    } else if (typeof exitCondition === 'string') {
      shouldExit = renderTemplate(exitCondition, sourceContext(input)).trim().toLowerCase() === 'true';
    }
    if (shouldExit) {
      return {
        status: 'route',
        selectedOutput: 'done',
        output: { iterations: current, reason: 'exit_condition' },
      };
    }
    if (Date.now() - startedAt >= totalTimeoutMs) {
      return {
        status: 'route',
        selectedOutput: 'limit_reached',
        output: { iterations: current, reason: 'total_timeout', totalTimeoutMs },
      };
    }
    if (current >= maxIterations) {
      return {
        status: 'route',
        selectedOutput: 'limit_reached',
        output: { iterations: current, reason: 'max_iterations' },
      };
    }
    return {
      status: 'route',
      selectedOutput: 'iterate',
      statePatch: {
        __loops: {
          ...loopState,
          [input.node.id]: {
            count: current + 1,
            startedAt: new Date(startedAt).toISOString(),
          },
        },
      },
      output: { iteration: current + 1 },
    };
  },
};

function buildAgentDependencyContext(input: NodeRuntimeInput): AgentDependencyContext | null {
  return modelDependencyContext(input);
}

function agentHandler(dependencies: WorkflowHandlerDependencies): NodeHandler {
  return {
    type: 'ai.agent',
    configSchema: AgentNodeConfigSchema as z.ZodType<Record<string, unknown>>,
    execute: async (input) => {
      const agentConfig = AgentNodeConfigSchema.parse(input.node.config);
      if (agentConfig.useSelectedSystemAgent !== false && dependencies.executeLinkedAgent) {
        const linkedAgent = await dependencies.executeLinkedAgent(input);
        if (linkedAgent.handled === true) {
          if (linkedAgent.success === false) {
            return {
              status: 'error',
              selectedOutput: 'error',
              error: {
                code: 'LINKED_SYSTEM_AGENT_FAILED',
                message: String(linkedAgent.error || 'Falha ao executar a IA vinculada ao agente do fluxo.'),
                retryable: linkedAgent.retryable === true,
              },
              output: linkedAgent,
            };
          }
          return {
            status: 'completed',
            selectedOutput: 'handoff',
            output: linkedAgent,
            metrics: { durationMs: Number(linkedAgent.durationMs || 0) },
          };
        }
      }
      const dependencyContext = buildAgentDependencyContext(input);
      if (!dependencyContext || !dependencies.resolveModelChain || !dependencies.resolveToolRegistry) {
        return {
          status: 'error',
          error: {
            code: 'AGENT_DEPENDENCY_MISSING',
            message: 'Agent model and tool runtime dependencies are not configured.',
            retryable: false,
          },
        };
      }
      const configuredInputPath = String(input.node.config.inputPath || '').trim();
      const resumeInput = resumedMessage(input.execution.context.__resumeInput);
      const configuredInput = resumeInput !== undefined
        ? resumeInput
        : configuredInputPath
          ? readPath(sourceContext(input), configuredInputPath)
          : input.input;
      const agentInput = isRecord(configuredInput) ? configuredInput : { message: configuredInput };
      const guardedInput = dependencies.applyGuardrails
        ? await dependencies.applyGuardrails('input', agentInput, dependencyContext)
        : agentInput;
      const execution = {
        ...input.execution,
        input: {
          ...input.execution.input,
          current: guardedInput,
        },
      };
      const [modelChain, tools, memory, knowledge] = await Promise.all([
        dependencies.resolveModelChain(dependencyContext),
        dependencies.resolveToolRegistry(dependencyContext),
        dependencies.loadMemory?.(dependencyContext) || Promise.resolve({}),
        dependencies.retrieveKnowledge?.(dependencyContext) || Promise.resolve([]),
      ]);
      const result = await withTimeout(
        (agentSignal) => executeAgentNode({
          config: agentConfig as AgentNodeConfig,
          execution,
          workflow: input.workflow,
          node: input.node,
          modelChain,
          tools,
          memory,
          knowledge,
          signal: agentSignal,
          emit: input.emit,
        }),
        agentConfig.timeoutMs,
        input.signal,
        'AGENT_TIMEOUT',
      );
      result.metrics = {
        durationMs: result.metrics?.durationMs || 0,
        ...result.metrics,
        modelCalls: result.metrics?.attempts || 0,
      };
      if (result.output && dependencies.applyGuardrails) {
        result.output = await dependencies.applyGuardrails('output', result.output, dependencyContext);
      }
      const response = visibleAgentResponse(result.output);
      const outputKey = String(input.node.config.outputKey || '').trim();
      const inputVariable = String(input.node.config.inputVariable || '').trim();
      const previousStatePatch = isRecord(result.statePatch) ? result.statePatch : {};
      const conversationTurns = isRecord(input.execution.variables.__agentConversationTurns)
        ? input.execution.variables.__agentConversationTurns
        : {};
      const currentConversationTurn = Number(conversationTurns[input.node.id] || 0) + 1;
      result.statePatch = mergeStatePatch(previousStatePatch, {
        ...(outputKey && response ? variableStatePatch(outputKey, response) : {}),
        ...(inputVariable && resumeInput !== undefined ? variableStatePatch(inputVariable, resumeInput) : {}),
        ...(input.node.config.conversationMode === true ? {
          __agentConversationTurns: { ...conversationTurns, [input.node.id]: currentConversationTurn },
        } : {}),
      });
      if (input.node.config.autoSendResponse === true && response && dependencies.sendResponse) {
        const delivery = await dependencies.sendResponse(response, input);
        if (delivery.success === false) {
          return {
            status: 'error',
            selectedOutput: 'error',
            error: { code: 'AGENT_DELIVERY_FAILED', message: String(delivery.error || 'Falha ao enviar a resposta do agente.'), retryable: true },
            statePatch: result.statePatch,
            metrics: result.metrics,
            toolCalls: result.toolCalls,
          };
        }
        result.output = { ...(isRecord(result.output) ? result.output : {}), delivery };
      }
      const maximumConversationTurns = Math.max(0, Number(input.node.config.maxConversationTurns || 0));
      if (
        input.node.config.conversationMode === true
        && result.selectedOutput === 'needs_input'
        && (maximumConversationTurns === 0 || currentConversationTurn < maximumConversationTurns)
      ) {
        const waitingSince = new Date();
        const timeoutMs = Math.max(1, Number(input.node.config.conversationTimeoutMs || 86_400_000));
        return {
          ...result,
          status: 'waiting',
          waitingReason: 'time',
          resumeToken: createId(`resume_${input.execution.executionId}_${input.node.id}`),
          output: {
            ...(isRecord(result.output) ? result.output : {}),
            resumeMode: 'reexecute',
            waitingSince: waitingSince.toISOString(),
            expiresAt: new Date(waitingSince.getTime() + timeoutMs).toISOString(),
          },
        };
      }
      if (input.node.config.conversationMode === true && result.selectedOutput === 'needs_input') {
        result.status = 'route';
        result.selectedOutput = 'completed';
      }
      const hasConnectedOutput = Boolean(result.selectedOutput) && input.workflow.connections.some((connection) => (
        connection.sourceNodeId === input.node.id
        && connection.sourcePortId === result.selectedOutput
        && connection.connectionType === 'main'
      ));
      if (result.status === 'completed' && hasConnectedOutput) {
        result.status = 'route';
      }
      return result;
    },
  };
}

function dependencyHandler(
  type: string,
  dependency: ((input: NodeRuntimeInput) => Promise<Record<string, unknown>>) | undefined,
  missingCode: string,
): NodeHandler {
  return {
    type,
    execute: async (input) => {
      if (!dependency) {
        return {
          status: 'error',
          error: {
            code: missingCode,
            message: `Runtime dependency for ${type} is not configured.`,
            retryable: false,
          },
        };
      }
      const result = await dependency(input);
      const metrics = isRecord(result.metrics) ? result.metrics : {};
      return { ...success(result), ...(input.execution.context.automationManaged === true && type === 'logic.subflow' ? { metrics: { durationMs: 0, modelCalls: Number(metrics.modelCalls || 0), toolCalls: Number(metrics.toolCalls || 0) } } : {}) };
    },
  };
}

function dependencyResultHandler(
  type: string,
  dependency: ((input: NodeRuntimeInput) => Promise<Record<string, unknown>>) | undefined,
  missingCode: string,
): NodeHandler {
  return {
    type,
    execute: async (input) => {
      if (!dependency) {
        return { status: 'error', error: { code: missingCode, message: `Runtime dependency for ${type} is not configured.`, retryable: false } };
      }
      const result = await dependency(input);
      const statePatch = isRecord(result.statePatch) ? result.statePatch : undefined;
      const output = { ...result };
      delete output.statePatch;
      return { ...success(output, statePatch), ...(input.execution.context.automationManaged === true && /^(integration\.|whatsapp\.|dialogy\.)/.test(type) ? { metrics: { durationMs: 0, toolCalls: 1 } } : {}) };
    },
  };
}

export function createDefaultNodeHandlerRegistry(
  dependencies: WorkflowHandlerDependencies = {},
): WorkflowNodeHandlerRegistry {
  const registry = new WorkflowNodeHandlerRegistry();
  [
    'trigger.received_message',
    'trigger.webhook',
    'trigger.internal_event',
    'trigger.schedule',
    'trigger.manual',
  ].forEach((type) => registry.register(triggerHandler(type)));

  registry
    .register({ type: 'data.operation', configSchema: DataOperationSchema, execute: async (input) => {
      const config = materializeValue(input.node.config, sourceContext(input));
      if (input.node.config.operation === 'join' && typeof input.node.config.right === 'string' && (!isRecord(config) || !Array.isArray(config.right))) throw new Error('A variável da lista da direita não contém uma lista.');
      let value: unknown;
      if (isRecord(config) && config.operation === 'regex') {
        const text = String(config.source ?? '');
        if (text.length > 100000 || String(config.pattern || '').length > 500) throw new Error('Use texto de até 100 mil caracteres e expressão de até 500.');
        value = executeSandboxedWorkflowCode({ source: 'const re = new RegExp(input.pattern, "g"); const result = []; for (const match of input.text.matchAll(re)) { result.push({ match: match[0], groups: Array.from(match).slice(1), named: match.groups || {} }); if (result.length >= 1000) break; } return { value: result };', current: { text, pattern: String(config.pattern || '') }, variables: {}, context: {}, timeoutMs: 100 }).value;
      } else value = executeDataOperation(config, isRecord(config) ? config.source ?? input.input : input.input);
      if (new TextEncoder().encode(JSON.stringify(value) ?? 'null').length > 1_000_000) throw new Error('O resultado excede 1 MB.');
      return success({ result: value }, variableStatePatch(input.node.config.outputKey || 'result', value));
    } })
    .register(interactionHandler('interaction.input', dependencies))
    .register(interactionHandler('interaction.options', dependencies))
    .register(interactionHandler('interaction.date', dependencies))
    .register(interactionHandler('interaction.file', dependencies))
    .register(interactionHandler('interaction.rating', dependencies))
    .register(setHandler)
    .register(transformHandler)
    .register(extractHandler(dependencies))
    .register(codeHandler)
    .register(logHandler)
    .register(templateHandler)
    .register(ifHandler)
    .register(goalCompletionHandler)
    .register(switchHandler)
    .register(aiRouterHandler(dependencies))
    .register(mergeHandler)
    .register(parallelHandler)
    .register(timeWindowHandler)
    .register(gotoHandler)
    .register(waitHandler(dependencies))
    .register(loopHandler)
    .register({
      type: 'integration.http_request',
      execute: async (input) => {
        if (!dependencies.executeHttp) {
          return { status: 'error', error: { code: 'HTTP_RUNTIME_NOT_CONFIGURED', message: 'O executor HTTP não está configurado.', retryable: false } };
        }
        const result = await dependencies.executeHttp(input);
        const statePatch = isRecord(result.statePatch) ? result.statePatch : undefined;
        const output = { ...result };
        delete output.statePatch;
        return { ...success(output, statePatch), ...(input.execution.context.automationManaged === true ? { metrics: { durationMs: 0, toolCalls: 1 } } : {}) };
      },
    })
    .register(dependencyResultHandler('integration.email', dependencies.executeIntegration, 'INTEGRATION_RUNTIME_NOT_CONFIGURED'))
    .register(dependencyResultHandler('integration.mcp_call', dependencies.executeIntegration, 'INTEGRATION_RUNTIME_NOT_CONFIGURED'))
    .register(dependencyResultHandler('integration.google_sheets_append', dependencies.executeIntegration, 'INTEGRATION_RUNTIME_NOT_CONFIGURED'))
    .register(dependencyResultHandler('integration.google_ads_lead', dependencies.executeIntegration, 'INTEGRATION_RUNTIME_NOT_CONFIGURED'))
    .register(dependencyResultHandler('integration.database', dependencies.executeIntegration, 'INTEGRATION_RUNTIME_NOT_CONFIGURED'))
    .register(dependencyResultHandler('dialogy.crm_update', dependencies.executeIntegration, 'INTEGRATION_RUNTIME_NOT_CONFIGURED'))
    .register(dependencyResultHandler('whatsapp.send_text', dependencies.executeIntegration, 'INTEGRATION_RUNTIME_NOT_CONFIGURED'))
    .register(dependencyResultHandler('whatsapp.send_media', dependencies.executeIntegration, 'INTEGRATION_RUNTIME_NOT_CONFIGURED'))
    .register(dependencyResultHandler('whatsapp.send_catalog', dependencies.executeIntegration, 'INTEGRATION_RUNTIME_NOT_CONFIGURED'))
    .register(dependencyResultHandler('whatsapp.group_create', dependencies.executeIntegration, 'INTEGRATION_RUNTIME_NOT_CONFIGURED'))
    .register({
      type: 'dialogy.team_availability',
      execute: dependencies.executePlatformAction || (async () => ({
        status: 'error',
        error: { code: 'PLATFORM_ACTION_RUNTIME_NOT_CONFIGURED', message: 'O runtime de ações da Dialogy não está configurado.', retryable: false },
      })),
    })
    .register({
      type: 'dialogy.chat_tag',
      execute: dependencies.executePlatformAction || (async () => ({
        status: 'error',
        error: { code: 'PLATFORM_ACTION_RUNTIME_NOT_CONFIGURED', message: 'O runtime de ações da Dialogy não está configurado.', retryable: false },
      })),
    })
    .register({
      type: 'dialogy.sgp_identify_customer',
      execute: dependencies.executePlatformAction || (async () => ({
        status: 'error',
        error: { code: 'PLATFORM_ACTION_RUNTIME_NOT_CONFIGURED', message: 'O runtime de ações da Dialogy não está configurado.', retryable: false },
      })),
    })
    .register({
      type: 'dialogy.sgp_contract_status',
      execute: dependencies.executePlatformAction || (async () => ({
        status: 'error',
        error: { code: 'PLATFORM_ACTION_RUNTIME_NOT_CONFIGURED', message: 'O runtime de ações da Dialogy não está configurado.', retryable: false },
      })),
    })
    .register({
      type: 'dialogy.sgp_second_copy',
      execute: dependencies.executePlatformAction || (async () => ({
        status: 'error',
        error: { code: 'PLATFORM_ACTION_RUNTIME_NOT_CONFIGURED', message: 'O runtime de ações da Dialogy não está configurado.', retryable: false },
      })),
    })
    .register({
      type: 'dialogy.sgp_payment_promise',
      execute: dependencies.executePlatformAction || (async () => ({
        status: 'error',
        error: { code: 'PLATFORM_ACTION_RUNTIME_NOT_CONFIGURED', message: 'O runtime de ações da Dialogy não está configurado.', retryable: false },
      })),
    })
    .register(agentHandler(dependencies))
    .register({ type: 'ai.studio_agent', stop: dependencies.stopStudioFlow, execute: dependencies.executeStudioFlow || (async () => ({ status: 'error', selectedOutput: 'error', error: { code: 'STUDIO_FLOW_ADAPTER_REQUIRED', message: 'Configure o runtime de composição do Studio.', retryable: false } })) })
    .register({ type: 'integration.studio_procedure', stop: dependencies.stopStudioFlow, execute: dependencies.executeStudioFlow || (async () => ({ status: 'error', selectedOutput: 'error', error: { code: 'STUDIO_FLOW_ADAPTER_REQUIRED', message: 'Configure o runtime de composição do Studio.', retryable: false } })) })
    .register({
      type: 'ai.published_agent',
      stop: dependencies.stopPublishedAgent,
      configSchema: z.object({ agentId: z.string().uuid(), releaseId: z.string().uuid(), outputKeys: z.array(z.string()).default([]) }).passthrough(),
      execute: async (input) => dependencies.executePublishedAgent ? dependencies.executePublishedAgent(input) : {
        status: 'error', selectedOutput: 'error', error: { code: 'STUDIO_ADAPTER_REQUIRED', message: 'Este bloco requer um atendimento conectado ao Estúdio de IA.', retryable: false },
      },
    })
    .register({
      type: 'ai.prompt',
      execute: dependencies.executePrompt || (async () => ({
        status: 'error',
        error: {
          code: 'PROMPT_RUNTIME_NOT_CONFIGURED',
          message: 'Prompt runtime dependency is not configured.',
          retryable: false,
        },
      })),
    })
    .register(dependencyHandler('logic.subflow', dependencies.executeSubflow, 'SUBFLOW_RUNTIME_NOT_CONFIGURED'))
    .register(dependencyHandler('state.load', dependencies.loadState, 'STATE_STORE_NOT_CONFIGURED'))
    .register(dependencyHandler('state.save', dependencies.saveState, 'STATE_STORE_NOT_CONFIGURED'))
    .register({
      type: 'output.respond',
      execute: async (input) => {
        if (!dependencies.sendResponse) {
          return {
            status: 'error',
            error: {
              code: 'RESPONSE_DELIVERY_NOT_CONFIGURED',
              message: 'Response delivery dependency is not configured.',
              retryable: false,
            },
          };
        }
        const source = sourceContext(input);
        const message = renderTemplate(String(input.node.config.message || '{{current.response}}'), source);
        const delivery = await dependencies.sendResponse(message, input);
        if (delivery.success === false) {
          return {
            status: 'error',
            error: {
              code: 'RESPONSE_DELIVERY_FAILED',
              message: typeof delivery.error === 'string'
                ? delivery.error
                : 'The response provider did not accept the message.',
              retryable: true,
            },
          };
        }
        return success({ ...input.input, message, delivery });
      },
    })
    .register({
      type: 'output.handoff',
      execute: async (input) => {
        if (!dependencies.handoff) {
          return {
            status: 'error',
            error: {
              code: 'HANDOFF_NOT_CONFIGURED',
              message: 'Handoff dependency is not configured.',
              retryable: false,
            },
          };
        }
        if (input.node.config.requireConfirmation === true) {
          const confirmationPath = String(input.node.config.confirmationPath || '').trim();
          const confirmed = confirmationPath ? readPath(sourceContext(input), confirmationPath) === true : false;
          if (!confirmed) {
            return {
              status: 'error', selectedOutput: 'error',
              error: { code: 'HANDOFF_CONFIRMATION_REQUIRED', message: 'A transferência exige confirmação explícita.', retryable: false },
            };
          }
        }
        const result = await dependencies.handoff(input);
        if (result.success === false) {
          const reasonCode = typeof result.reasonCode === 'string' ? result.reasonCode : '';
          const teamId = typeof result.teamId === 'string' ? result.teamId : '';
          const message = String(result.error || 'A transferência não foi concluída.');
          // Waiting is not failing. When the team is merely unavailable, the chat goes to its queue so the
          // customer is never left without an owner. An explicit error route keeps full control: the default
          // ('auto') only queues when the route would otherwise dead-end the execution, which is exactly how
          // the HANDOFF_FAILED executions ended. 'queue' always queues; 'error' never does.
          const mode = String(input.node.config.onUnavailable || 'auto');
          const hasErrorRoute = input.workflow.connections.some((connection) => (
            connection.sourceNodeId === input.node.id && connection.connectionType === 'error'
          ));
          const mayQueue = Boolean(dependencies.queueHandoff && reasonCode && teamId && result.outcomeUncertain !== true
            && (mode === 'queue' || (mode === 'auto' && !hasErrorRoute)) && isQueueableTeamReason(reasonCode));
          if (mayQueue) {
            try {
              const queued = await dependencies.queueHandoff!(input, { reasonCode, teamId, error: message });
              if (queued.queued === true) {
                return success({ ...result, ...queued, success: true, handoffQueued: true, queuedReason: reasonCode }, undefined, 'completed');
              }
            } catch (error) {
              // Fall through: the original failure is the honest result when even the queue is unavailable.
              console.error('[HANDOFF_QUEUE] Falha ao enfileirar:', error);
            }
          }
          return {
            status: 'error',
            selectedOutput: 'error',
            error: {
              code: 'HANDOFF_FAILED', message, retryable: false,
              ...(reasonCode ? { details: { reasonCode, teamId: teamId || null } } : {}),
            },
          };
        }
        return success(result, undefined, 'completed');
      },
    })
    .register({
      type: 'output.media',
      execute: async (input) => {
        if (!dependencies.sendMedia) {
          return {
            status: 'error',
            error: { code: 'MEDIA_DELIVERY_NOT_CONFIGURED', message: 'O canal atual não possui envio de mídia configurado.', retryable: false },
          };
        }
        const source = sourceContext(input);
        const media = {
          type: String(input.node.config.mediaType || 'image'),
          url: renderTemplate(String(input.node.config.url || ''), source),
          file: input.node.config.file ? materializeValue(input.node.config.file, source) : undefined,
          caption: renderTemplate(String(input.node.config.caption || ''), source),
          fileName: renderTemplate(String(input.node.config.fileName || ''), source),
          mimeType: renderTemplate(String(input.node.config.mimeType || ''), source),
        };
        if (!media.url && !media.file) {
          return { status: 'error', error: { code: 'MEDIA_URL_MISSING', message: 'A URL da mídia está vazia.', retryable: false } };
        }
        const delivery = await dependencies.sendMedia(media, input);
        if (delivery.success === false) {
          return { status: 'error', selectedOutput: 'error', error: { code: 'MEDIA_DELIVERY_FAILED', message: String(delivery.error || 'Falha ao enviar a mídia.'), retryable: true } };
        }
        return success({ ...input.input, media, delivery });
      },
    })
    .register({
      type: 'output.close_conversation',
      execute: async (input) => {
        if (!dependencies.closeConversation) {
          return {
            status: 'error',
            error: {
              code: 'CONVERSATION_CLOSE_NOT_CONFIGURED',
              message: 'Conversation close dependency is not configured.',
              retryable: false,
            },
          };
        }
        const result = await dependencies.closeConversation(input);
        if (result.success === false) {
          return { status: 'error', selectedOutput: 'error', error: { code: 'CONVERSATION_CLOSE_FAILED', message: String(result.error || 'O atendimento não foi encerrado.'), retryable: false } };
        }
        return success({
          ...input.input,
          ...result,
        }, undefined, 'completed');
      },
    })
    .register({
      type: 'output.end',
      execute: async (input) => ({
        status: 'completed',
        output: {
          ...input.input,
          ...(isRecord(input.node.config.output)
            ? materializeValue(input.node.config.output, sourceContext(input)) as Record<string, unknown>
            : {}),
        },
      }),
    })
    .register({
      type: 'output.redirect',
      execute: async (input) => ({
        status: 'completed',
        output: {
          ...input.input,
          redirectUrl: renderTemplate(String(input.node.config.url || ''), sourceContext(input)),
        },
      }),
    })
    .register({
      type: 'error.handler',
      execute: async (input) => {
        const mode = String(input.node.config.mode || 'fail');
        if (mode === 'recover') {
          return success({
            recovered: true,
            previousError: input.input.error,
          }, undefined, 'recovered');
        }
        return {
          status: 'route',
          selectedOutput: 'failed',
          error: {
            code: 'HANDLED_WORKFLOW_ERROR',
            message: String(input.node.config.publicMessage || 'Workflow execution failed.'),
            retryable: false,
            details: isRecord(input.input.error) ? input.input.error : undefined,
          },
        };
      },
    });

  for (const manifest of toolboxManifests()) {
    if (registry.get(manifest.type)) continue;
    registry.register({ type: manifest.type, execute: dependencies.executeToolbox || (async () => ({ status: 'error', error: { code: 'TOOLBOX_RUNTIME_NOT_CONFIGURED', message: 'Esta operação exige o runtime Nexus atualizado.', retryable: false } })) });
  }
  return registry;
}
