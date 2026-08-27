import { z } from 'zod';

import { ToolRegistry, type WorkflowNode } from '@/services/workflow-runtime';
import { isRecord } from '@/services/workflow-runtime/utils';

import { executeNexusDatabaseOperation } from './integration-executors';
import { executeNexusHttpOperation, type NexusHttpOperationInput } from './http-executor';
import { executeNexusMcpOperation, type NexusMcpOperationInput } from './mcp-executor';

function parseDataArgument(value: unknown): Record<string, unknown> {
  if (isRecord(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!isRecord(parsed)) throw new Error('O argumento data precisa ser um objeto JSON.');
    return parsed;
  } catch (error) {
    throw new Error(error instanceof SyntaxError ? 'O argumento data não contém JSON válido.' : String(error));
  }
}

function toolInputJsonSchema(node: WorkflowNode): Record<string, unknown> {
  if (isRecord(node.config.inputSchema) && node.config.inputSchema.type === 'object') return node.config.inputSchema;
  const operation = String(node.config.operation || 'select');
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  if (['select', 'update', 'delete'].includes(operation)) {
    properties.filter_column = { type: 'string', description: 'Coluna usada para limitar a operação.' };
    properties.filter_value = { description: 'Valor exato usado no filtro.' };
    if (['update', 'delete'].includes(operation)) required.push('filter_column', 'filter_value');
  }
  if (['insert', 'update'].includes(operation)) {
    properties.data = { type: 'object', description: 'Campos e valores a inserir ou atualizar.', additionalProperties: true };
    required.push('data');
  }
  return { type: 'object', properties, required, additionalProperties: false };
}

function configuredFilters(node: WorkflowNode, argumentsValue: Record<string, unknown>) {
  const filters = Array.isArray(node.config.filters)
    ? node.config.filters.filter(isRecord).map((filter) => ({ ...filter }))
    : [];
  const filterColumn = String(argumentsValue.filter_column || '').trim();
  if (filterColumn) filters.push({ column: filterColumn, operator: 'eq', value: argumentsValue.filter_value });
  if (Array.isArray(argumentsValue.filters)) {
    filters.push(...argumentsValue.filters.filter(isRecord).map((filter) => ({ ...filter })));
  }
  return filters;
}

export function createNexusToolRegistry(input: {
  workspaceId: string;
  toolNodes: WorkflowNode[];
  executeHttpOperation?: (input: NexusHttpOperationInput) => Promise<Record<string, unknown>>;
  executeMcpOperation?: (input: NexusMcpOperationInput) => Promise<Record<string, unknown>>;
}) {
  const registry = new ToolRegistry(({ definition }) => !definition.requiresConfirmation);
  for (const node of input.toolNodes) {
    if (!['tool.database', 'tool.http', 'tool.mcp'].includes(node.type)) continue;
    const name = String(node.config.name || '').trim();
    const description = String(node.config.description || '').trim();
    const credentialId = String(node.config.credentialId || '').trim();
    if (!name || !description || (node.type === 'tool.database' && !credentialId)) continue;

    if (node.type === 'tool.mcp') {
      const mcpExecutor = input.executeMcpOperation || executeNexusMcpOperation;
      const inputJsonSchema = isRecord(node.config.inputSchema) ? node.config.inputSchema : { type: 'object', properties: {} };
      const riskLevel = ['low', 'medium', 'high'].includes(String(node.config.riskLevel))
        ? String(node.config.riskLevel) as 'low' | 'medium' | 'high'
        : 'medium';
      registry.register({
        name,
        description,
        inputJsonSchema,
        inputSchema: z.object({}).catchall(z.unknown()),
        outputSchema: z.object({}).catchall(z.unknown()),
        timeoutMs: Math.max(1_000, Math.min(120_000, Number(node.config.timeoutMs || 30_000))),
        retryPolicy: {
          maxAttempts: riskLevel === 'low' ? 2 : 1,
          initialDelayMs: 250,
          backoffMultiplier: 2,
          maxDelayMs: 2_000,
          retryableErrorCodes: ['TIMEOUT', 'NETWORK_ERROR', 'UPSTREAM_UNAVAILABLE'],
        },
        idempotent: riskLevel === 'low' || node.config.idempotent === true,
        cacheResult: false,
        riskLevel,
        requiresConfirmation: node.config.requiresConfirmation === true || riskLevel !== 'low',
        permissionScope: riskLevel === 'low' ? undefined : 'automations:execute_sensitive_tool',
        maxOutputBytes: Math.max(1_024, Math.min(5_000_000, Number(node.config.maxOutputBytes || 1_000_000))),
        execute: async (argumentsValue, context) => mcpExecutor({
          workspaceId: input.workspaceId,
          qualifiedName: name,
          arguments: argumentsValue,
          confirmed: true,
          enforceConfirmation: false,
          maxOutputBytes: Number(node.config.maxOutputBytes || 1_000_000),
          signal: context.signal,
        }),
      });
      continue;
    }

    if (node.type === 'tool.http') {
      const method = String(node.config.method || 'GET').toUpperCase();
      const readOnly = ['GET', 'HEAD'].includes(method);
      const inputJsonSchema = isRecord(node.config.inputSchema) && node.config.inputSchema.type === 'object'
        ? node.config.inputSchema
        : { type: 'object', properties: {}, additionalProperties: true };
      const httpExecutor = input.executeHttpOperation || executeNexusHttpOperation;
      registry.register({
        name,
        description,
        inputJsonSchema,
        inputSchema: z.object({}).catchall(z.unknown()),
        outputSchema: z.object({}).catchall(z.unknown()),
        timeoutMs: Math.max(1_000, Math.min(120_000, Number(node.config.timeoutMs || 15_000))),
        retryPolicy: {
          maxAttempts: readOnly ? 2 : 1,
          initialDelayMs: 250,
          backoffMultiplier: 2,
          maxDelayMs: 2_000,
          retryableErrorCodes: ['TIMEOUT', 'TOOL_TIMEOUT', 'NETWORK_ERROR', 'RATE_LIMITED', 'UPSTREAM_UNAVAILABLE'],
        },
        idempotent: readOnly && node.config.idempotent !== false,
        cacheResult: readOnly && node.config.cacheResult === true,
        riskLevel: readOnly ? 'low' : 'high',
        requiresConfirmation: node.config.requiresConfirmation === true,
        permissionScope: 'integrations:http',
        maxOutputBytes: Math.max(1_024, Math.min(5_000_000, Number(node.config.maxResponseBytes || 1_000_000))),
        execute: async (argumentsValue, context) => httpExecutor({
          workspaceId: input.workspaceId,
          config: node.config,
          runtimeSource: {
            input: context.execution.input,
            current: argumentsValue,
            arguments: argumentsValue,
            variables: context.execution.variables,
            context: context.execution.context,
            nodeResults: context.execution.nodeResults,
          },
          signal: context.signal,
        }),
      });
      continue;
    }

    const operation = String(node.config.operation || 'select');
    const inputJsonSchema = toolInputJsonSchema(node);
    registry.register({
      name,
      description,
      inputJsonSchema,
      inputSchema: z.object({}).catchall(z.unknown()),
      outputSchema: z.object({}).catchall(z.unknown()),
      timeoutMs: Math.max(1_000, Math.min(120_000, Number(node.config.timeoutMs || 30_000))),
      retryPolicy: {
        maxAttempts: operation === 'select' ? 2 : 1,
        initialDelayMs: 250,
        backoffMultiplier: 2,
        maxDelayMs: 2_000,
        retryableErrorCodes: ['TIMEOUT', 'NETWORK_ERROR', 'UPSTREAM_UNAVAILABLE'],
      },
      idempotent: operation === 'select' || node.config.idempotent === true,
      cacheResult: false,
      riskLevel: operation === 'select' ? 'low' : 'high',
      requiresConfirmation: node.config.requiresConfirmation === true,
      permissionScope: 'database:execute',
      maxOutputBytes: Math.max(1_024, Math.min(5_000_000, Number(node.config.maxOutputBytes || 500_000))),
      execute: async (argumentsValue, context) => {
        const data = parseDataArgument(argumentsValue.data);
        const configuredValues = isRecord(node.config.values) ? node.config.values : {};
        return executeNexusDatabaseOperation({
          workspaceId: input.workspaceId,
          credentialId,
          config: {
            ...node.config,
            values: { ...configuredValues, ...data },
            filters: configuredFilters(node, argumentsValue),
          },
          runtimeSource: {
            input: context.execution.input,
            current: argumentsValue,
            arguments: argumentsValue,
            variables: context.execution.variables,
            context: context.execution.context,
            nodeResults: context.execution.nodeResults,
          },
        });
      },
    });
  }
  return registry;
}
