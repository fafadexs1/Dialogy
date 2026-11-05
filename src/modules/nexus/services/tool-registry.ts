import { z } from 'zod';

import { ToolRegistry, type WorkflowNode } from '@/services/workflow-runtime';
import { isRecord } from '@/services/workflow-runtime/utils';

import { executeNexusDatabaseOperation } from './integration-executors';
import { executeNexusHttpOperation, type NexusHttpOperationInput } from './http-executor';
import { executeNexusMcpOperation, type NexusMcpOperationInput } from './mcp-executor';
import { executeConnectorStep, loadConnector } from './connectors';
import { executeToolboxMedia } from './toolbox-media';
import { WorkflowFileReferenceSchema } from '@/services/workflow-runtime/file-reference';
import { googleAdsCampaignReport, googleAdsReportJsonSchema } from './google-ads-agent';

const fileReferenceJsonSchema = { type: 'object', properties: { kind: { type: 'string', enum: ['workflow_file'] }, id: { type: 'string' }, name: { type: 'string' }, mimeType: { type: 'string' }, size: { type: 'integer' } }, required: ['kind', 'id', 'name', 'mimeType', 'size'], additionalProperties: false };
const documentTools = {
  'tool.document_read': { name: 'read_document', description: 'Lê um arquivo privado deste workspace: PDF, DOC, DOCX, XLS, XLSX, PPTX, CSV, JSON ou texto.', schema: z.object({ file: WorkflowFileReferenceSchema }).strict(), jsonSchema: { type: 'object', properties: { file: fileReferenceJsonSchema }, required: ['file'], additionalProperties: false } },
  'tool.document_write': { name: 'generate_document', description: 'Cria arquivo privado PDF, DOCX, XLSX, PPTX, CSV, JSON ou texto. Para PDF ou DOCX use source.text; para XLSX/CSV uma lista de objetos; para PPTX source.slides com title e text.', schema: z.object({ format: z.enum(['pdf', 'docx', 'xlsx', 'pptx', 'csv', 'json', 'txt']), source: z.unknown(), fileName: z.string().min(1).max(200).optional() }).strict(), jsonSchema: { type: 'object', properties: { format: { type: 'string', enum: ['pdf', 'docx', 'xlsx', 'pptx', 'csv', 'json', 'txt'] }, source: {}, fileName: { type: 'string', maxLength: 200 } }, required: ['format', 'source'], additionalProperties: false } },
  'tool.audio_transcribe': { name: 'transcribe_audio', description: 'Transcreve um arquivo privado de áudio deste workspace.', schema: z.object({ file: WorkflowFileReferenceSchema }).strict(), jsonSchema: { type: 'object', properties: { file: fileReferenceJsonSchema }, required: ['file'], additionalProperties: false } },
  'tool.text_to_speech': { name: 'text_to_speech', description: 'Gera um arquivo privado de voz a partir de texto com a voz e credencial configuradas.', schema: z.object({ text: z.string().min(1).max(10000) }).strict(), jsonSchema: { type: 'object', properties: { text: { type: 'string', minLength: 1, maxLength: 10000 } }, required: ['text'], additionalProperties: false } },
} as const;
import { builtinAgentTools, executeBuiltinAgentTool } from './builtin-agent-tools';
import { mediaAgentTools, executeMediaAgentTool } from './media-agent-tools';

export function parseDataArgument(value: unknown): Record<string, unknown> {
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

export function toolInputJsonSchema(node: WorkflowNode): Record<string, unknown> {
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

export function configuredFilters(node: WorkflowNode, argumentsValue: Record<string, unknown>) {
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
    if (node.type === 'tool.google_ads_report') {
      registry.register({ name: 'google_ads_campaign_report', description: 'Consulta métricas diárias de campanhas da conta Google Ads autorizada, em período de até 31 dias.', inputJsonSchema: googleAdsReportJsonSchema,
        inputSchema: z.record(z.unknown()), outputSchema: z.record(z.unknown()), timeoutMs: 60000,
        retryPolicy: { maxAttempts: 1, initialDelayMs: 0, backoffMultiplier: 1, maxDelayMs: 0, retryableErrorCodes: [] },
        idempotent: true, cacheResult: false, riskLevel: 'low', requiresConfirmation: false,
        execute: async (args, context) => googleAdsCampaignReport(input.workspaceId, args, context.signal) });
      continue;
    }
    if (Object.hasOwn(documentTools, node.type)) {
      const type = node.type as keyof typeof documentTools;
      const definition = documentTools[type];
      registry.register({ name: definition.name, description: definition.description, inputJsonSchema: definition.jsonSchema,
        inputSchema: z.record(z.unknown()), outputSchema: z.record(z.unknown()), timeoutMs: 120000,
        retryPolicy: { maxAttempts: 1, initialDelayMs: 0, backoffMultiplier: 1, maxDelayMs: 0, retryableErrorCodes: [] },
        idempotent: false, cacheResult: false, riskLevel: 'low', requiresConfirmation: false,
        execute: async (args, context) => {
          const parsed = definition.schema.parse(args);
          const nodeType = type === 'tool.document_read' ? 'files.read' : type === 'tool.document_write' ? 'files.write' : type === 'tool.audio_transcribe' ? 'audio.transcribe' : 'audio.elevenlabs';
          const config = { ...parsed, ...(type === 'tool.text_to_speech' ? { voiceId: node.config.voiceId, modelId: node.config.modelId, credentialId: node.config.credentialId } : {}), outputKey: 'result' };
          const result = await executeToolboxMedia({ execution: context.execution, workflow: context.workflow, node: { ...node, type: nodeType, config }, input: {}, attachments: {}, signal: context.signal, emit: async () => undefined }, config);
          if (result.status !== 'success' || !result.output) throw new Error('Não foi possível processar o arquivo.');
          return result.output;
        } });
      continue;
    }
    if (Object.hasOwn(mediaAgentTools, node.type)) {
      const type = node.type as keyof typeof mediaAgentTools;
      const definition = mediaAgentTools[type];
      registry.register({ name: definition.name, description: definition.description, inputJsonSchema: definition.jsonSchema,
        inputSchema: z.record(z.unknown()), outputSchema: z.record(z.unknown()), timeoutMs: 95000,
        retryPolicy: { maxAttempts: 1, initialDelayMs: 0, backoffMultiplier: 1, maxDelayMs: 0, retryableErrorCodes: [] },
        idempotent: false, cacheResult: false, riskLevel: 'low', requiresConfirmation: false,
        execute: async (args, context) => executeMediaAgentTool(type, args, input.workspaceId, context.signal) });
      continue;
    }
    if (Object.hasOwn(builtinAgentTools, node.type)) {
      const type = node.type as keyof typeof builtinAgentTools;
      const definition = builtinAgentTools[type];
      registry.register({ name: definition.name, description: definition.description, inputJsonSchema: definition.jsonSchema,
        inputSchema: z.record(z.unknown()), outputSchema: z.record(z.unknown()), timeoutMs: 25000,
        retryPolicy: { maxAttempts: 1, initialDelayMs: 0, backoffMultiplier: 1, maxDelayMs: 0, retryableErrorCodes: [] },
        idempotent: true, cacheResult: false, riskLevel: 'low', requiresConfirmation: false,
        execute: async (args, context) => executeBuiltinAgentTool(type, args, context.signal) });
      continue;
    }
    if (!['tool.database', 'tool.http', 'tool.mcp', 'tool.connector'].includes(node.type)) continue;
    const name = String(node.config.name || '').trim();
    const description = String(node.config.description || '').trim();
    const credentialId = String(node.config.credentialId || '').trim();
    if (!name || !description || (node.type === 'tool.database' && !credentialId)) continue;
    if (node.type === 'tool.connector') {
      registry.register({ name, description, inputJsonSchema: isRecord(node.config.inputSchema) ? node.config.inputSchema : { type: 'object' }, inputSchema: z.record(z.unknown()), outputSchema: z.record(z.unknown()), timeoutMs: 120000,
        retryPolicy: { maxAttempts: 1, initialDelayMs: 0, backoffMultiplier: 1, maxDelayMs: 0, retryableErrorCodes: [] }, idempotent: false, riskLevel: 'high', requiresConfirmation: node.config.requiresConfirmation === true, permissionScope: 'integrations:http',
        execute: async (args, context) => {
          const published = await loadConnector(input.workspaceId, String(node.config.connectorId), Number(node.config.version));
          if (published.approval === 'required') throw new Error('Use este conector em um agente do Studio ou em uma etapa com aprovação.');
          const result = await executeConnectorStep({ execution: context.execution, workflow: context.workflow, node, input: args, attachments: {}, signal: context.signal, emit: async () => undefined }, context.idempotencyKey, args);
          if (result.status !== 'success') throw new Error(result.error?.message || 'A operação não foi concluída.');
          return result.output || {};
        } });
      continue;
    }

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
        requiresConfirmation: !readOnly || node.config.requiresConfirmation === true,
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
      requiresConfirmation: operation !== 'select' || node.config.requiresConfirmation === true,
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
