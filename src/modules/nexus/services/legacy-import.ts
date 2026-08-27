/**
 * Boundary for importing exported NexusFlow graphs into Dialogy's native
 * Workflow Runtime V2. Legacy AI credentials and runtimes are never retained.
 */
import { z } from 'zod';

import { createWorkflowNode, getWorkflowNodeManifest } from '@/services/workflow-runtime/catalog';
import { createNativeWorkflowTemplate } from '@/services/workflow-runtime/native-templates';
import { WorkflowDefinitionSchema } from '@/services/workflow-runtime/schemas';
import type {
  ConnectionType,
  ModelConfiguration,
  WorkflowDefinition,
  WorkflowNode,
  WorkflowValidationResult,
} from '@/services/workflow-runtime/types';
import { validateWorkflowDefinition } from '@/services/workflow-runtime/validator';

const LegacyNexusNodeSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  title: z.string().optional(),
  x: z.number().finite().optional(),
  y: z.number().finite().optional(),
}).passthrough();

const LegacyNexusConnectionSchema = z.object({
  id: z.string().min(1).optional(),
  from: z.string().min(1),
  to: z.string().min(1),
  sourceHandle: z.string().optional(),
  targetHandle: z.string().optional(),
}).passthrough();

export const LegacyNexusFlowSchema = z.object({
  version: z.string().optional(),
  name: z.string().optional(),
  nodes: z.array(LegacyNexusNodeSchema),
  connections: z.array(LegacyNexusConnectionSchema),
  settings: z.record(z.unknown()).optional(),
}).passthrough();

export type LegacyNexusFlow = z.infer<typeof LegacyNexusFlowSchema>;
type LegacyNexusNode = z.infer<typeof LegacyNexusNodeSchema>;

export type NexusImportWarning = {
  code:
    | 'legacy_ai_replaced'
    | 'legacy_secret_discarded'
    | 'manual_review_placeholder'
    | 'connection_not_migrated'
    | 'implicit_trigger_created';
  message: string;
  legacyNodeId?: string;
  legacyConnectionId?: string;
};

export type NexusImportReport = {
  sourceVersion: string | null;
  importedNodes: number;
  importedConnections: number;
  dialogyAiNodes: number;
  placeholders: number;
  discardedSecretFields: number;
  warnings: NexusImportWarning[];
  validation: WorkflowValidationResult;
};

export type ImportLegacyNexusFlowInput = {
  raw: unknown;
  workspaceId: string;
  configId: string;
  name: string;
  model: ModelConfiguration;
  mcpTools?: readonly NexusImportMcpTool[];
  now?: Date;
};

export type NexusImportMcpTool = {
  name: string;
  displayName?: string;
  serverId?: string;
  serverName?: string;
  inputSchema?: Record<string, unknown> | null;
  outputSchema?: Record<string, unknown> | null;
  riskLevel?: 'low' | 'medium' | 'high';
  requiresHumanApproval?: boolean;
  idempotent?: boolean;
  timeoutMs?: number;
};

export type NexusImportResult = {
  workflow: WorkflowDefinition;
  report: NexusImportReport;
};

type LegacyNodeMapping = {
  entryNodeId: string;
  exitNodeId: string;
  sourceRoutes?: (legacyHandle?: string) => Array<{ nodeId: string; portId: string }>;
  sourcePort: (legacyHandle?: string) => string | null;
  targetPort: (connectionType: ConnectionType, legacyHandle?: string) => string | null;
};

const LEGACY_AI_TYPES = new Set([
  'ai-text-generation',
  'intelligent-agent',
  'intention-router',
  'ai-model-config',
  'ai-memory-config',
]);

const LEGACY_SECRET_FIELDS = new Set([
  'aiApiKey',
  'aiKeyId',
  'apiAuthBearerToken',
  'apiAuthBasicPassword',
  'httpToolAuthKey',
  'httpToolAuthToken',
  'knowledgeConnectionString',
  'memoryConnectionString',
  'memoryRedisConnectionString',
  'sgpSecondCopyToken',
]);

function cleanId(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'node';
}

function nativeId(legacyId: string, suffix = '') {
  return `nexus_${cleanId(legacyId)}${suffix}`;
}

const WINDOWS_1252_BYTE_BY_CODE_POINT = new Map<number, number>([
  [0x20ac, 0x80], [0x201a, 0x82], [0x0192, 0x83], [0x201e, 0x84],
  [0x2026, 0x85], [0x2020, 0x86], [0x2021, 0x87], [0x02c6, 0x88],
  [0x2030, 0x89], [0x0160, 0x8a], [0x2039, 0x8b], [0x0152, 0x8c],
  [0x017d, 0x8e], [0x2018, 0x91], [0x2019, 0x92], [0x201c, 0x93],
  [0x201d, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97],
  [0x02dc, 0x98], [0x2122, 0x99], [0x0161, 0x9a], [0x203a, 0x9b],
  [0x0153, 0x9c], [0x017e, 0x9e], [0x0178, 0x9f],
]);

function legacyByte(character: string): number | undefined {
  const codePoint = character.codePointAt(0);
  if (codePoint === undefined) return undefined;
  return codePoint <= 0xff ? codePoint : WINDOWS_1252_BYTE_BY_CODE_POINT.get(codePoint);
}

function repairLegacyNexusTextLayer(value: string) {
  const characters = Array.from(value);
  let repaired = '';
  let changed = false;

  for (let index = 0; index < characters.length;) {
    const firstByte = legacyByte(characters[index]!);
    const continuationCount = firstByte !== undefined && firstByte >= 0xc2 && firstByte <= 0xdf
      ? 1
      : firstByte !== undefined && firstByte >= 0xe0 && firstByte <= 0xef
        ? 2
        : firstByte !== undefined && firstByte >= 0xf0 && firstByte <= 0xf4
          ? 3
          : 0;

    if (continuationCount > 0 && index + continuationCount < characters.length) {
      const bytes = [firstByte!];
      let validSequence = true;
      for (let offset = 1; offset <= continuationCount; offset += 1) {
        const byte = legacyByte(characters[index + offset]!);
        if (byte === undefined || byte < 0x80 || byte > 0xbf) {
          validSequence = false;
          break;
        }
        bytes.push(byte);
      }

      if (validSequence) {
        const encoded = Buffer.from(bytes);
        const decoded = encoded.toString('utf8');
        if (!decoded.includes('\uFFFD') && Buffer.from(decoded, 'utf8').equals(encoded)) {
          repaired += decoded;
          index += continuationCount + 1;
          changed = true;
          continue;
        }
      }
    }

    repaired += characters[index]!;
    index += 1;
  }

  return { repaired, changed };
}

export function repairLegacyNexusText(value: string): string {
  let repaired = value;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const layer = repairLegacyNexusTextLayer(repaired);
    repaired = layer.repaired;
    if (!layer.changed) break;
  }
  return repaired;
}

function repairLegacyNexusValue(value: unknown): unknown {
  if (typeof value === 'string') return repairLegacyNexusText(value);
  if (Array.isArray(value)) return value.map(repairLegacyNexusValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => [key, repairLegacyNexusValue(child)]));
  }
  return value;
}

function text(value: unknown, fallback = '') {
  return typeof value === 'string' ? repairLegacyNexusText(value) : fallback;
}

function normalizedResourceName(value: unknown) {
  return text(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function matchLegacyCapabilityTool(node: LegacyNexusNode, tools: readonly NexusImportMcpTool[]) {
  const legacyName = text(node.capabilityName).trim();
  if (!legacyName) return null;
  const direct = tools.find((tool) => tool.name === legacyName);
  if (direct) return direct;
  const normalizedLegacy = normalizedResourceName(legacyName);
  const candidates = tools.filter((tool) => {
    const technicalName = tool.name.split(':').at(-1) || tool.name;
    return [tool.name, technicalName, tool.displayName]
      .filter(Boolean)
      .some((value) => normalizedResourceName(value) === normalizedLegacy);
  });
  return candidates.length === 1 ? candidates[0]! : null;
}

function finite(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function positiveInteger(value: unknown, fallback: number, max: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(max, Math.round(parsed))) : fallback;
}

function recordList(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
    : [];
}

function legacyKeyValueRecord(value: unknown, excludedKeys: Set<string> = new Set()) {
  return Object.fromEntries(recordList(value)
    .map((item) => [text(item.key).trim(), item.value ?? ''] as const)
    .filter(([key]) => key && !excludedKeys.has(key.toLowerCase())));
}

function normalizeLegacyToolTemplate(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_.-]*)\s*\}\}/g, (_match, path: string) => {
      if (/^(current|arguments|input|variables|context|nodeResults)\./.test(path)) return `{{${path}}}`;
      return `{{current.${path}}}`;
    });
  }
  if (Array.isArray(value)) return value.map(normalizeLegacyToolTemplate);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => [key, normalizeLegacyToolTemplate(child)]));
  }
  return value;
}

function legacyToolInputSchema(...values: unknown[]) {
  const names = new Set<string>();
  const serialized = JSON.stringify(values);
  for (const match of serialized.matchAll(/\{\{\s*(?:current\.)?([a-zA-Z_][a-zA-Z0-9_-]*)/g)) {
    if (match[1]) names.add(match[1]);
  }
  return {
    type: 'object',
    properties: Object.fromEntries([...names].map((name) => [name, { type: 'string' }])),
    required: [...names],
    additionalProperties: false,
  };
}

function legacyVariablePath(value: unknown, fallback = '$.current') {
  const normalized = text(value)
    .trim()
    .replace(/^\{\{\s*/, '')
    .replace(/\s*\}\}$/, '')
    .replace(/^flow_variables\./, '')
    .replace(/^variables\./, '');
  return normalized ? `$.variables.${normalized}` : fallback;
}

function legacyOperator(value: unknown) {
  const operator = text(value, '==').toLowerCase();
  return ({
    '==': 'equals',
    '!=': 'not_equals',
    '>': 'greater_than',
    '>=': 'greater_or_equal',
    '<': 'less_than',
    '<=': 'less_or_equal',
    contains: 'contains',
    startswith: 'starts_with',
    endswith: 'ends_with',
    isempty: 'not_exists',
    isnotempty: 'exists',
    istrue: 'is_true',
    isfalse: 'is_false',
    isdateafter: 'date_after',
    isdatebefore: 'date_before',
  } as Record<string, string>)[operator] || 'equals';
}

function legacyDatabaseFilters(value: unknown) {
  const operators: Record<string, string> = {
    '=': 'eq',
    '!=': 'neq',
    '<>': 'neq',
    '>': 'gt',
    '>=': 'gte',
    '<': 'lt',
    '<=': 'lte',
    like: 'like',
    ilike: 'ilike',
    in: 'in',
    'is null': 'is_null',
    'is not null': 'not_null',
  };
  return recordList(value).map((filter) => ({
    column: text(filter.column),
    operator: operators[text(filter.operator, '=').toLowerCase()] || 'eq',
    value: filter.value ?? '',
  })).filter((filter) => filter.column);
}

function legacyDatabaseValues(value: unknown) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== 'string' || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function legacyCommaSeparatedList(value: unknown, fallback: string[] = []) {
  const raw = text(value).trim();
  if (!raw) return [...fallback];
  return raw.split(',').map((item) => item.trim()).filter(Boolean);
}

function legacyOptions(node: LegacyNexusNode) {
  const configured = recordList(node.options);
  if (configured.length > 0) {
    return configured.map((item, optionIndex) => ({
      id: cleanId(text(item.id, `option_${optionIndex + 1}`)),
      value: item.value ?? '',
      label: text(item.label || item.value, `Opção ${optionIndex + 1}`),
    }));
  }

  const raw = text(node.optionsList).trim();
  if (!raw) return [];
  let values: unknown[] | null = null;
  if (raw.startsWith('[') && raw.endsWith(']')) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) values = parsed;
    } catch { /* use the legacy separator rules below */ }
  }
  const normalized = (values || (
    raw.includes('\n')
      ? raw.split(/\r?\n/)
      : raw.includes('\\n')
        ? raw.split('\\n')
        : raw.includes(',')
          ? raw.split(',')
          : [raw]
  ))
    .map((value) => String(value ?? '').replace(/^[\[\s,]+|[\],\s]+$/g, '').trim())
    .filter(Boolean);
  return normalized.map((value, optionIndex) => ({
    id: `option_${optionIndex + 1}`,
    value,
    label: value,
  }));
}

function legacyGoogleSheetValues(value: unknown) {
  if (Array.isArray(value)) return value;
  const raw = text(value).trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function legacyGoogleSheetRange(node: LegacyNexusNode) {
  const explicitRange = text(node.googleSheetsRange || node.range).trim();
  if (explicitRange) return explicitRange;
  const sheetName = text(node.googleSheetName).trim();
  if (!sheetName) return 'Sheet1!A:Z';
  return sheetName.includes('!') ? sheetName : `${sheetName}!A:Z`;
}

function legacySupabaseFilter(node: LegacyNexusNode) {
  const column = text(node.supabaseIdentifierColumn).trim();
  const value = node.supabaseIdentifierValue;
  return column && value !== undefined && value !== null && String(value).trim()
    ? [{ column, operator: 'eq', value }]
    : [];
}

function defaultSourcePort(node: WorkflowNode, legacyHandle?: string) {
  const handle = text(legacyHandle).replace(/^out:/, '');
  const aliases = [
    handle,
    handle === 'otherwise' ? 'default' : '',
    handle === 'main' ? 'success' : '',
  ].filter(Boolean);
  for (const alias of aliases) {
    if (node.outputPorts.some((port) => port.id === alias)) return alias;
  }
  return node.outputPorts.find((port) => port.connectionType === 'main')?.id
    || node.outputPorts[0]?.id
    || null;
}

function defaultTargetPort(node: WorkflowNode, connectionType: ConnectionType, legacyHandle?: string) {
  const handle = text(legacyHandle).replace(/^in:/, '');
  const aliases = [handle, handle === 'tools' ? 'tools' : ''].filter(Boolean);
  for (const alias of aliases) {
    const port = node.inputPorts.find((candidate) => candidate.id === alias);
    if (port && port.connectionType === connectionType) return port.id;
  }
  return node.inputPorts.find((port) => port.connectionType === connectionType)?.id || null;
}

function mappingFor(node: WorkflowNode, entryNodeId = node.id, exitNodeId = node.id): LegacyNodeMapping {
  return {
    entryNodeId,
    exitNodeId,
    sourcePort: (handle) => defaultSourcePort(node, handle),
    targetPort: (connectionType, handle) => defaultTargetPort(node, connectionType, handle),
  };
}

function addConnection(
  definition: WorkflowDefinition,
  source: WorkflowNode,
  sourcePortId: string,
  target: WorkflowNode,
  targetPortId: string,
  connectionType: ConnectionType,
  id: string,
) {
  if (definition.connections.some((connection) => (
    connection.sourceNodeId === source.id
    && connection.sourcePortId === sourcePortId
    && connection.targetNodeId === target.id
    && connection.targetPortId === targetPortId
  ))) return false;
  definition.connections.push({
    id,
    sourceNodeId: source.id,
    sourcePortId,
    targetNodeId: target.id,
    targetPortId,
    connectionType,
  });
  return true;
}

function addDynamicMainOutput(node: WorkflowNode, id: string, label: string) {
  if (node.outputPorts.some((port) => port.id === id)) return;
  node.outputPorts.splice(Math.max(0, node.outputPorts.length - 1), 0, {
    id,
    label,
    direction: 'output',
    connectionType: 'main',
    required: false,
    multiple: false,
  });
}

function legacyPrompt(node: LegacyNexusNode) {
  if (node.type === 'option') return text(node.questionText, 'Escolha uma opção:');
  if (node.type === 'date-input') return text(node.dateInputLabel, 'Informe uma data:');
  if (node.type === 'file-upload') return text(node.uploadPromptText, 'Envie o arquivo solicitado:');
  if (node.type === 'rating-input') return text(node.ratingQuestionText, 'Como você avalia este atendimento?');
  return text(node.promptText, 'Envie a informação solicitada:');
}

function createInputSequence(
  definition: WorkflowDefinition,
  legacy: LegacyNexusNode,
  ensureErrorHandler: () => WorkflowNode,
) {
  const position = { x: finite(legacy.x, 0), y: finite(legacy.y, 0) };
  const prompt = createWorkflowNode('output.respond', {
    id: nativeId(legacy.id, '_prompt'),
    name: `${text(legacy.title, 'Entrada')} · solicitar`,
    position,
    config: { message: legacyPrompt(legacy), channel: 'source', idempotent: true },
  });
  const wait = createWorkflowNode('logic.wait', {
    id: nativeId(legacy.id, '_wait'),
    name: `${text(legacy.title, 'Entrada')} · aguardar`,
    position: { x: position.x + 280, y: position.y },
    config: {
      mode: 'event',
      resumeEvent: 'customer.message',
      timeoutMs: 86_400_000,
      outputVariable: text(
        legacy.variableToSaveResponse
          || legacy.variableToSaveDate
          || legacy.fileUrlVariable
          || legacy.ratingOutputVariable,
      ),
      legacyInputType: legacy.type,
    },
  });
  definition.nodes.push(prompt, wait);
  addConnection(definition, prompt, 'success', wait, 'main', 'main', `${prompt.id}_wait`);
  const errorHandler = ensureErrorHandler();
  addConnection(definition, prompt, 'error', errorHandler, 'error', 'error', `${prompt.id}_error`);
  return { prompt, wait };
}

function placeholderConfig(legacy: LegacyNexusNode) {
  return {
    assignments: {},
    migrationReview: {
      source: 'nexusflow_legacy',
      legacyNodeId: legacy.id,
      legacyType: legacy.type,
      reason: 'Este bloco não possui equivalente executável direto no runtime atual.',
    },
  };
}

export function importLegacyNexusFlow(input: ImportLegacyNexusFlowInput): NexusImportResult {
  const legacy = LegacyNexusFlowSchema.parse(repairLegacyNexusValue(input.raw));
  const now = input.now || new Date();
  const definition = createNativeWorkflowTemplate({
    configId: input.configId,
    workspaceId: input.workspaceId,
    name: input.name || legacy.name || 'Fluxo importado do Nexus',
    model: input.model,
    template: 'blank',
  });
  definition.nodes = [];
  definition.connections = [];
  definition.name = input.name || legacy.name || definition.name;
  definition.updatedAt = now.toISOString();
  definition.createdAt = now.toISOString();
  definition.metadata = {
    source: 'nexusflow_legacy_import',
    sourceVersion: legacy.version || null,
    importedAt: now.toISOString(),
    editorVersion: 2,
    configId: input.configId,
    aiRuntime: 'dialogy_native',
  };

  const warnings: NexusImportWarning[] = [];
  const nodeById = new Map<string, WorkflowNode>();
  const mappings = new Map<string, LegacyNodeMapping>();
  let placeholders = 0;
  let discardedSecretFields = 0;
  let connectionSequence = 0;

  for (const node of legacy.nodes) {
    for (const field of LEGACY_SECRET_FIELDS) {
      if (node[field] === undefined || node[field] === null || node[field] === '') continue;
      discardedSecretFields += 1;
      warnings.push({
        code: 'legacy_secret_discarded',
        legacyNodeId: node.id,
        message: `A credencial antiga "${field}" de "${text(node.title, node.type)}" não foi importada.`,
      });
    }
  }

  let errorHandler: WorkflowNode | null = null;
  const ensureErrorHandler = () => {
    if (errorHandler) return errorHandler;
    errorHandler = createWorkflowNode('error.handler', {
      id: 'nexus_import_error',
      name: 'Falha segura da automação',
      position: { x: 1280, y: 760 },
      config: {
        mode: 'fail',
        publicMessage: 'Não foi possível concluir esta etapa com segurança.',
      },
    });
    definition.nodes.push(errorHandler);
    nodeById.set(errorHandler.id, errorHandler);
    return errorHandler;
  };

  const legacyHasAi = legacy.nodes.some((node) => LEGACY_AI_TYPES.has(node.type));
  let dialogyModel: WorkflowNode | null = null;
  let dialogyMemory: WorkflowNode | null = null;
  let dialogyGuardrail: WorkflowNode | null = null;
  if (legacyHasAi) {
    dialogyModel = createWorkflowNode('ai.model', {
      id: 'nexus_dialogy_model',
      name: 'Modelo do Dialogy',
      position: { x: 20, y: 40 },
      config: input.model,
    });
    dialogyMemory = createWorkflowNode('memory.session', {
      id: 'nexus_dialogy_memory',
      name: 'Memória do Dialogy',
      position: { x: 20, y: 220 },
      config: {
        provider: 'dialogy',
        scope: 'hybrid',
        legacyScope: text(legacy.nodes.find((node) => node.type === 'ai-memory-config')?.memoryScope),
        maxMessages: 20,
        maxAgeDays: 180,
        maxEntries: 100,
        layers: ['turn_context', 'operational_state', 'contact_fact', 'case_memory'],
      },
    });
    dialogyGuardrail = createWorkflowNode('guardrail.policy', {
      id: 'nexus_dialogy_guardrail',
      name: 'Proteções do Dialogy',
      position: { x: 20, y: 400 },
      config: {
        name: 'Proteções do Dialogy',
        checks: ['no_secret_exposure', 'no_unconfirmed_tool_success'],
        onViolation: 'route_to_error',
      },
    });
    [dialogyModel, dialogyMemory, dialogyGuardrail].forEach((node) => {
      definition.nodes.push(node);
      nodeById.set(node.id, node);
    });
  }

  const remember = (legacyNode: LegacyNexusNode, node: WorkflowNode, mapping = mappingFor(node)) => {
    definition.nodes.push(node);
    nodeById.set(node.id, node);
    mappings.set(legacyNode.id, mapping);
    return node;
  };

  for (const [index, legacyNode] of legacy.nodes.entries()) {
    const position = {
      x: finite(legacyNode.x, 280 + (index % 4) * 300),
      y: finite(legacyNode.y, 100 + Math.floor(index / 4) * 220),
    };
    const name = text(legacyNode.title, legacyNode.type);
    const id = nativeId(legacyNode.id);
    let node: WorkflowNode;

    switch (legacyNode.type) {
      case 'start': {
        const triggers = recordList(legacyNode.triggers);
        const enabledTriggers = triggers.filter((trigger) => trigger.enabled !== false);
        const messageTriggers = enabledTriggers.filter((trigger) => trigger.type === 'webhook');
        const manualTriggers = enabledTriggers.filter((trigger) => trigger.type === 'manual');
        const legacyMessageTriggers = messageTriggers.length > 0
          ? messageTriggers
          : triggers.length === 0
            ? []
            : [];
        const selectedTriggers = legacyMessageTriggers.length > 0 ? legacyMessageTriggers : manualTriggers;
        const handleToPort = new Map<string, string>();
        const manualHandleToPort = new Map<string, string>();
        const usedPortIds = new Set<string>();
        const portForHandle = (handleValue: unknown) => {
          const handle = text(handleValue, 'message');
          const normalized = handle.toLocaleLowerCase('pt-BR');
          const existing = handleToPort.get(normalized);
          if (existing) return existing;
          const base = cleanId(handle);
          let outputId = base;
          let suffix = 2;
          while (usedPortIds.has(outputId)) {
            outputId = `${base}_${suffix}`;
            suffix += 1;
          }
          usedPortIds.add(outputId);
          handleToPort.set(normalized, outputId);
          return outputId;
        };
        let manualNode: WorkflowNode | null = null;
        if (legacyMessageTriggers.length > 0) {
          const keywords = legacyMessageTriggers.flatMap((trigger) => text(trigger.keyword)
            .split(',')
            .map((keyword) => keyword.trim())
            .filter(Boolean));
          const keywordThresholds = Object.fromEntries(legacyMessageTriggers.flatMap((trigger) => {
            const thresholds = trigger.keywordThresholds && typeof trigger.keywordThresholds === 'object' && !Array.isArray(trigger.keywordThresholds)
              ? trigger.keywordThresholds as Record<string, unknown>
              : {};
            return Object.entries(thresholds).map(([keyword, threshold]) => [keyword, Math.min(100, Math.max(0, Number(threshold) || 100))]);
          }));
          const defaultTrigger = legacyMessageTriggers.find((trigger) => !text(trigger.keyword).trim()) || legacyMessageTriggers[0]!;
          const defaultOutput = portForHandle(defaultTrigger.name || 'message');
          const keywordOutputPorts = Object.fromEntries(keywords.map((keyword) => [keyword, portForHandle(keyword)]));
          legacyMessageTriggers.forEach((trigger) => portForHandle(trigger.name || 'message'));
          const variableMappings = legacyMessageTriggers.flatMap((trigger) => recordList(trigger.variableMappings).map((mapping) => ({
            id: text(mapping.id, cleanId(`${mapping.jsonPath}_${mapping.flowVariable}`)),
            jsonPath: text(mapping.jsonPath),
            flowVariable: text(mapping.flowVariable),
          })).filter((mapping) => mapping.jsonPath && mapping.flowVariable));
          const sessionTimeoutSeconds = legacyMessageTriggers
            .map((trigger) => Number(trigger.sessionTimeoutSeconds))
            .find((seconds) => Number.isFinite(seconds) && seconds > 0);
          node = createWorkflowNode('trigger.received_message', {
            id,
            name,
            position,
            config: {
              matchMode: keywords.length > 0 ? 'any_keyword' : 'all',
              keywords,
              keywordThresholds,
              keywordOutputPorts,
              defaultOutput,
              fallbackToAnyMessage: legacyMessageTriggers.some((trigger) => !text(trigger.keyword).trim()),
              variableMappings,
              sessionTimeoutMs: sessionTimeoutSeconds ? sessionTimeoutSeconds * 1_000 : 86_400_000,
              platforms: [],
              instanceNames: [],
              messageTypes: ['text'],
              startPolicy: 'all',
              continueMatching: false,
              legacyTriggerNames: legacyMessageTriggers.map((trigger) => text(trigger.name)).filter(Boolean),
            },
          });
          node.outputPorts = [...handleToPort.entries()].map(([normalizedHandle, outputId]) => ({
            id: outputId,
            label: legacyMessageTriggers.map((trigger) => text(trigger.name)).concat(keywords)
              .find((handle) => handle.toLocaleLowerCase('pt-BR') === normalizedHandle) || outputId,
            direction: 'output' as const,
            connectionType: 'main' as const,
            required: false,
            multiple: false,
          }));
          if (manualTriggers.length > 0) {
            const manualPortForHandle = (handleValue: unknown) => {
              const handle = text(handleValue, 'started');
              const normalized = handle.toLocaleLowerCase('pt-BR');
              const existing = manualHandleToPort.get(normalized);
              if (existing) return existing;
              const base = cleanId(handle);
              let outputId = base;
              let suffix = 2;
              while ([...manualHandleToPort.values()].includes(outputId)) {
                outputId = `${base}_${suffix}`;
                suffix += 1;
              }
              manualHandleToPort.set(normalized, outputId);
              return outputId;
            };
            manualTriggers.forEach((trigger) => manualPortForHandle(trigger.name || 'started'));
            const defaultOutput = manualPortForHandle(manualTriggers[0]?.name || 'started');
            manualNode = createWorkflowNode('trigger.manual', {
              id: nativeId(legacyNode.id, '_manual'),
              name: `${name} · manual`,
              position: { x: position.x, y: position.y + 150 },
              config: { defaultOutput },
            });
            manualNode.outputPorts = [...manualHandleToPort.entries()].map(([normalizedHandle, outputId]) => ({
              id: outputId,
              label: manualTriggers.map((trigger) => text(trigger.name)).find((handle) => handle.toLocaleLowerCase('pt-BR') === normalizedHandle) || outputId,
              direction: 'output' as const,
              connectionType: 'main' as const,
              required: false,
              multiple: false,
            }));
          }
        } else if (selectedTriggers.length > 0) {
          selectedTriggers.forEach((trigger) => portForHandle(trigger.name || 'started'));
          const defaultOutput = portForHandle(selectedTriggers[0]?.name || 'started');
          node = createWorkflowNode('trigger.manual', { id, name, position, config: { defaultOutput } });
          node.outputPorts = [...handleToPort.entries()].map(([normalizedHandle, outputId]) => ({
            id: outputId,
            label: selectedTriggers.map((trigger) => text(trigger.name)).find((handle) => handle.toLocaleLowerCase('pt-BR') === normalizedHandle) || outputId,
            direction: 'output' as const,
            connectionType: 'main' as const,
            required: false,
            multiple: false,
          }));
        } else {
          node = createWorkflowNode('trigger.received_message', { id, name, position });
        }
        if (manualNode) {
          definition.nodes.push(manualNode);
          nodeById.set(manualNode.id, manualNode);
          definition.metadata = { ...definition.metadata, allowMultipleTriggers: true };
        }
        remember(legacyNode, node, {
          ...mappingFor(node),
          sourceRoutes: manualNode ? (handle) => {
            const normalized = text(handle).replace(/^out:/, '').toLocaleLowerCase('pt-BR');
            const messagePort = handleToPort.get(normalized);
            const manualPort = manualHandleToPort.get(normalized);
            const routes: Array<{ nodeId: string; portId: string }> = [];
            if (messagePort) routes.push({ nodeId: node.id, portId: messagePort });
            if (manualPort) routes.push({ nodeId: manualNode!.id, portId: manualPort });
            if (routes.length === 0 && !normalized) {
              const messageDefault = text(node.config.defaultOutput);
              const manualDefault = text(manualNode!.config.defaultOutput);
              if (messageDefault) routes.push({ nodeId: node.id, portId: messageDefault });
              if (manualDefault) routes.push({ nodeId: manualNode!.id, portId: manualDefault });
            }
            return routes;
          } : undefined,
          sourcePort: (handle) => {
            const normalized = text(handle).replace(/^out:/, '').toLocaleLowerCase('pt-BR');
            return handleToPort.get(normalized)
              || text(node.config.defaultOutput)
              || defaultSourcePort(node, handle);
          },
        });
        break;
      }
      case 'message':
      case 'dialogy-send-message': {
        node = createWorkflowNode('output.respond', {
          id,
          name,
          position,
          config: {
            channel: 'source',
            message: text(legacyNode.text || legacyNode.textMessage || legacyNode.dialogyMessageContent),
            idempotent: true,
          },
        });
        remember(legacyNode, node);
        break;
      }
      case 'whatsapp-text':
        remember(legacyNode, createWorkflowNode('whatsapp.send_text', {
          id,
          name,
          position,
          config: {
            instanceName: text(legacyNode.instanceName),
            phoneNumber: text(legacyNode.phoneNumber),
            message: text(legacyNode.textMessage || legacyNode.text),
            outputKey: 'whatsappMessage',
            permissionScope: 'whatsapp:messages:write',
          },
        }));
        break;
      case 'media-display': {
        remember(legacyNode, createWorkflowNode('output.media', {
          id,
          name,
          position,
          config: {
            mediaType: text(legacyNode.mediaDisplayType || legacyNode.mediaType, 'image'),
            url: text(legacyNode.mediaDisplayUrl || legacyNode.mediaUrl),
            caption: text(legacyNode.mediaDisplayText || legacyNode.caption),
            fileName: '',
          },
        }));
        break;
      }
      case 'whatsapp-media':
        remember(legacyNode, createWorkflowNode('whatsapp.send_media', {
          id,
          name,
          position,
          config: {
            instanceName: text(legacyNode.instanceName),
            phoneNumber: text(legacyNode.phoneNumber),
            mediaType: text(legacyNode.mediaType, 'image'),
            url: text(legacyNode.mediaUrl),
            caption: text(legacyNode.caption),
            fileName: '',
            mimeType: '',
            outputKey: 'whatsappMedia',
            permissionScope: 'whatsapp:messages:write',
          },
        }));
        break;
      case 'dialogy-close-chat':
        remember(legacyNode, createWorkflowNode('output.close_conversation', {
          id,
          name,
          position,
          config: {
            reason: 'Encerrado pelo fluxo importado do Nexus.',
            sendCloseMessage: false,
            closePolicy: 'deterministic_route',
          },
        }));
        break;
      case 'dialogy-transfer-team':
      case 'dialogy-transfer-ai':
        remember(legacyNode, createWorkflowNode('output.handoff', {
          id,
          name,
          position,
          config: {
            destinationType: legacyNode.type === 'dialogy-transfer-ai' ? 'intelligent_agent' : 'human',
            teamId: text(legacyNode.dialogyTeamId),
            agentId: '',
            systemAgentId: text(legacyNode.dialogySystemAgentId),
            reason: `Transferência solicitada pelo bloco legado ${legacyNode.type}.`,
            requireConfirmation: false,
            confirmationPath: '',
            permissionScope: 'automations:execute_handoff',
          },
        }));
        break;
      case 'end-flow':
        remember(legacyNode, createWorkflowNode('output.end', { id, name, position }));
        break;
      case 'set-variable':
        remember(legacyNode, createWorkflowNode('data.set', {
          id,
          name,
          position,
          config: {
            assignments: text(legacyNode.variableName)
              ? { [text(legacyNode.variableName)]: legacyNode.variableValue ?? '' }
              : {},
          },
        }));
        break;
      case 'json-transform':
        remember(legacyNode, createWorkflowNode('data.transform', {
          id,
          name,
          position,
          config: {
            mode: 'jsonata',
            mappings: {},
            expression: text(legacyNode.jsonataExpression),
            source: text(legacyNode.inputJson),
            outputKey: text(legacyNode.jsonOutputVariable, 'result'),
            evaluationTimeoutMs: 250,
          },
        }));
        break;
      case 'code-execution':
        remember(legacyNode, createWorkflowNode('data.code', {
          id,
          name,
          position,
          config: {
            language: 'javascript',
            source: text(legacyNode.codeSnippet, 'return input;'),
            outputKey: text(legacyNode.codeOutputVariable, 'result'),
            memoryLimitMb: 64,
            allowedResources: [],
            inputSchema: {},
            outputSchema: {},
            continueOnError: true,
          },
        }));
        break;
      case 'log-console':
        remember(legacyNode, createWorkflowNode('data.log', {
          id,
          name,
          position,
          config: { message: text(legacyNode.logMessage, '{{current}}'), level: 'info' },
        }));
        break;
      case 'go-to':
        remember(legacyNode, createWorkflowNode('logic.goto', {
          id,
          name,
          position,
          config: { targetNodeId: text(legacyNode.goToNodeId) ? nativeId(text(legacyNode.goToNodeId)) : '' },
        }));
        break;
      case 'api-call': {
        const sensitiveHeaderNames = new Set(['authorization', 'proxy-authorization', 'cookie', 'set-cookie', 'x-api-key']);
        const legacyHeaders = recordList(legacyNode.apiHeadersList);
        const headers = legacyKeyValueRecord(legacyHeaders, sensitiveHeaderNames);
        const query = Object.fromEntries(recordList(legacyNode.apiQueryParamsList)
          .map((item) => [text(item.key), item.value ?? ''] as const)
          .filter(([key]) => key));
        let body: unknown = {};
        if (legacyNode.apiBodyType === 'json' && text(legacyNode.apiBodyJson)) {
          try { body = JSON.parse(text(legacyNode.apiBodyJson)); } catch { body = text(legacyNode.apiBodyJson); }
        } else if (legacyNode.apiBodyType === 'form-data') {
          body = legacyKeyValueRecord(legacyNode.apiBodyFormDataList);
        } else if (legacyNode.apiBodyType === 'raw') body = text(legacyNode.apiBodyRaw);
        node = createWorkflowNode('integration.http_request', {
          id,
          name,
          position,
          config: {
            method: text(legacyNode.apiMethod, 'GET'),
            url: text(legacyNode.apiUrl),
            headers,
            query,
            bodyType: legacyNode.apiBodyType === 'raw'
              ? 'raw'
              : legacyNode.apiBodyType === 'form-data'
                ? 'form-data'
                : legacyNode.apiBodyType === 'none'
                  ? 'none'
                  : 'json',
            body,
            credentialId: '',
            outputKey: text(legacyNode.apiOutputVariable, 'response'),
            responsePath: text(legacyNode.apiResponsePath),
            responseMappings: recordList(legacyNode.apiResponseMappings).map((mapping) => ({
              jsonPath: text(mapping.jsonPath),
              flowVariable: text(mapping.flowVariable),
              extractAs: text(mapping.extractAs, 'single'),
              itemField: text(mapping.itemField),
            })).filter((mapping) => mapping.jsonPath && mapping.flowVariable),
            timeoutMs: 15_000,
            maxResponseBytes: 1_000_000,
            continueOnError: true,
          },
        });
        remember(legacyNode, node);
        const removedHeaderCount = legacyHeaders.length - Object.keys(headers).length;
        if (removedHeaderCount > 0) {
          discardedSecretFields += removedHeaderCount;
          warnings.push({
            code: 'legacy_secret_discarded',
            legacyNodeId: legacyNode.id,
            message: `Headers sensíveis de "${name}" foram removidos; selecione uma credencial protegida no Dialogy.`,
          });
        }
        break;
      }
      case 'send-email':
        remember(legacyNode, createWorkflowNode('integration.email', {
          id,
          name,
          position,
          config: {
            credentialId: '',
            from: text(legacyNode.emailFrom),
            to: text(legacyNode.emailTo),
            cc: text(legacyNode.emailCc),
            subject: text(legacyNode.emailSubject),
            text: text(legacyNode.emailBody),
            html: '',
            outputKey: 'email',
            permissionScope: 'integrations:execute',
          },
        }));
        break;
      case 'google-sheets-append':
        remember(legacyNode, createWorkflowNode('integration.google_sheets_append', {
          id,
          name,
          position,
          config: {
            credentialId: '',
            spreadsheetId: text(legacyNode.googleSheetId || legacyNode.googleSheetsSpreadsheetId || legacyNode.spreadsheetId),
            range: legacyGoogleSheetRange(legacyNode),
            values: legacyGoogleSheetValues(legacyNode.googleSheetRowData || legacyNode.googleSheetsValues),
            valueInputOption: 'USER_ENTERED',
            outputKey: 'sheetResult',
            permissionScope: 'integrations:execute',
          },
        }));
        break;
      case 'db-select':
      case 'db-insert':
      case 'db-update':
      case 'db-delete': {
        const operation = legacyNode.type.replace('db-', '');
        const legacyErrorMode = text(legacyNode.dbOnError, 'stop');
        remember(legacyNode, createWorkflowNode('integration.database', {
          id,
          name,
          position,
          config: {
            credentialId: '',
            operation,
            table: text(legacyNode.dbTable || legacyNode.dbTableName),
            columns: text(legacyNode.dbColumnsToSelect)
              ? text(legacyNode.dbColumnsToSelect).split(',').map((column) => column.trim()).filter(Boolean)
              : recordList(legacyNode.dbColumns).map((column) => text(column.name || column.key)).filter(Boolean),
            values: legacyDatabaseValues(legacyNode.dbValues || legacyNode.dbDataJson),
            filters: legacyDatabaseFilters(legacyNode.dbFilters),
            returning: [],
            limit: 100,
            outputKey: text(legacyNode.dbResultVariable || legacyNode.dbOutputVariable, 'databaseResult'),
            permissionScope: 'integrations:execute',
            legacyErrorMode,
            continueOnError: legacyErrorMode === 'continue',
            legacyErrorTargetNodeId: legacyErrorMode === 'goto' && text(legacyNode.dbOnErrorNodeId)
              ? nativeId(text(legacyNode.dbOnErrorNodeId))
              : '',
          },
        }));
        break;
      }
      case 'supabase-read-row':
      case 'supabase-create-row':
      case 'supabase-update-row':
      case 'supabase-delete-row': {
        const operation = ({
          'supabase-read-row': 'select',
          'supabase-create-row': 'insert',
          'supabase-update-row': 'update',
          'supabase-delete-row': 'delete',
        } as const)[legacyNode.type as 'supabase-read-row' | 'supabase-create-row' | 'supabase-update-row' | 'supabase-delete-row'];
        const selectedColumns = legacyCommaSeparatedList(legacyNode.supabaseColumnsToSelect, ['*']);
        remember(legacyNode, createWorkflowNode('integration.database', {
          id,
          name,
          position,
          config: {
            credentialId: '',
            operation,
            table: text(legacyNode.supabaseTableName),
            columns: operation === 'select' ? selectedColumns : ['*'],
            values: legacyDatabaseValues(legacyNode.supabaseDataJson),
            filters: legacySupabaseFilter(legacyNode),
            returning: operation === 'select' ? [] : selectedColumns,
            limit: 100,
            outputKey: text(legacyNode.supabaseResultVariable, 'databaseResult'),
            permissionScope: 'integrations:execute',
          },
        }));
        break;
      }
      case 'db-tool': {
        const operation = text(legacyNode.dbOperation, 'select');
        const inputProperties: Record<string, unknown> = {};
        const required: string[] = [];
        if (['select', 'update', 'delete'].includes(operation)) {
          inputProperties.filter_column = { type: 'string', description: 'Coluna usada para filtrar a operação.' };
          inputProperties.filter_value = { description: 'Valor usado no filtro.' };
          if (operation !== 'select') required.push('filter_column', 'filter_value');
        }
        if (['insert', 'update'].includes(operation)) {
          inputProperties.data = { type: 'object', description: 'Campos e valores da operação.', additionalProperties: true };
          required.push('data');
        }
        remember(legacyNode, createWorkflowNode('tool.database', {
          id,
          name,
          position,
          config: {
            name: text(legacyNode.dbToolName, `db_tool_${legacyNode.id.slice(0, 4)}`),
            description: text(legacyNode.dbToolDescription, `Operação ${operation} na tabela ${text(legacyNode.dbTableName, 'configurada')}.`),
            credentialId: '',
            operation,
            table: text(legacyNode.dbTableName || legacyNode.dbTable),
            columns: text(legacyNode.dbColumnsToSelect, '*').split(',').map((column) => column.trim()).filter(Boolean),
            values: legacyDatabaseValues(legacyNode.dbDataJson),
            filters: legacyDatabaseFilters(legacyNode.dbFilters),
            returning: [],
            limit: 100,
            inputSchema: { type: 'object', properties: inputProperties, required, additionalProperties: false },
            outputSchema: { type: 'object', additionalProperties: true },
            allowRawSql: false,
            idempotent: operation === 'select',
            requiresConfirmation: false,
            timeoutMs: 30_000,
            maxOutputBytes: 500_000,
            permissionScope: 'database:execute',
          },
        }));
        break;
      }
      case 'dialogy-update-crm':
        remember(legacyNode, createWorkflowNode('dialogy.crm_update', {
          id,
          name,
          position,
          config: {
            fields: Object.fromEntries(recordList(legacyNode.dialogyCrmFieldMappings).map((mapping) => [text(mapping.fieldKey), mapping.value ?? '']).filter(([key]) => key)),
            outputKey: 'updatedContact',
            permissionScope: 'crm:write',
          },
        }));
        break;
      case 'dialogy-sgp-contract-status':
        remember(legacyNode, createWorkflowNode('dialogy.sgp_contract_status', {
          id,
          name,
          position,
          config: {
            cpfCnpj: text(legacyNode.sgpContractStatusCpfCnpj),
            deliveryMode: text(legacyNode.sgpContractStatusDeliveryMode, 'list') === 'legacy' ? 'text' : 'list',
            timeoutMs: 86_400_000,
            outputKey: `_sgp_contract_status_${legacyNode.id.replace(/[^a-zA-Z0-9_]/g, '_')}`,
            permissionScope: 'sgp:read',
          },
        }));
        break;
      case 'dialogy-sgp-second-copy':
        remember(legacyNode, createWorkflowNode('dialogy.sgp_second_copy', {
          id,
          name,
          position,
          config: {
            cpfCnpj: text(legacyNode.sgpSecondCopyCpfCnpj),
            deliveryMode: text(legacyNode.sgpSecondCopyDeliveryMode, 'list') === 'legacy' ? 'text' : text(legacyNode.sgpSecondCopyDeliveryMode, 'list'),
            timeoutMs: 86_400_000,
            outputKey: `_sgp_payment_code_${legacyNode.id.replace(/[^a-zA-Z0-9_]/g, '_')}`,
            pixTemplateInstance: text(legacyNode.sgpSecondCopyPixTemplateInstance),
            pixTemplateName: text(legacyNode.sgpSecondCopyPixTemplateName),
            pixTemplateLanguage: text(legacyNode.sgpSecondCopyPixTemplateLanguage, 'pt_BR'),
            pixTemplateBodyParameter: Number(legacyNode.sgpSecondCopyPixTemplateBodyParameter || 1),
            pixTemplateBodyParameterCount: Number(legacyNode.sgpSecondCopyPixTemplateBodyParameterCount || 1),
            boletoTemplateInstance: text(legacyNode.sgpSecondCopyBoletoTemplateInstance),
            boletoTemplateName: text(legacyNode.sgpSecondCopyBoletoTemplateName),
            boletoTemplateLanguage: text(legacyNode.sgpSecondCopyBoletoTemplateLanguage, 'pt_BR'),
            boletoTemplateBodyParameter: Number(legacyNode.sgpSecondCopyBoletoTemplateBodyParameter || 1),
            boletoTemplateBodyParameterCount: Number(legacyNode.sgpSecondCopyBoletoTemplateBodyParameterCount || 1),
            permissionScope: 'sgp:read',
          },
        }));
        break;
      case 'dialogy-sgp-payment-promise':
        remember(legacyNode, createWorkflowNode('dialogy.sgp_payment_promise', {
          id,
          name,
          position,
          config: {
            cpfCnpj: text(legacyNode.sgpPaymentPromiseCpfCnpj),
            deliveryMode: text(legacyNode.sgpPaymentPromiseDeliveryMode, 'list') === 'legacy' ? 'text' : 'list',
            promiseDate: '',
            sendSms: true,
            timeoutMs: 86_400_000,
            outputKey: `_sgp_payment_promise_${legacyNode.id.replace(/[^a-zA-Z0-9_]/g, '_')}`,
            permissionScope: 'sgp:write',
          },
        }));
        break;
      case 'whatsapp-group':
        remember(legacyNode, createWorkflowNode('whatsapp.group_create', {
          id,
          name,
          position,
          config: {
            instanceName: text(legacyNode.instanceName),
            groupName: text(legacyNode.groupName),
            participants: text(legacyNode.participants).split(/[\n,;]+/).map((participant) => participant.trim()).filter(Boolean),
            outputKey: 'whatsappGroup',
            permissionScope: 'whatsapp:groups:write',
          },
        }));
        break;
      case 'condition': {
        const operator = legacyOperator(legacyNode.conditionOperator);
        const legacyConditionOperator = text(legacyNode.conditionOperator).toLowerCase();
        const right = legacyConditionOperator === 'istrue'
          ? true
          : legacyConditionOperator === 'isfalse'
            ? false
            : legacyNode.conditionValue ?? '';
        const dataType = ['string', 'number', 'boolean', 'date'].includes(text(legacyNode.conditionDataType).toLowerCase())
          ? text(legacyNode.conditionDataType).toLowerCase()
          : legacyConditionOperator === 'istrue' || legacyConditionOperator === 'isfalse'
            ? 'boolean'
            : legacyConditionOperator === 'isdateafter' || legacyConditionOperator === 'isdatebefore'
              ? 'date'
              : 'string';
        node = createWorkflowNode('logic.if', {
          id,
          name,
          position,
          config: {
            left: legacyVariablePath(legacyNode.conditionVariable),
            operator,
            right,
            dataType,
          },
        });
        remember(legacyNode, node);
        break;
      }
      case 'switch': {
        const cases = recordList(legacyNode.switchCases)
          .map((item, caseIndex) => ({
            output: cleanId(text(item.id, `case_${caseIndex + 1}`)),
            operator: 'equals',
            value: item.value ?? '',
            label: text(item.value, `Caso ${caseIndex + 1}`),
          }));
        node = createWorkflowNode('logic.switch', {
          id,
          name,
          position,
          config: {
            value: legacyVariablePath(legacyNode.switchVariable),
            cases: cases.map((item) => ({ output: item.output, operator: item.operator, value: item.value })),
            defaultOutput: 'default',
          },
        });
        cases.forEach((item) => addDynamicMainOutput(node, item.output, item.label));
        remember(legacyNode, node, {
          ...mappingFor(node),
          sourcePort: (handle) => {
            const normalized = text(handle) === 'otherwise' ? 'default' : cleanId(text(handle));
            return node.outputPorts.some((port) => port.id === normalized)
              ? normalized
              : defaultSourcePort(node, handle);
          },
        });
        break;
      }
      case 'delay':
      case 'typing-emulation': {
        node = createWorkflowNode('logic.wait', {
          id,
          name,
          position,
          config: {
            mode: 'time',
            timeoutMs: positiveInteger(
              legacyNode.type === 'typing-emulation' ? legacyNode.typingDuration : legacyNode.delayDuration,
              1_000,
              86_400_000,
            ),
            resumeEvent: '',
            showTyping: legacyNode.type === 'typing-emulation',
          },
        });
        remember(legacyNode, node, {
          ...mappingFor(node),
          sourcePort: () => 'expired',
        });
        break;
      }
      case 'input':
      case 'date-input':
      case 'file-upload':
      case 'rating-input': {
        const interactionType = legacyNode.type === 'date-input'
          ? 'interaction.date'
          : legacyNode.type === 'file-upload'
            ? 'interaction.file'
            : legacyNode.type === 'rating-input'
              ? 'interaction.rating'
              : 'interaction.input';
        const outputKey = legacyNode.type === 'date-input'
          ? text(legacyNode.variableToSaveDate, 'date')
          : legacyNode.type === 'file-upload'
            ? text(legacyNode.fileUrlVariable, 'file')
            : legacyNode.type === 'rating-input'
              ? text(legacyNode.ratingOutputVariable, 'rating')
              : text(legacyNode.variableToSaveResponse, 'answer');
        const configuredValidation = text(legacyNode.inputValidationType, 'none').replace('-', '_');
        const legacyInputType = text(legacyNode.inputType, 'text');
        const validation = legacyNode.type === 'date-input'
          ? 'date'
          : configuredValidation !== 'none'
            ? configuredValidation
            : ['email', 'phone', 'number'].includes(legacyInputType)
              ? legacyInputType
              : 'none';
        node = createWorkflowNode(interactionType, {
          id,
          name,
          position,
          config: {
            prompt: legacyPrompt(legacyNode),
            outputKey,
            validation,
            customRegex: text(legacyNode.customRegex),
            legacyApiResponseAsInput: legacyNode.apiResponseAsInput === true,
            legacyApiResponsePathForValue: text(legacyNode.apiResponsePathForValue),
            accept: text(legacyNode.fileTypeFilter, '*/*'),
            maxFileSizeMb: positiveInteger(legacyNode.maxFileSizeMB, 10, 100),
            minimum: 1,
            maximum: positiveInteger(legacyNode.maxRatingValue, 5, 10),
            icon: text(legacyNode.ratingIconType, 'star'),
            timeoutMs: 86_400_000,
          },
        });
        remember(legacyNode, node, {
          ...mappingFor(node),
          sourcePort: (handle) => text(handle) === 'expired' ? 'expired' : 'resumed',
        });
        break;
      }
      case 'option': {
        const options = legacyOptions(legacyNode);
        const hasCustomFallback = legacy.connections.some((connection) => (
          connection.from === legacyNode.id
          && ['default', 'otherwise'].includes(text(connection.sourceHandle).replace(/^out:/, ''))
        ));
        node = createWorkflowNode('interaction.options', {
          id,
          name,
          position,
          config: {
            prompt: text(legacyNode.questionText, 'Escolha uma opção:'),
            footer: text(legacyNode.optionFooterText),
            deliveryMode: text(legacyNode.optionDeliveryMode, 'list'),
            options,
            outputKey: text(legacyNode.variableToSaveChoice, 'choice'),
            timeoutMs: 86_400_000,
            customFallbackRoutes: hasCustomFallback,
            invalidOptionMessage: 'Opção inválida. Escolha uma das opções abaixo.',
            intelligentMatching: legacyNode.aiEnabled === true,
            intelligentMinimumConfidence: 0.65,
          },
        });
        options.forEach((item) => addDynamicMainOutput(node, item.id, item.label));
        remember(legacyNode, node, {
          ...mappingFor(node),
          sourcePort: (handle) => {
            const normalized = cleanId(text(handle));
            return node.outputPorts.some((port) => port.id === normalized)
              ? normalized
              : defaultSourcePort(node, handle);
          },
        });
        if (legacyNode.aiEnabled === true) {
          warnings.push({
            code: 'legacy_ai_replaced',
            legacyNodeId: legacyNode.id,
            message: `O reconhecimento inteligente de "${name}" agora usa o modelo e as credenciais nativas da Dialogy.`,
          });
        }
        break;
      }
      case 'time-of-day':
        node = createWorkflowNode('logic.time_window', {
          id,
          name,
          position,
          config: {
            startTime: text(legacyNode.startTime, '09:00'),
            endTime: text(legacyNode.endTime, '18:00'),
            timezone: text(legacyNode.timezone, 'America/Sao_Paulo'),
          },
        });
        remember(legacyNode, node, {
          ...mappingFor(node),
          sourcePort: (handle) => ['true', 'inside'].includes(text(handle)) ? 'inside' : ['false', 'outside'].includes(text(handle)) ? 'outside' : defaultSourcePort(node, handle),
        });
        break;
      case 'redirect':
        remember(legacyNode, createWorkflowNode('output.redirect', {
          id,
          name,
          position,
          config: { url: text(legacyNode.redirectUrl) },
        }));
        break;
      case 'intelligent-agent': {
        node = createWorkflowNode('ai.agent', {
          id,
          name,
          position,
          config: {
            name: text(legacyNode.agentName, name),
            role: text(legacyNode.agentRouteLock).toLowerCase(),
            persona: text(legacyNode.agentSystemPrompt),
            language: 'pt-BR',
            objective: 'Resolver a solicitação atual usando somente os recursos conectados no Dialogy.',
            instructions: [
              'Use somente as ferramentas e conhecimentos conectados.',
              'Não invente resultados de ferramentas nem informações ausentes.',
            ],
            completionCriteria: ['Responder, perguntar ou encaminhar a solicitação com segurança.'],
            availableContext: ['input', 'context', 'variables'],
            inputPath: legacyVariablePath(legacyNode.userInputVariable, '$.current'),
            inputVariable: text(legacyNode.userInputVariable).replace(/^\{\{\s*|\s*\}\}$/g, ''),
            outputKey: text(legacyNode.agentResponseVariable, 'agentResponse'),
            temperature: Math.min(2, Math.max(0, Number(legacyNode.temperature ?? 0.2))),
            legacyRouteLock: text(legacyNode.agentRouteLock, 'none').toUpperCase(),
            conversationMode: true,
            autoSendResponse: true,
            maxConversationTurns: positiveInteger(legacyNode.maxConversationTurns, 0, 100),
            conversationTimeoutMs: 86_400_000,
            maxTurns: 8,
            maxToolCalls: 20,
            maxRepeatedToolCalls: 2,
            timeoutMs: 120_000,
            modelTimeoutMs: 60_000,
            toolTimeoutMs: 30_000,
            allowParallelToolCalls: false,
            requireStructuredFinalOutput: false,
            fallbackOnToolError: 'route_to_error',
            onLimitReached: 'handoff',
          },
        });
        remember(legacyNode, node, {
          ...mappingFor(node),
          sourcePort: (handle) => {
            const normalized = text(handle).replace(/^out:/, '');
            return node.outputPorts.some((port) => port.id === normalized) ? normalized : 'completed';
          },
        });
        warnings.push({
          code: 'legacy_ai_replaced',
          legacyNodeId: legacyNode.id,
          message: `O agente "${name}" foi reconstruído sobre o runtime de IA do Dialogy.`,
        });
        break;
      }
      case 'ai-text-generation':
        node = createWorkflowNode('ai.prompt', {
          id,
          name,
          position,
          config: {
            prompt: text(legacyNode.aiPromptText),
            outputKey: text(legacyNode.aiOutputVariable, 'response'),
            structuredOutput: false,
            continueOnError: true,
          },
        });
        remember(legacyNode, node);
        warnings.push({
          code: 'legacy_ai_replaced',
          legacyNodeId: legacyNode.id,
          message: `A geração "${name}" agora usa o adapter e as credenciais de IA do Dialogy.`,
        });
        break;
      case 'intention-router': {
        const routes = recordList(legacyNode.intents).map((item, routeIndex) => ({
          id: cleanId(text(item.id, `route_${routeIndex + 1}`)),
          label: text(item.label, `Rota ${routeIndex + 1}`),
          description: text(item.description),
          examples: [],
        }));
        node = createWorkflowNode('logic.ai_router', {
          id,
          name,
          position,
          config: { routes, minimumConfidence: 0.75, lowConfidenceOutput: 'low_confidence', defaultOutput: 'default' },
        });
        routes.forEach((route) => addDynamicMainOutput(node, route.id, route.label));
        remember(legacyNode, node, {
          ...mappingFor(node),
          sourcePort: (handle) => {
            const normalized = cleanId(text(handle));
            return node.outputPorts.some((port) => port.id === normalized)
              ? normalized
              : defaultSourcePort(node, handle);
          },
        });
        warnings.push({
          code: 'legacy_ai_replaced',
          legacyNodeId: legacyNode.id,
          message: `O roteador "${name}" agora usa saída estruturada e modelos do Dialogy.`,
        });
        break;
      }
      case 'ai-model-config':
        if (dialogyModel) mappings.set(legacyNode.id, mappingFor(dialogyModel));
        warnings.push({
          code: 'legacy_ai_replaced',
          legacyNodeId: legacyNode.id,
          message: `O modelo legado "${name}" foi substituído pela seleção de modelos do workspace no Dialogy.`,
        });
        break;
      case 'ai-memory-config':
        if (dialogyMemory) mappings.set(legacyNode.id, mappingFor(dialogyMemory));
        warnings.push({
          code: 'legacy_ai_replaced',
          legacyNodeId: legacyNode.id,
          message: `A memória legada "${name}" foi substituída pela memória híbrida nativa da Dialogy; conexões externas não foram importadas.`,
        });
        break;
      case 'knowledge':
        remember(legacyNode, createWorkflowNode('knowledge.rag_retriever', {
          id,
          name,
          position,
          config: {
            documentIds: [],
            filters: {},
            legacyKnowledgeBaseId: text(legacyNode.knowledgeBaseId),
            maxDocuments: 8,
            minimumScore: 0.55,
            strategy: 'hybrid',
            rerank: true,
            tokenLimit: 6_000,
          },
        }));
        warnings.push({
          code: 'legacy_ai_replaced',
          legacyNodeId: legacyNode.id,
          message: `A base antiga "${name}" agora consulta a base de conhecimento nativa da Dialogy neste workspace.`,
        });
        break;
      case 'http-tool':
        {
          const sensitiveHeaderNames = new Set(['authorization', 'proxy-authorization', 'cookie', 'set-cookie', 'x-api-key']);
          const authKey = text(legacyNode.httpToolAuthKey).trim().toLowerCase();
          if (authKey) sensitiveHeaderNames.add(authKey);
          const headers = normalizeLegacyToolTemplate(legacyKeyValueRecord(legacyNode.httpToolHeaders, sensitiveHeaderNames));
          const query = normalizeLegacyToolTemplate(legacyKeyValueRecord(legacyNode.httpToolParams));
          const legacyBodyType = text(legacyNode.httpToolBodyType, 'none');
          const bodyType = legacyBodyType === 'text' ? 'raw' : legacyBodyType;
          const body = normalizeLegacyToolTemplate(bodyType === 'form-data'
            ? legacyKeyValueRecord(legacyNode.httpToolFormData)
            : text(legacyNode.httpToolBody));
          const method = text(legacyNode.httpToolMethod, 'GET').toUpperCase();
          const inputSchema = legacyToolInputSchema(headers, query, body, legacyNode.httpToolUrl);
          remember(legacyNode, createWorkflowNode('tool.http', {
          id,
          name,
          position,
          config: {
            name: text(legacyNode.httpToolName, cleanId(name).toLowerCase()),
            description: text(legacyNode.httpToolDescription),
            method,
            url: normalizeLegacyToolTemplate(text(legacyNode.httpToolUrl)),
            headers,
            query,
            bodyType,
            body,
            credentialId: '',
            responsePath: '',
            inputSchema,
            outputSchema: { type: 'object', additionalProperties: true },
            timeoutMs: 15_000,
            maxRequestBytes: 1_000_000,
            maxResponseBytes: 1_000_000,
            idempotent: ['GET', 'HEAD'].includes(method),
            cacheResult: false,
            requiresConfirmation: !['GET', 'HEAD'].includes(method),
            permissionScope: 'integrations:http',
          },
          }));
          const removedHeaderCount = recordList(legacyNode.httpToolHeaders).length - Object.keys(headers as Record<string, unknown>).length;
          if (removedHeaderCount > 0) {
            discardedSecretFields += removedHeaderCount;
            warnings.push({
              code: 'legacy_secret_discarded',
              legacyNodeId: legacyNode.id,
              message: `Headers sensíveis de "${name}" foram removidos; selecione uma credencial protegida no Dialogy.`,
            });
          }
        }
        break;
      case 'capability': {
        let capabilityArguments: unknown = { variables: '{{variables}}' };
        const legacyInput = text(legacyNode.capabilityInputJson).trim();
        if (legacyInput) {
          try { capabilityArguments = normalizeLegacyToolTemplate(JSON.parse(legacyInput)); } catch { capabilityArguments = { legacyInput }; }
        }
        const legacyToolName = text(legacyNode.capabilityName).trim();
        const matchedTool = matchLegacyCapabilityTool(legacyNode, input.mcpTools || []);
        const matchedRiskLevel = matchedTool?.riskLevel || 'medium';
        const requiresConfirmation = matchedTool
          ? matchedTool.requiresHumanApproval === true || matchedRiskLevel !== 'low'
          : true;
        remember(legacyNode, createWorkflowNode('integration.mcp_call', {
          id,
          name,
          position,
          config: {
            toolName: matchedTool?.name || (legacyToolName.startsWith('mcp:') ? legacyToolName : ''),
            serverId: matchedTool?.serverId || '',
            serverName: matchedTool?.serverName || '',
            legacyCapabilityId: text(legacyNode.capabilityId),
            legacyCapabilityName: legacyToolName,
            arguments: capabilityArguments,
            inputSchema: matchedTool?.inputSchema || {},
            outputSchema: matchedTool?.outputSchema || {},
            riskLevel: matchedRiskLevel,
            requiresConfirmation,
            confirmationPath: '', outputKey: text(legacyNode.capabilityOutputVariable, 'capabilityResult'),
            timeoutMs: matchedTool?.timeoutMs || 30_000,
            maxOutputBytes: 1_000_000,
            permissionScope: 'integrations:mcp',
            idempotent: matchedTool?.idempotent === true,
            continueOnError: true,
          },
        }));
        if (!matchedTool && !legacyToolName.startsWith('mcp:')) warnings.push({
          code: 'manual_review_placeholder', legacyNodeId: legacyNode.id,
          message: `A capability antiga "${name}" precisa ser vinculada a uma ferramenta MCP sincronizada da Dialogy.`,
        });
        break;
      }
      default:
        placeholders += 1;
        node = createWorkflowNode('data.set', {
          id,
          name: `[Revisar] ${name}`,
          position,
          config: placeholderConfig(legacyNode),
        });
        remember(legacyNode, node);
        warnings.push({
          code: 'manual_review_placeholder',
          legacyNodeId: legacyNode.id,
          message: `O bloco "${name}" (${legacyNode.type}) foi preservado como etapa neutra e exige revisão manual.`,
        });
        break;
    }
  }

  const getNode = (id: string) => nodeById.get(id) || definition.nodes.find((node) => node.id === id);
  for (const [index, legacyConnection] of legacy.connections.entries()) {
    const sourceMapping = mappings.get(legacyConnection.from);
    const targetMapping = mappings.get(legacyConnection.to);
    const target = targetMapping ? getNode(targetMapping.entryNodeId) : null;
    if (!sourceMapping || !targetMapping || !target) {
      warnings.push({
        code: 'connection_not_migrated',
        legacyConnectionId: legacyConnection.id,
        message: `A conexão ${legacyConnection.from} → ${legacyConnection.to} não pôde ser migrada.`,
      });
      continue;
    }
    const mappedRoutes = sourceMapping.sourceRoutes?.(legacyConnection.sourceHandle) || [];
    const defaultSource = getNode(sourceMapping.exitNodeId);
    const sourceRoutes = mappedRoutes.length > 0
      ? mappedRoutes.map((route) => ({ source: getNode(route.nodeId), requestedPort: route.portId }))
      : [{ source: defaultSource, requestedPort: sourceMapping.sourcePort(legacyConnection.sourceHandle) }];
    const compatibleSources = sourceRoutes.map(({ source, requestedPort }) => ({
      source,
      sourcePort: source?.outputPorts.find((port) => port.id === requestedPort)
        || source?.outputPorts.find((port) => port.connectionType === 'main'),
    })).filter((route): route is { source: WorkflowNode; sourcePort: WorkflowNode['outputPorts'][number] } => Boolean(route.source && route.sourcePort));
    if (compatibleSources.length === 0) {
      warnings.push({
        code: 'connection_not_migrated',
        legacyConnectionId: legacyConnection.id,
        message: `A conexão ${legacyConnection.from} → ${legacyConnection.to} não possui saída compatível.`,
      });
      continue;
    }
    for (const { source, sourcePort } of compatibleSources) {
      const targetPortId = targetMapping.targetPort(sourcePort.connectionType, legacyConnection.targetHandle);
      const targetPort = target.inputPorts.find((port) => port.id === targetPortId && port.connectionType === sourcePort.connectionType);
      if (!targetPort) {
        warnings.push({
          code: 'connection_not_migrated',
          legacyConnectionId: legacyConnection.id,
          message: `A conexão ${legacyConnection.from} → ${legacyConnection.to} tem tipos incompatíveis no runtime nativo.`,
        });
        continue;
      }
      addConnection(
        definition,
        source,
        sourcePort.id,
        target,
        targetPort.id,
        sourcePort.connectionType,
        `nexus_import_conn_${connectionSequence += 1}_${cleanId(legacyConnection.id || String(index))}`,
      );
      if (sourcePort.connectionType === 'error') {
        source.config = { ...source.config, customErrorRoute: true };
      }
    }
  }

  for (const legacyNode of legacy.nodes) {
    if (!['db-select', 'db-insert', 'db-update', 'db-delete'].includes(legacyNode.type)) continue;
    if (text(legacyNode.dbOnError) !== 'goto' || !text(legacyNode.dbOnErrorNodeId)) continue;
    const sourceMapping = mappings.get(legacyNode.id);
    const targetMapping = mappings.get(text(legacyNode.dbOnErrorNodeId));
    const source = sourceMapping ? getNode(sourceMapping.exitNodeId) : null;
    const target = targetMapping ? getNode(targetMapping.entryNodeId) : null;
    const sourcePort = source?.outputPorts.find((port) => port.connectionType === 'error');
    const targetPort = target?.inputPorts.find((port) => port.connectionType === 'main');
    if (!source || !target || !sourcePort || !targetPort) {
      warnings.push({
        code: 'connection_not_migrated',
        legacyNodeId: legacyNode.id,
        message: `A recuperação de banco configurada em "${text(legacyNode.title, legacyNode.type)}" aponta para um bloco inexistente ou incompatível.`,
      });
      continue;
    }

    definition.connections = definition.connections.filter((connection) => !(
      connection.sourceNodeId === source.id && connection.connectionType === 'error'
    ));
    const recovery = createWorkflowNode('error.handler', {
      id: `${source.id}_legacy_error_goto`,
      name: `Recuperar falha de ${text(legacyNode.title, legacyNode.type)}`,
      position: { x: source.position.x + 280, y: source.position.y + 180 },
      config: {
        mode: 'recover',
        publicMessage: 'A operação de banco falhou e o fluxo seguiu pela recuperação configurada.',
        legacyDbErrorGoto: true,
      },
    });
    definition.nodes.push(recovery);
    nodeById.set(recovery.id, recovery);
    source.config = { ...source.config, customErrorRoute: true };
    addConnection(
      definition,
      source,
      sourcePort.id,
      recovery,
      'error',
      'error',
      `${source.id}_legacy_error`,
    );
    addConnection(
      definition,
      recovery,
      'recovered',
      target,
      targetPort.id,
      'main',
      `${source.id}_legacy_error_recovered`,
    );
  }

  const aiNodes = definition.nodes.filter((node) => ['ai.agent', 'ai.prompt', 'logic.ai_router'].includes(node.type));
  for (const aiNode of aiNodes) {
    if (dialogyModel) {
      const targetPort = aiNode.inputPorts.find((port) => port.connectionType === 'model');
      if (targetPort) addConnection(definition, dialogyModel, 'model', aiNode, targetPort.id, 'model', `${aiNode.id}_dialogy_model`);
    }
    if (aiNode.type === 'ai.agent' && dialogyMemory) {
      const targetPort = aiNode.inputPorts.find((port) => port.connectionType === 'memory');
      if (targetPort) addConnection(definition, dialogyMemory, 'memory', aiNode, targetPort.id, 'memory', `${aiNode.id}_dialogy_memory`);
    }
    if (dialogyGuardrail) {
      const targetPort = aiNode.inputPorts.find((port) => port.connectionType === 'guardrail');
      if (targetPort) addConnection(definition, dialogyGuardrail, 'guardrail', aiNode, targetPort.id, 'guardrail', `${aiNode.id}_dialogy_guardrail`);
    }
  }

  if (!definition.nodes.some((node) => node.type.startsWith('trigger.'))) {
    const trigger = createWorkflowNode('trigger.manual', {
      id: 'nexus_import_trigger',
      name: 'Início da importação',
      position: { x: -280, y: 80 },
    });
    definition.nodes.push(trigger);
    nodeById.set(trigger.id, trigger);
    const mainIncomingTargets = new Set(definition.connections
      .filter((connection) => connection.connectionType === 'main')
      .map((connection) => connection.targetNodeId));
    const root = definition.nodes.find((node) => (
      node.id !== trigger.id
      && !getWorkflowNodeManifest(node.type)?.attachment
      && node.inputPorts.some((port) => port.connectionType === 'main')
      && !mainIncomingTargets.has(node.id)
    ));
    if (root) addConnection(definition, trigger, 'started', root, 'main', 'main', 'nexus_import_trigger_root');
    warnings.push({
      code: 'implicit_trigger_created',
      message: 'O arquivo não possuía um início compatível; foi criado um gatilho manual.',
    });
  }

  definition.metadata = {
    ...definition.metadata,
    nexusImport: {
      importedNodes: legacy.nodes.length,
      importedConnections: legacy.connections.length,
      placeholders,
      discardedSecretFields,
      warningCount: warnings.length,
    },
  };
  const parsed = WorkflowDefinitionSchema.parse(definition);
  const validation = validateWorkflowDefinition(parsed, { availableModelIds: [input.model.model] });
  return {
    workflow: parsed,
    report: {
      sourceVersion: legacy.version || null,
      importedNodes: legacy.nodes.length,
      importedConnections: parsed.connections.length,
      dialogyAiNodes: aiNodes.length,
      placeholders,
      discardedSecretFields,
      warnings,
      validation,
    },
  };
}

export function parseLegacyNexusFlowJson(json: string): unknown {
  try {
    return JSON.parse(json) as unknown;
  } catch {
    throw new Error('O arquivo selecionado não contém JSON válido.');
  }
}

export const convertLegacyNexusFlow = importLegacyNexusFlow;
export type LegacyNexusImportOptions = ImportLegacyNexusFlowInput;
export type LegacyNexusImportReport = NexusImportReport;
export type LegacyNexusImportResult = NexusImportResult;
