import { validateSchema } from 'genkit/schema';
import { z } from 'zod';
import {
  getAgentToolDefinition,
  type AgentToolDefinition,
} from '@/services/agent-tools/catalog';
import { runAgentTools } from '@/services/agent-tools/runtime';
import type {
  AgentToolAction,
  AgentToolName,
  AgentToolRuntimeContext,
} from '@/services/agent-tools/types';
import { ToolRegistry } from './tools';

export type AutopilotToolBridgeDefinition = Pick<
  AgentToolDefinition,
  | 'name'
  | 'description'
  | 'riskLevel'
  | 'idempotent'
  | 'timeoutMs'
  | 'maxAttempts'
  | 'requiresHumanApproval'
  | 'inputSchema'
  | 'outputSchema'
> & {
  name: AgentToolName;
};

function jsonObjectSchema(
  jsonSchema: Record<string, unknown> | null | undefined,
  label: string,
) {
  return z.record(z.unknown()).superRefine((value, context) => {
    if (!jsonSchema || Object.keys(jsonSchema).length === 0) return;
    const validation = validateSchema(value, { jsonSchema });
    if (validation.valid) return;
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: `${label} failed JSON schema validation.`,
    });
  });
}

function actionForTool(
  toolName: AgentToolName,
  argumentsValue: Record<string, unknown>,
): AgentToolAction {
  if (toolName.startsWith('mcp:')) {
    return {
      type: 'mcp_call_tool',
      reason: 'Solicitação do workflow runtime.',
      payload: {
        toolName,
        arguments: argumentsValue,
      },
    };
  }
  return {
    type: toolName,
    reason: 'Solicitação do workflow runtime.',
    payload: argumentsValue,
  } as AgentToolAction;
}

function resolveDefinition(
  toolName: AgentToolName,
  provided: Map<string, AutopilotToolBridgeDefinition>,
): AutopilotToolBridgeDefinition | null {
  const custom = provided.get(toolName);
  if (custom) return custom;
  if (toolName.startsWith('mcp:')) return null;
  return getAgentToolDefinition(toolName);
}

export function createAutopilotToolRegistry(input: {
  context: AgentToolRuntimeContext;
  toolNames: AgentToolName[];
  definitions?: AutopilotToolBridgeDefinition[];
}): ToolRegistry {
  // The existing Autopilot policy and durable claim remain the final authority.
  const registry = new ToolRegistry(() => true);
  const provided = new Map((input.definitions || []).map((definition) => [definition.name, definition]));

  for (const toolName of input.toolNames) {
    const definition = resolveDefinition(toolName, provided);
    if (!definition) continue;
    registry.register({
      name: toolName,
      description: definition.description,
      inputSchema: jsonObjectSchema(definition.inputSchema, `${toolName} input`),
      outputSchema: jsonObjectSchema(definition.outputSchema, `${toolName} output`),
      timeoutMs: definition.timeoutMs,
      retryPolicy: {
        maxAttempts: Math.max(1, definition.maxAttempts),
        initialDelayMs: 250,
        backoffMultiplier: 2,
        maxDelayMs: 5_000,
        retryableErrorCodes: ['TIMEOUT', 'NETWORK_ERROR', 'UPSTREAM_UNAVAILABLE'],
      },
      idempotent: definition.idempotent,
      riskLevel: definition.riskLevel,
      requiresConfirmation: definition.requiresHumanApproval,
      execute: async (argumentsValue) => {
        const [result] = await runAgentTools(input.context, [
          actionForTool(toolName, argumentsValue),
        ]);
        if (!result || result.status !== 'success') {
          const error = new Error(result?.error || `Tool ${toolName} failed.`) as Error & {
            code?: string;
            retryable?: boolean;
          };
          error.code = result?.status === 'rejected' ? 'TOOL_REJECTED' : 'TOOL_EXECUTION_FAILED';
          error.retryable = false;
          throw error;
        }
        return result.output && typeof result.output === 'object'
          ? result.output
          : {};
      },
    });
  }

  return registry;
}

