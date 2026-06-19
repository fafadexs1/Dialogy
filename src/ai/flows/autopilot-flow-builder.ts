import { genkit } from 'genkit';
import { googleAI } from '@genkit-ai/googleai';
import { z } from 'zod';

import { ai } from '@/ai/genkit';
import type { AutopilotFlowAiProposal, AutopilotFlowGraph, AutopilotFlowNodeKind } from '@/lib/types';
import type { AgentToolCatalogItem } from '@/services/agent-tools/catalog';
import { isLmStudioModel } from '@/services/ai/lm-studio';
import { requestLmStudioJson } from '@/services/ai/lm-studio-client';
import {
  V2_FLOW_NODE_KINDS,
  normalizeFlowNodeKindToV2,
  type V2FlowNodeKind,
} from '@/services/autopilot/flow-v2';

const FlowNodeKindSchema = z.enum(V2_FLOW_NODE_KINDS);

const FlowIntentSchema = z.enum([
  'greeting', 'human_handoff', 'purchase_inquiry', 'catalog_request', 'pricing_request',
  'promotion_request', 'availability_request', 'billing_or_payment', 'scheduling_request',
  'order_or_request_status', 'support_request', 'troubleshooting', 'change_request',
  'return_or_refund', 'cancellation_request', 'document_request', 'complaint', 'thanks', 'unknown',
]);

const ARCHITECTURE_FLOW_NODE_KINDS = [
  'start',
  'message',
  'collect',
  'decision',
  'knowledge',
  'sub_agent',
  'handoff',
  'end',
] as const satisfies readonly V2FlowNodeKind[];

const ArchitectureFlowNodeKindSchema = z.enum(ARCHITECTURE_FLOW_NODE_KINDS);

const FlowNodeSchema = z.object({
  id: z.string().min(1),
  kind: FlowNodeKindSchema,
  title: z.string().min(1),
  subtitle: z.string(),
  x: z.number(),
  y: z.number(),
  toolName: z.string().optional(),
  instructions: z.string().optional(),
  message: z.string().optional(),
  referenceId: z.string().optional(),
  variableName: z.string().optional(),
  intent: FlowIntentSchema.optional(),
  customIntentLabel: z.string().optional(),
  knowledgeCollectionIds: z.array(z.string()).max(128).optional(),
  requiredSlots: z.array(z.string()).max(32).optional(),
  inputSchema: z.record(z.unknown()).optional(),
  outputSchema: z.record(z.unknown()).optional(),
  successHandles: z.array(z.string()).max(16).optional(),
  errorHandles: z.array(z.string()).max(16).optional(),
  maxAttempts: z.number().int().min(1).max(12).optional(),
  requiredKnowledgeCoverage: z.enum(['high', 'medium', 'low', 'none']).optional(),
  switchMode: z.enum(['ai', 'rules']).optional(),
  confidenceThreshold: z.number().min(0).max(1).optional(),
  fallbackRouteId: z.string().optional(),
  routes: z.array(z.object({
    id: z.string().min(1),
    label: z.string().min(1),
    description: z.string().min(1),
    examples: z.array(z.string()).max(12).optional(),
    intent: FlowIntentSchema.optional(),
    requiredSlots: z.array(z.string()).max(32).optional(),
    targetNodeId: z.string().optional(),
  })).max(32).optional(),
  formFields: z.array(z.object({
    id: z.string().min(1),
    label: z.string().min(1),
    fieldKey: z.string().optional(),
    required: z.boolean().optional(),
    placeholder: z.string().optional(),
    type: z.enum(['text', 'name', 'phone', 'email', 'document', 'date', 'time', 'address', 'number', 'boolean']).optional(),
    aliases: z.array(z.string()).max(12).optional(),
  })).max(32).optional(),
  formMode: z.enum(['static', 'ai']).optional(),
});

const FlowEdgeSchema = z.object({
  source: z.string().min(1),
  target: z.string().min(1),
  routeId: z.string().optional(),
});

const FlowBuilderOutputSchema = z.object({
  summary: z.string().min(1),
  procedureManifest: z.string().optional(),
  systemPrompt: z.string().min(1),
  nodes: z.array(FlowNodeSchema).min(1).max(128),
  edges: z.array(FlowEdgeSchema).max(256),
});

type FlowBuilderOutput = z.infer<typeof FlowBuilderOutputSchema>;

const ArchitectureFlowNodeSchema = z.object({
  id: z.string().min(1),
  kind: ArchitectureFlowNodeKindSchema,
  title: z.string().min(1),
  subtitle: z.string(),
  x: z.number(),
  y: z.number(),
  referenceId: z.string().optional(),
  variableName: z.string().optional(),
  intent: FlowIntentSchema.optional(),
  customIntentLabel: z.string().optional(),
  knowledgeCollectionIds: z.array(z.string()).max(32).optional(),
  requiredSlots: z.array(z.string()).max(24).optional(),
  requiredKnowledgeCoverage: z.enum(['high', 'medium', 'low', 'none']).optional(),
  switchMode: z.enum(['ai', 'rules']).optional(),
  confidenceThreshold: z.number().min(0).max(1).optional(),
  fallbackRouteId: z.string().optional(),
  routes: z.array(z.object({
    id: z.string().min(1),
    label: z.string().min(1),
    description: z.string().min(1),
    examples: z.array(z.string()).max(6).optional(),
    intent: FlowIntentSchema.optional(),
    requiredSlots: z.array(z.string()).max(24).optional(),
    targetNodeId: z.string().optional(),
  })).max(16).optional(),
  formFields: z.array(z.object({
    id: z.string().min(1),
    label: z.string().min(1),
    fieldKey: z.string().optional(),
    required: z.boolean().optional(),
    placeholder: z.string().optional(),
    type: z.enum(['text', 'name', 'phone', 'email', 'document', 'date', 'time', 'address', 'number', 'boolean']).optional(),
    aliases: z.array(z.string()).max(6).optional(),
  })).max(24).optional(),
  formMode: z.enum(['static', 'ai']).optional(),
});

const ArchitectureFlowBuilderOutputSchema = z.object({
  summary: z.string().min(1),
  procedureManifest: z.string().optional(),
  systemPrompt: z.string().min(1),
  nodes: z.array(ArchitectureFlowNodeSchema).min(1).max(64),
  edges: z.array(FlowEdgeSchema).max(0),
});

type SanitizableFlowBuilderNode = Omit<z.infer<typeof FlowNodeSchema>, 'kind'> & {
  kind: AutopilotFlowNodeKind;
};

type SanitizableFlowBuilderOutput = Omit<FlowBuilderOutput, 'nodes'> & {
  nodes: SanitizableFlowBuilderNode[];
};

const FlowNodeEnrichmentSchema = z.object({
  id: z.string().min(1),
  instructions: z.string().min(1),
  message: z.string().optional(),
});

const FlowBuilderEnrichmentSchema = z.object({
  systemPrompt: z.string().min(1),
  nodes: z.array(FlowNodeEnrichmentSchema).min(1).max(128),
});

type FlowBuilderEnrichment = z.infer<typeof FlowBuilderEnrichmentSchema>;

const FlowBuilderTopologySchema = z.object({
  edges: z.array(FlowEdgeSchema).max(256),
});

const FlowBuilderToolSelectionSchema = z.object({
  tools: z.array(z.object({
    attachToNodeId: z.string().min(1),
    toolName: z.string().min(1),
    title: z.string().min(1),
    subtitle: z.string(),
    instructions: z.string().min(1),
  })).max(24),
});

const FlowBuilderValidationSchema = z.object({
  valid: z.boolean(),
  issues: z.array(z.string()).max(32),
  missingEdges: z.array(FlowEdgeSchema).max(32),
});

const jsonSchema = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    procedureManifest: { type: 'string' },
    systemPrompt: { type: 'string' },
    nodes: {
      type: 'array',
      maxItems: 128,
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          kind: { type: 'string', enum: V2_FLOW_NODE_KINDS },
          title: { type: 'string' },
          subtitle: { type: 'string' },
          x: { type: 'number' },
          y: { type: 'number' },
          toolName: { type: 'string' },
          instructions: { type: 'string' },
          message: { type: 'string' },
          referenceId: { type: 'string' },
          variableName: { type: 'string' },
          intent: { type: 'string', enum: FlowIntentSchema.options },
          customIntentLabel: { type: 'string' },
          knowledgeCollectionIds: { type: 'array', maxItems: 128, items: { type: 'string' } },
          requiredSlots: { type: 'array', maxItems: 32, items: { type: 'string' } },
          inputSchema: { type: 'object' },
          outputSchema: { type: 'object' },
          successHandles: { type: 'array', maxItems: 16, items: { type: 'string' } },
          errorHandles: { type: 'array', maxItems: 16, items: { type: 'string' } },
          maxAttempts: { type: 'number' },
          requiredKnowledgeCoverage: { type: 'string', enum: ['high', 'medium', 'low', 'none'] },
          switchMode: { type: 'string', enum: ['ai', 'rules'] },
          confidenceThreshold: { type: 'number' },
          fallbackRouteId: { type: 'string' },
          routes: {
            type: 'array',
            maxItems: 32,
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                label: { type: 'string' },
                description: { type: 'string' },
                examples: { type: 'array', maxItems: 32, items: { type: 'string' } },
                intent: { type: 'string', enum: FlowIntentSchema.options },
                requiredSlots: { type: 'array', maxItems: 32, items: { type: 'string' } },
                targetNodeId: { type: 'string' },
              },
              required: ['id', 'label', 'description'],
              additionalProperties: false,
            },
          },
          formMode: { type: 'string', enum: ['static', 'ai'] },
          formFields: {
            type: 'array',
            maxItems: 32,
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                label: { type: 'string' },
                fieldKey: { type: 'string' },
                required: { type: 'boolean' },
                placeholder: { type: 'string' },
                type: { type: 'string', enum: ['text', 'name', 'phone', 'email', 'document', 'date', 'time', 'address', 'number', 'boolean'] },
                aliases: { type: 'array', maxItems: 12, items: { type: 'string' } },
              },
              required: ['id', 'label'],
              additionalProperties: false,
            },
          },
        },
        required: ['id', 'kind', 'title', 'subtitle', 'x', 'y'],
        additionalProperties: false,
      },
    },
    edges: {
      type: 'array',
      maxItems: 256,
      items: {
        type: 'object',
        properties: {
          source: { type: 'string' },
          target: { type: 'string' },
          routeId: { type: 'string' },
        },
        required: ['source', 'target'],
        additionalProperties: false,
      },
    },
  },
  required: ['summary', 'systemPrompt', 'nodes', 'edges'],
  additionalProperties: false,
};

const architectureJsonSchema = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    procedureManifest: { type: 'string' },
    systemPrompt: { type: 'string' },
    nodes: {
      type: 'array',
      maxItems: 64,
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          kind: { type: 'string', enum: ARCHITECTURE_FLOW_NODE_KINDS },
          title: { type: 'string' },
          subtitle: { type: 'string' },
          x: { type: 'number' },
          y: { type: 'number' },
          referenceId: { type: 'string' },
          variableName: { type: 'string' },
          intent: { type: 'string', enum: FlowIntentSchema.options },
          customIntentLabel: { type: 'string' },
          knowledgeCollectionIds: { type: 'array', maxItems: 32, items: { type: 'string' } },
          requiredSlots: { type: 'array', maxItems: 24, items: { type: 'string' } },
          requiredKnowledgeCoverage: { type: 'string', enum: ['high', 'medium', 'low', 'none'] },
          switchMode: { type: 'string', enum: ['ai', 'rules'] },
          confidenceThreshold: { type: 'number' },
          fallbackRouteId: { type: 'string' },
          routes: {
            type: 'array',
            maxItems: 16,
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                label: { type: 'string' },
                description: { type: 'string' },
                examples: { type: 'array', maxItems: 6, items: { type: 'string' } },
                intent: { type: 'string', enum: FlowIntentSchema.options },
                requiredSlots: { type: 'array', maxItems: 24, items: { type: 'string' } },
                targetNodeId: { type: 'string' },
              },
              required: ['id', 'label', 'description'],
              additionalProperties: false,
            },
          },
          formMode: { type: 'string', enum: ['static', 'ai'] },
          formFields: {
            type: 'array',
            maxItems: 24,
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                label: { type: 'string' },
                fieldKey: { type: 'string' },
                required: { type: 'boolean' },
                placeholder: { type: 'string' },
                type: { type: 'string', enum: ['text', 'name', 'phone', 'email', 'document', 'date', 'time', 'address', 'number', 'boolean'] },
                aliases: { type: 'array', maxItems: 6, items: { type: 'string' } },
              },
              required: ['id', 'label'],
              additionalProperties: false,
            },
          },
        },
        required: ['id', 'kind', 'title', 'subtitle', 'x', 'y'],
        additionalProperties: false,
      },
    },
    edges: {
      type: 'array',
      maxItems: 0,
      items: {
        type: 'object',
        properties: {
          source: { type: 'string' },
          target: { type: 'string' },
          routeId: { type: 'string' },
        },
        required: ['source', 'target'],
        additionalProperties: false,
      },
    },
  },
  required: ['summary', 'systemPrompt', 'nodes', 'edges'],
  additionalProperties: false,
};

const enrichmentJsonSchema = {
  type: 'object',
  properties: {
    systemPrompt: { type: 'string' },
    nodes: {
      type: 'array',
      maxItems: 32,
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          instructions: { type: 'string' },
          message: { type: 'string' },
        },
        required: ['id', 'instructions'],
        additionalProperties: false,
      },
    },
  },
  required: ['systemPrompt', 'nodes'],
  additionalProperties: false,
};

const topologyJsonSchema = {
  type: 'object',
  properties: {
    edges: {
      type: 'array',
      maxItems: 256,
      items: {
        type: 'object',
        properties: {
          source: { type: 'string' },
          target: { type: 'string' },
          routeId: { type: 'string' },
        },
        required: ['source', 'target'],
        additionalProperties: false,
      },
    },
  },
  required: ['edges'],
  additionalProperties: false,
};

const toolSelectionJsonSchema = {
  type: 'object',
  properties: {
    tools: {
      type: 'array',
      maxItems: 24,
      items: {
        type: 'object',
        properties: {
          attachToNodeId: { type: 'string' },
          toolName: { type: 'string' },
          title: { type: 'string' },
          subtitle: { type: 'string' },
          instructions: { type: 'string' },
        },
        required: ['attachToNodeId', 'toolName', 'title', 'subtitle', 'instructions'],
        additionalProperties: false,
      },
    },
  },
  required: ['tools'],
  additionalProperties: false,
};

const validationJsonSchema = {
  type: 'object',
  properties: {
    valid: { type: 'boolean' },
    issues: { type: 'array', maxItems: 32, items: { type: 'string' } },
    missingEdges: {
      type: 'array',
      maxItems: 32,
      items: {
        type: 'object',
        properties: {
          source: { type: 'string' },
          target: { type: 'string' },
        },
        required: ['source', 'target'],
        additionalProperties: false,
      },
    },
  },
  required: ['valid', 'issues', 'missingEdges'],
  additionalProperties: false,
};

function normalizeId(value: string, fallback: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72) || fallback;
}

function cleanText(value: string | undefined, maxLength: number) {
  return String(value || '').trim().slice(0, maxLength);
}

function cleanPromptText(value: string | undefined, maxLength: number) {
  return cleanText(value, maxLength)
    .replace(/@referenceId\s*:\s*@?([a-zA-Z0-9_:-]+)/gi, '@$1')
    .replace(/@referenceId\s+@?([a-zA-Z0-9_:-]+)/gi, '@$1');
}

function normalizeReferenceKey(value: string) {
  return normalizeId(value, '').replace(/-/g, '_');
}

function canonicalizePromptReferences(value: string | undefined, references: Map<string, string>, maxLength: number) {
  return cleanPromptText(value, maxLength).replace(/@([a-zA-Z0-9_:-]+)/g, (mention, alias: string) => {
    const canonical = references.get(normalizeReferenceKey(alias));
    return canonical ? `@${canonical}` : mention;
  });
}

function distanceBetween(left: { position: { x: number; y: number } }, right: { position: { x: number; y: number } }) {
  return Math.hypot(left.position.x - right.position.x, left.position.y - right.position.y);
}

function canConnect(sourceKind: AutopilotFlowNodeKind, targetKind: AutopilotFlowNodeKind) {
  if (sourceKind === 'knowledge' || targetKind === 'knowledge') {
    return sourceKind === 'knowledge' && targetKind === 'sub_agent';
  }
  if (sourceKind === 'tool' || targetKind === 'tool') {
    if (targetKind === 'tool') {
      return sourceKind === 'collect'
        || sourceKind === 'message'
        || sourceKind === 'sub_agent';
    }
    if (sourceKind === 'tool') {
      return targetKind === 'collect'
        || targetKind === 'message'
        || targetKind === 'sub_agent'
        || targetKind === 'handoff'
        || targetKind === 'end';
    }
  }
  return isAllowedV2LinearConnection(sourceKind, targetKind);
}

function isAllowedV2LinearConnection(sourceKind: AutopilotFlowNodeKind, targetKind: AutopilotFlowNodeKind) {
  if (!V2_FLOW_NODE_KINDS.includes(sourceKind as V2FlowNodeKind)) return false;
  if (!V2_FLOW_NODE_KINDS.includes(targetKind as V2FlowNodeKind)) return false;
  if (sourceKind === 'end' || sourceKind === 'handoff') return false;
  if (targetKind === 'start') return false;
  return true;
}

function defaultNodeInstructions(node: {
  kind: V2FlowNodeKind;
  title: string;
  subtitle: string;
  toolName?: string;
}, relatedTitles: string[]) {
  const relation = relatedTitles.length > 0 ? ` Relaciona-se com: ${relatedTitles.join(', ')}.` : '';
  switch (node.kind) {
    case 'start':
      return `Inicie este fluxo quando ocorrer: ${node.title}. Encaminhe para o primeiro passo operacional conectado, sem pular etapas.${relation}`.trim();
    case 'message':
      return `Envie a mensagem configurada e avance para o proximo no conectado somente depois deste passo.${relation}`;
    case 'decision':
      return `Escolha somente uma das rotas configuradas. Use fallback quando a confianca for baixa ou faltar evidencia.${relation}`;
    case 'collect':
      return `Colete os slots tipados desta etapa, reaproveite dados ja informados e nao repita perguntas ja respondidas.${relation}`;
    case 'sub_agent':
      return `Atue como sub-agente V2 especializado nesta etapa. Responda somente dentro do escopo, use slots confirmados, tools e knowledge recuperado, e avance pelo proximo no conectado.${relation}`;
    case 'end':
      return `Finalize a execucao somente quando o objetivo do fluxo tiver sido concluido ou a transferencia humana tiver sido acionada.${relation}`;
    case 'knowledge':
      return `Consulte a base de conhecimento para obter informacoes relevantes antes de responder. Use somente fatos recuperados e nao invente dados.${relation}`;
    case 'tool':
      return `Use a ferramenta ${node.toolName || node.title} somente quando a etapa conectada exigir sua execucao. Monte o payload conforme o schema disponivel e nao execute sem os dados obrigatorios.${relation}`;
    case 'handoff':
      return `Transfira o atendimento somente quando o criterio desta etapa estiver atendido.${relation}`;
  }
}

function defaultNodeMessage(node: {
  kind: V2FlowNodeKind;
  title: string;
  subtitle: string;
}): string | undefined {
  switch (node.kind) {
    case 'message':
      return node.subtitle?.trim() || node.title?.trim() || 'Mensagem configurada.';
    case 'collect':
      return 'Para seguir, me informe os dados solicitados.';
    case 'knowledge':
      return '{{customerMessage}}';
    case 'sub_agent':
      return 'Componha uma resposta natural seguindo as instrucoes deste bloco e usando somente contexto permitido.';
    case 'handoff':
      return 'Vou transferir voce para um atendente humano. Aguarde um momento, por favor.';
    case 'end':
      return 'Obrigado pelo contato! Se precisar de algo mais, estou a disposicao. Ate logo!';
    default:
      return undefined;
  }
}

function isSafeFallbackKind(kind: AutopilotFlowNodeKind) {
  return kind === 'message'
    || kind === 'collect'
    || kind === 'sub_agent'
    || kind === 'handoff'
    || kind === 'end';
}

function fallbackNodeIdForDecision(decisionId: string) {
  return normalizeId(`fallback-${decisionId}`, 'fallback-seguro');
}

function fallbackRouteForDecision() {
  return {
    id: 'fallback',
    label: 'Esclarecer mudanca de assunto',
    description: 'Fallback seguro para baixa confianca, mudanca de assunto ou pergunta fora do procedimento. Pede esclarecimento antes de avancar.',
    examples: [
      'Tenho outra duvida',
      'Quero falar de outro assunto',
      'Nao era isso',
      'E uma pergunta fora desse procedimento',
    ],
  };
}

export function sanitizeAutopilotFlowProposal(output: SanitizableFlowBuilderOutput, tools: AgentToolCatalogItem[]): AutopilotFlowAiProposal {
  const availableToolNames = new Set<string>(tools.map((tool) => tool.name));
  const usedIds = new Set<string>();
  const usedReferenceIds = new Set<string>();
  const nodeByOriginalId = new Map<string, string>();
  const nodes = output.nodes.flatMap((node, index) => {
    const idBase = normalizeId(node.id, `bloco-${index + 1}`);
    let id = idBase;
    let suffix = 2;
    while (usedIds.has(id)) id = `${idBase}-${suffix++}`;
    usedIds.add(id);
    nodeByOriginalId.set(node.id, id);

    if (node.kind === 'tool' && (!node.toolName || !availableToolNames.has(node.toolName))) return [];
    let kind: V2FlowNodeKind = normalizeFlowNodeKindToV2(node.kind);
    const referenceBase = normalizeId(node.referenceId || id, id).replace(/-/g, '_');
    let referenceId = referenceBase;
    let referenceSuffix = 2;
    while (usedReferenceIds.has(referenceId)) referenceId = `${referenceBase}_${referenceSuffix++}`;
    usedReferenceIds.add(referenceId);
    const knowledgeCollectionIds = node.knowledgeCollectionIds?.map((value) => normalizeId(value, '')).filter(Boolean) || [];
    const instructions = cleanPromptText(node.instructions, 2400)
      || (kind === 'sub_agent'
        ? `Atenda especificamente esta etapa: "${cleanText(node.title, 100) || 'sub-agente'}". ${cleanText(node.subtitle, 140)}`
        : undefined);
    return [{
      id,
      kind,
      title: cleanText(node.title, 100) || 'Bloco',
      subtitle: cleanText(node.subtitle, 140),
      position: { x: Math.round(node.x), y: Math.round(node.y) },
      ...(node.kind === 'tool' ? { toolName: node.toolName } : {}),
      config: {
        instructions,
        message: cleanPromptText(node.message, 2400)
          || defaultNodeMessage({ kind, title: cleanText(node.title, 100) || 'Bloco', subtitle: cleanText(node.subtitle, 140) }),
        referenceId,
        variableName: normalizeId(node.variableName || `resultado-${id}`, `resultado-${id}`).replace(/-/g, '_'),
        requiredSlots: (node.requiredSlots || []).map((slot) => normalizeId(slot, '')).filter(Boolean),
        inputSchema: node.inputSchema,
        outputSchema: node.outputSchema,
        successHandles: (node.successHandles || []).map((handle) => normalizeId(handle, '')).filter(Boolean),
        errorHandles: (node.errorHandles || []).map((handle) => normalizeId(handle, '')).filter(Boolean),
        maxAttempts: typeof node.maxAttempts === 'number' ? Math.max(1, Math.min(12, Math.round(node.maxAttempts))) : undefined,
        requiredKnowledgeCoverage: node.requiredKnowledgeCoverage,
        ...(kind === 'sub_agent' ? {
          customIntentLabel: cleanText(node.customIntentLabel, 180) || cleanText(node.title, 100),
          knowledgeCollectionIds: knowledgeCollectionIds.length > 0 ? knowledgeCollectionIds : undefined,
          useAi: true,
          requiredKnowledgeCoverage: node.requiredKnowledgeCoverage || 'low',
        } : {}),
        ...(kind === 'decision' ? {
          switchMode: (node as any).switchMode || 'ai',
          confidenceThreshold: typeof (node as any).confidenceThreshold === 'number' ? (node as any).confidenceThreshold : 0.8,
          fallbackRouteId: (node as any).fallbackRouteId ? normalizeId((node as any).fallbackRouteId, '') : undefined,
          routes: ((node as any).routes as any[])?.map((route: any) => {
            return {
              id: normalizeId(route.id, ''),
              label: cleanText(route.label, 80) || 'Rota',
              description: cleanText(route.description, 240) || 'Descricao da rota',
              examples: (route.examples as string[])?.map((ex: string) => cleanText(ex, 140)).filter(Boolean) || [],
              intent: route.intent,
              requiredSlots: (route.requiredSlots as string[])?.map((slot: string) => normalizeId(slot, '')).filter(Boolean) || [],
              targetNodeId: route.targetNodeId,
            };
          }).filter((route: any) => route.id) || [],
        } : {}),
        ...(kind === 'collect' ? {
          formMode: (node as any).formMode || 'ai',
          formFields: ((node as any).formFields as any[])?.map((field: any) => ({
            id: normalizeId(field.id, ''),
            label: cleanText(field.label, 80) || 'Campo',
            fieldKey: field.fieldKey ? normalizeId(field.fieldKey, '') : undefined,
            required: typeof field.required === 'boolean' ? field.required : true,
            placeholder: cleanText(field.placeholder, 120) || undefined,
            type: field.type,
            aliases: (field.aliases as string[])?.map((alias: string) => cleanText(alias, 60)).filter(Boolean) || undefined,
          })).filter(f => f.id) || [],
        } : {}),
        ...(kind === 'knowledge' ? {
          knowledgeCollectionIds: knowledgeCollectionIds.length > 0 ? knowledgeCollectionIds : undefined,
          requiredKnowledgeCoverage: node.requiredKnowledgeCoverage || 'medium',
        } : {}),
      },
    }];
  });

  if (!nodes.some((node) => node.kind === 'sub_agent')) {
    nodes.push({
      id: 'sub-agente-principal',
      kind: 'sub_agent',
      title: 'Sub-agente principal',
      subtitle: 'Responder com IA V2',
      position: { x: 420, y: 340 },
      config: {
        instructions: 'Atenda o cliente nesta etapa usando somente dados confirmados, tools conectadas e knowledge recuperado.',
        message: 'Componha uma resposta natural e segura para o cliente.',
        referenceId: 'sub_agente_principal',
        variableName: 'resposta_ia',
        requiredSlots: [],
        inputSchema: undefined,
        outputSchema: undefined,
        successHandles: [],
        errorHandles: [],
        maxAttempts: undefined,
        requiredKnowledgeCoverage: undefined,
      },
    });
  }

  const canonicalReferences = new Map<string, string>();
  for (const node of nodes) {
    const canonical = node.config.referenceId;
    for (const alias of [node.id, node.title, canonical, node.config.variableName, node.toolName]) {
      const key = normalizeReferenceKey(alias || '');
      if (key && !canonicalReferences.has(key)) canonicalReferences.set(key, canonical);
    }
  }
  for (const node of nodes) {
    node.config.instructions = canonicalizePromptReferences(node.config.instructions, canonicalReferences, 2400) || undefined;
    node.config.message = canonicalizePromptReferences(node.config.message, canonicalReferences, 2400) || undefined;
  }
  // Sanitize routes targetNodeId in decision nodes.
  for (const node of nodes) {
    if (node.kind === 'decision' && (node.config as any).routes) {
      (node.config as any).routes = ((node.config as any).routes as any[]).map((route: any) => {
        let target = route.targetNodeId ? nodeByOriginalId.get(route.targetNodeId) : undefined;
        if (!target) {
          // Heuristic repair: search for any node in the graph matching the route ID/label
          const rId = normalizeId(route.id, '').toLowerCase();
          const rLabel = (route.label || '').toLowerCase();
          
          if (rId.includes('plano') || rLabel.includes('plano')) {
            const match = nodes.find((n) => n.id.includes('plano') || n.title.toLowerCase().includes('plano'));
            if (match) target = match.id;
          } else if (rId.includes('duvida') || rLabel.includes('duvida') || rId.includes('faq')) {
            const match = nodes.find((n) => n.id.includes('vendas') || n.id.includes('assistente') || n.title.toLowerCase().includes('raquel'));
            if (match) target = match.id;
          } else if (rId.includes('humano') || rLabel.includes('humano') || rId.includes('atendente')) {
            const match = nodes.find((n) => n.id.includes('transbordo') || n.id.includes('humano') || n.kind === 'handoff');
            if (match) target = match.id;
          }
        }
        return {
          ...route,
          targetNodeId: target,
        };
      });
    }
  }

  for (const node of nodes) {
    if (node.kind !== 'decision') continue;
    const routes = (((node.config as any).routes || []) as any[]).filter((route) => route.id);
    const configuredFallbackRouteId = normalizeId((node.config as any).fallbackRouteId || '', '');
    const fallbackRouteId = configuredFallbackRouteId || 'fallback';
    let fallbackRoute = configuredFallbackRouteId
      ? routes.find((route) => route.id === configuredFallbackRouteId)
      : routes.find((route) => {
        const id = normalizeId(route.id, '');
        const text = `${route.label || ''} ${route.description || ''}`;
        return /^(fallback|outro|esclarecer|esclarecimento|fora_do_escopo|baixa_confianca)$/.test(id)
          || /\b(fallback|fora do procedimento|fora do escopo|mudanca de assunto|baixa confianca)\b/i.test(text);
      });

    if (!fallbackRoute) {
      fallbackRoute = {
        ...fallbackRouteForDecision(),
        id: fallbackRouteId,
      };
      routes.push(fallbackRoute);
    }

    let fallbackTarget = fallbackRoute.targetNodeId && nodes.find((candidate) => candidate.id === fallbackRoute.targetNodeId)
      ? fallbackRoute.targetNodeId
      : undefined;
    const existingFallbackTarget = fallbackTarget ? nodes.find((candidate) => candidate.id === fallbackTarget) : null;

    if (!existingFallbackTarget || !isSafeFallbackKind(existingFallbackTarget.kind)) {
      const fallbackIdBase = fallbackNodeIdForDecision(node.id);
      let fallbackId = fallbackIdBase;
      let suffix = 2;
      while (nodes.some((candidate) => candidate.id === fallbackId)) fallbackId = `${fallbackIdBase}-${suffix++}`;
      nodes.push({
        id: fallbackId,
        kind: 'message',
        title: `Fallback seguro - ${node.title}`,
        subtitle: 'Mudanca de assunto ou pergunta fora do procedimento',
        position: { x: node.position.x + 260, y: node.position.y + 220 },
        config: {
          instructions: 'Responda com seguranca quando o cliente mudar de assunto ou a intencao estiver fora do procedimento. Nao execute ferramentas nem avance para rotas sensiveis sem nova classificacao.',
          message: 'Posso te ajudar com isso tambem. Para eu seguir pelo caminho certo, me diga em poucas palavras qual assunto voce quer tratar agora?',
          referenceId: normalizeReferenceKey(fallbackId),
          variableName: normalizeReferenceKey(`resultado-${fallbackId}`),
          requiredSlots: [],
          inputSchema: undefined,
          outputSchema: undefined,
          successHandles: ['next'],
          errorHandles: [],
          maxAttempts: 2,
          requiredKnowledgeCoverage: undefined,
        },
      });
      fallbackTarget = fallbackId;
    }

    fallbackRoute.targetNodeId = fallbackTarget;
    (node.config as any).fallbackRouteId = fallbackRoute.id;
    (node.config as any).routes = routes.map((route) => (
      route.id === fallbackRoute.id
        ? { ...route, targetNodeId: fallbackTarget }
        : route
    ));
    node.config.errorHandles = Array.from(new Set([...(node.config.errorHandles || []), fallbackRoute.id]));
  }

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const seenEdges = new Set<string>();
  const edges = output.edges.flatMap((edge, index) => {
    const source = nodeByOriginalId.get(edge.source) || normalizeId(edge.source, '');
    const target = nodeByOriginalId.get(edge.target) || normalizeId(edge.target, '');
    const sourceNode = nodeById.get(source);
    const targetNode = nodeById.get(target);
    const key = `${source}:${target}`;
    if (!sourceNode || !targetNode || source === target || seenEdges.has(key) || !canConnect(sourceNode.kind, targetNode.kind)) return [];
    seenEdges.add(key);
    return [{
      id: `ia-${index + 1}-${source}-${target}`.slice(0, 120),
      source,
      target,
      routeId: edge.routeId ? normalizeId(edge.routeId, '') : undefined,
    }];
  });

  // Automatically add missing edges for decision routes.
  for (const node of nodes) {
    if (node.kind === 'decision' && (node.config as any).routes) {
      for (const route of (node.config as any).routes) {
        if (route.targetNodeId) {
          const key = `${node.id}:${route.targetNodeId}`;
          if (!seenEdges.has(key)) {
            seenEdges.add(key);
            edges.push({
              id: `ia-switch-${node.id}-${route.targetNodeId}-${route.id}`.slice(0, 120),
              source: node.id,
              target: route.targetNodeId,
              routeId: route.id,
            });
          }
        }
      }
    }
  }

  const agentNodes = nodes.filter((node) => node.kind === 'sub_agent');
  const nearestAgent = (node: (typeof nodes)[number]) => agentNodes
    .filter((candidate) => candidate.id !== node.id)
    .sort((left, right) => distanceBetween(node, left) - distanceBetween(node, right))[0];
  for (const node of nodes) {
    const mustAttachToAgent = node.kind === 'knowledge' || node.kind === 'tool';
    if (!mustAttachToAgent) continue;
    const hasValidAttachment = edges.some((edge) => (
      node.kind === 'knowledge'
        ? edge.source === node.id && agentNodes.some((candidate) => candidate.id === edge.target)
        : edge.target === node.id && (agentNodes.some((candidate) => candidate.id === edge.source) || ['collect'].includes(nodeById.get(edge.source)?.kind || ''))
    ));
    if (hasValidAttachment) continue;
    const target = nearestAgent(node);
    if (!target) continue;
    const sourceId = node.kind === 'knowledge' ? node.id : target.id;
    const targetId = node.kind === 'knowledge' ? target.id : node.id;
    const key = `${sourceId}:${targetId}`;
    if (seenEdges.has(key)) continue;
    seenEdges.add(key);
    edges.push({
      id: `ia-reparo-${sourceId}-${targetId}`.slice(0, 120),
      source: sourceId,
      target: targetId,
      routeId: undefined,
    });
  }

  for (const node of nodes) {
    const relatedTitles = edges
      .filter((edge) => edge.source === node.id || edge.target === node.id)
      .map((edge) => nodeById.get(edge.source === node.id ? edge.target : edge.source)?.title)
      .filter((title): title is string => Boolean(title));
    node.config.instructions = node.config.instructions
      || defaultNodeInstructions(node, relatedTitles);
  }

  const enabledToolNames = nodes
    .filter((node) => node.kind === 'tool' && node.toolName)
    .map((node) => node.toolName as string);

  return {
    summary: cleanText(output.summary, 1200),
    procedureManifest: cleanText(output.procedureManifest || output.summary, 4000),
    systemPrompt: canonicalizePromptReferences(output.systemPrompt, canonicalReferences, 24000),
    enabledToolNames: [...new Set(enabledToolNames)],
    flowGraph: { version: 1, nodes, edges, variables: [] },
  };
}

function buildPrompt(input: {
  conversation: Array<{ role: 'user' | 'assistant'; content: string }>;
  currentGraph?: AutopilotFlowGraph | null;
  currentSystemPrompt?: string | null;
  tools: AgentToolCatalogItem[];
}) {
  return `Voce e o arquiteto de flows do Dialogy. Execute somente a task 1: definir e ordenar os blocos funcionais de um atendimento incrivelmente completo e detalhado. NUNCA resuma ou abrevie o pedido do usuario. Siga RIGOROSAMENTE todas as especificacoes para entregar a jornada exata e completa solicitada.

Regras obrigatorias de Arquitetura Avancada:
- Esta task 1 cria SOMENTE o esqueleto operacional compacto. Instrucoes longas, mensagens finais ao cliente e tools serao criadas nas tasks seguintes.
- Antes de criar o grafo, escreva em procedureManifest um resumo compacto com objetivo do atendimento, passos sequenciais, slots tipados, decisoes, consultas de knowledge necessarias e finais possiveis.
- Use SOMENTE estes kinds na task 1: start, message, collect, decision, knowledge, sub_agent, handoff e end.
- Nunca crie trigger, understand, switch, intent, assistant, ai_response, reply, send_message, form, close ou rule em propostas novas. Eles existem apenas para compatibilidade de flows antigos ja salvos.
- Gere blocos em ordem operacional, com coordenadas organizadas da esquerda para a direita ou de cima para baixo.
- Garanta que o fluxo tenha INICIO, MEIO e FIM claramente definidos e conectados.
- O fluxo DEVE iniciar com um bloco do tipo 'start'.
- Imediatamente apos o 'start', inclua um bloco 'message' de apresentacao/boas-vindas onde o agente se apresenta e ja faz a primeira pergunta operacional quando houver triagem/coleta.
- Logo apos a apresentacao inicial, inclua um bloco 'decision' quando houver mais de uma rota possivel. Esse decisor deve triar a intencao/situacao sem pular etapas criticas.
- Use 'sub_agent' como o bloco de IA V2 que compoe respostas inteligentes ou executa uma etapa especializada.
- Use blocos 'decision' SEMPRE que a conversa precisar de bifurcacoes ou decisoes multiplas com base na intencao ou situacao do cliente. Para cada 'decision':
  * Defina switchMode = 'ai' e confidenceThreshold entre 0.75 e 0.85.
  * Forneca uma lista compacta de 'routes'. Cada rota deve conter: 'id' unico, 'label' legivel, 'description' do criterio de ativacao, ate 3 'examples' e 'targetNodeId' apontando para o bloco que trata aquela situacao.
  * Configure obrigatoriamente um 'fallbackRouteId' apontando para a rota padrao de tratamento (geralmente enviando para o Agente Principal ou pedindo esclarecimento).
- Use 'collect' SEMPRE que precisar coletar dados estruturados (ex: nome, telefone, data, motivo, identificador, endereco). Preencha formFields de forma compacta somente no bloco collect, com id/label/type/aliases curtos; defina formMode = 'ai'. Nao use understand para coleta de dados.
- Use 'message' para enviar avisos, informacoes, cobrancas ou encerramentos, quando nao for necessario compor resposta inteligente.
- Use 'knowledge' antes de 'sub_agent' sempre que houver fato, instrucao, politica, saude, financeiro, produto, plano, suporte ou recomendacao dependente da base. Configure requiredKnowledgeCoverage.
- Use 'handoff' para transferencia humana e 'end' para encerramento claro.
- Nao crie sub-agentes 'intent' em fluxos novos. Sub-agentes agora sao blocos 'sub_agent'. Etapas sequenciais desta task devem ser collect, decision, knowledge, sub_agent, handoff ou end.
- Nao crie blocos kind tool nesta etapa. A selecao de ferramentas ocorrera depois, consultando o catalogo completo.
- Retorne edges vazio. Uma segunda task especializada fara as ligacoes.
- Inclua ao menos um bloco knowledge por padrao e conecte a base ao sub_agent que precisa desses fatos. Omita knowledge somente quando o usuario pedir explicitamente um agente sem RAG ou sem base de conhecimento.
- Cada bloco deve ter referenceId unico. Para citar um bloco use exatamente @ seguido pelo valor de referenceId, por exemplo @consulta_planos. Nunca escreva o texto literal "@referenceId:".
- No systemPrompt, descreva persona, objetivo e limites gerais de forma compacta. Mencione somente blocos relevantes usando @id_real.
- Nao preencha instructions, message, toolName, inputSchema, outputSchema, successHandles ou errorHandles nesta task. Esses campos pertencem a tasks posteriores.
- Para fluxos de saude, clinicas ou urgencias, NUNCA faca o agente instruir o paciente a ligar para o SAMU, policia ou emergencias, a menos que o usuario solicite expressamente no prompt. Apenas transfira o atendimento para a equipe humana de forma comercial, profissional e calma.
- Nao inclua segredos. Nao publique nada. Gere uma proposta completa.

Flow atual:
${JSON.stringify(input.currentGraph || null, null, 2)}

Prompt system atual:
${input.currentSystemPrompt || '(vazio)'}

Conversa com o usuario:
${input.conversation.map((message) => `${message.role.toUpperCase()}: ${message.content}`).join('\n\n')}`;
}

function buildTopologyPrompt(architecture: FlowBuilderOutput) {
  return `Execute somente a task 2 do construtor Dialogy: ligar os blocos funcionais na ordem correta.

Regras:
- Retorne somente edges entre ids existentes.
- Conecte o caminho operacional principal completo.
- O grafo deve seguir uma execucao sequencial: start -> message -> collect/decision/knowledge/sub_agent/tool/handoff/end conforme o manifest.
- Knowledge liga preferencialmente knowledge -> sub_agent que depende daqueles fatos.
- Toda decision deve ter edges com routeId para cada rota configurada e para o fallback.
- Nao crie tools nesta fase.
- Nao deixe blocos funcionais soltos, exceto quando forem anexos opcionais sem uso real.
- Nao use start como encerramento. Encerramento deve ser end, handoff ou tool de close quando necessario.

Blocos ordenados:
${JSON.stringify(architecture.nodes, null, 2)}`;
}

function buildEnrichmentPrompt(input: {
  architecture: FlowBuilderOutput;
  conversation: Array<{ role: 'user' | 'assistant'; content: string }>;
  currentSystemPrompt?: string | null;
  tools: AgentToolCatalogItem[];
}) {
  const toolByName = new Map<string, AgentToolCatalogItem>(input.tools.map((tool) => [tool.name, tool]));
  const tasks = input.architecture.nodes.map((node) => {
    const incoming = input.architecture.edges.filter((edge) => edge.target === node.id).map((edge) => edge.source);
    const outgoing = input.architecture.edges.filter((edge) => edge.source === node.id).map((edge) => edge.target);
    const tool = node.toolName ? toolByName.get(node.toolName) : null;
    return {
      id: node.id,
      kind: node.kind,
      title: node.title,
      subtitle: node.subtitle,
      incoming,
      outgoing,
      tool: tool ? {
        name: tool.name,
        description: tool.description,
        riskLevel: tool.riskLevel,
        inputSchema: tool.inputSchema || null,
      } : null,
      task: node.kind === 'tool'
        ? 'Escreva criterios de uso, criterios de nao uso, dados necessarios e como montar o payload.'
        : node.kind === 'knowledge'
            ? 'Explique quando consultar a base e para qual agente conectado entregar o contexto.'
            : node.kind === 'collect'
              ? 'Escreva a pergunta de coleta, slots tipados esperados, validacoes simples e regra para nao repetir dado ja informado.'
              : node.kind === 'decision'
                ? 'Escreva criterios claros para cada rota, fallback de baixa confianca e proibicao de pular etapas.'
                : node.kind === 'sub_agent'
                  ? 'Escreva regras de composicao da resposta, grounding em knowledge/tools/slots e limites para nao inventar.'
                  : 'Escreva uma instrucao operacional especifica para a funcao deste bloco e sua relacao com os vizinhos.',
    };
  });
  return `Voce e o revisor operacional de flows do Dialogy. A arquitetura ja foi definida. Agora execute uma task de escrita para cada bloco.

Regras obrigatorias:
- Retorne exatamente um item para cada id recebido. Nunca omita blocos.
- Cada instructions deve ser especifico para aquele bloco. Nao replique o mesmo texto em blocos diferentes.
- Considere incoming e outgoing para explicar como o bloco participa do fluxo.
- Para sub_agent, escreva o system prompt exclusivo do sub-agente V2.
- Para tool, descreva quando executar, quando nao executar, dados obrigatorios e montagem do payload conforme o schema real.
- Para knowledge, descreva a consulta RAG e o agente que recebe o contexto.
- OBRIGATORIO: Para message, voce DEVE preencher o campo "message" com o texto real que sera enviado ao cliente.
- OBRIGATORIO: Para handoff, preencha "message" com o aviso de transferencia que o cliente recebera.
- OBRIGATORIO: Para end, preencha "message" com a mensagem final quando houver resposta visivel.
- OBRIGATORIO: Para collect, escreva a introducao da coleta no campo "message" (INCLUINDO imediatamente a primeira pergunta a ser respondida) e instructions detalhadas sobre quais dados coletar. Cada formField deve ter type e aliases quando possivel.
- OBRIGATORIO: Para start, escreva instructions sobre quando este fluxo deve iniciar e qual e o primeiro passo.
- OBRIGATORIO: Para decision, escreva instructions descrevendo criterios, exemplos, fallback e regra de escolher apenas uma rota configurada.
- OBRIGATORIO: Para sub_agent, escreva instructions de resposta/etapa com grounding: usar apenas slots confirmados, resultados de tools e chunks de knowledge quando existirem. Preencha tambem message com a tarefa que o sub-agente deve executar.
- O systemPrompt geral deve tratar apenas persona, objetivo global, limites e coordenacao dos blocos por @referenceId real.
- Para citar bloco use @ seguido de referenceId real. Nunca escreva "@referenceId:" literalmente.
- Nao invente fatos, ferramentas ou conexoes.
- NUNCA deixe nenhum bloco com instructions vazio. Todo bloco deve ter instrucoes especificas.

Arquitetura:
${JSON.stringify(input.architecture, null, 2)}

Tasks por bloco:
${JSON.stringify(tasks, null, 2)}

Prompt system atual:
${input.currentSystemPrompt || '(vazio)'}

Pedido do usuario:
${input.conversation.map((message) => `${message.role.toUpperCase()}: ${message.content}`).join('\n\n')}`;
}

function applyFlowBuilderEnrichment(architecture: FlowBuilderOutput, enrichment: FlowBuilderEnrichment): FlowBuilderOutput {
  const enrichmentById = new Map(enrichment.nodes.map((node) => [node.id, node]));
  return {
    ...architecture,
    systemPrompt: enrichment.systemPrompt,
    nodes: architecture.nodes.map((node) => {
      const enriched = enrichmentById.get(node.id);
      if (!enriched) return node;
      return {
        ...node,
        instructions: enriched.instructions,
        message: enriched.message || node.message,
      };
    }),
  };
}

function buildToolSelectionPrompt(input: {
  architecture: FlowBuilderOutput;
  tools: AgentToolCatalogItem[];
}) {
  const tools = input.tools.map((tool) => ({
    name: tool.name,
    source: tool.source,
    description: tool.description,
    class: tool.class,
    riskLevel: tool.riskLevel,
    sideEffect: tool.sideEffect,
    requiresHumanApproval: tool.requiresHumanApproval,
    allowedIntents: tool.allowedIntents,
    requiredSlots: tool.requiredSlots,
    inputSchema: tool.inputSchema || null,
  }));
  return `Execute as tasks 4 e 5 do construtor Dialogy: revisar cada bloco e selecionar ferramentas somente quando forem necessarias.

Regras:
- Analise cada bloco e percorra todas as ferramentas catalogadas uma por uma antes de decidir.
- Retorne tools vazio quando nenhuma ferramenta for necessaria.
- Nunca adicione ferramenta apenas porque ela existe no catalogo.
- Use somente toolName exato do catalogo.
- attachToNodeId deve apontar para o passo imediatamente anterior a execucao da ferramenta. Em flows v2, prefira collect, sub_agent ou message conforme a sequencia operacional.
- Para cada tool escolhida, explique quando executar, quando nao executar, dados obrigatorios e montagem do payload.
- Encerramento real exige close_chat. Transferencia humana exige transfer_chat. Consultas externas exigem a tool de leitura adequada.
- Coleta ou atualizacao de dados persistentes do contato exige a ferramenta de CRM adequada quando ela existir no catalogo.
- Preservacao de contexto operacional para equipe humana exige add_internal_note quando ela existir no catalogo.
- Nao invente ferramenta e nao duplique a mesma tool no mesmo agente.

Flow apos tasks 1, 2 e 3:
${JSON.stringify(input.architecture, null, 2)}

Catalogo completo Dialogy + MCP:
${JSON.stringify(tools, null, 2)}`;
}

export function applyToolSelection(
  architecture: FlowBuilderOutput,
  selection: z.infer<typeof FlowBuilderToolSelectionSchema>,
  tools: AgentToolCatalogItem[],
): FlowBuilderOutput {
  const available = new Set<string>(tools.map((tool) => tool.name));
  const nodeById = new Map(architecture.nodes.map((node) => [node.id, node]));
  const existingToolNames = new Set(architecture.nodes.filter((node) => node.kind === 'tool').map((node) => node.toolName).filter(Boolean));
  const selectedNodes: FlowBuilderOutput['nodes'] = [];
  const selectedEdges: FlowBuilderOutput['edges'] = [];
  for (const selected of selection.tools) {
    const target = nodeById.get(selected.attachToNodeId);
    if (!target || !['sub_agent', 'collect', 'message'].includes(target.kind)) continue;
    if (!available.has(selected.toolName) || existingToolNames.has(selected.toolName)) continue;
    existingToolNames.add(selected.toolName);
    const id = `tool-${normalizeId(selected.toolName, 'acao')}`;
    selectedNodes.push({
      id,
      kind: 'tool',
      title: selected.title,
      subtitle: selected.subtitle,
      x: target.x + 260,
      y: target.y + 180 + (selectedNodes.length * 110),
      toolName: selected.toolName,
      instructions: selected.instructions,
      referenceId: id.replace(/-/g, '_'),
    });
    selectedEdges.push({ source: target.id, target: id });
  }
  return {
    ...architecture,
    nodes: [...architecture.nodes.filter((node) => node.kind !== 'tool'), ...selectedNodes],
    edges: [...architecture.edges.filter((edge) => nodeById.has(edge.source) && nodeById.has(edge.target)), ...selectedEdges],
  };
}

function normalizeSearchText(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function toolInstructions(tool: AgentToolCatalogItem) {
  const requiredSlots = tool.requiredSlots.length > 0
    ? ` Dados obrigatorios: ${tool.requiredSlots.join(', ')}.`
    : '';
  const approval = tool.requiresHumanApproval
    ? ' Solicite aprovacao humana antes da execucao.'
    : '';
  return `Use ${tool.name} somente quando a etapa conectada exigir: ${tool.description} Nao execute fora desse criterio.${requiredSlots}${approval}`;
}

export function ensureOperationalCoverage(
  architecture: FlowBuilderOutput,
  tools: AgentToolCatalogItem[],
): FlowBuilderOutput {
  const nodes = [...architecture.nodes];
  const edges = [...architecture.edges];
  const agentNodes = nodes.filter((node) => node.kind === 'sub_agent');
  if (agentNodes.length === 0) return architecture;
  const principal = nodes.find((node) => node.kind === 'sub_agent') || agentNodes[0];

  const text = normalizeSearchText([
    architecture.summary,
    architecture.systemPrompt,
    ...nodes.flatMap((node) => [node.title, node.subtitle, node.instructions || '', node.message || '']),
  ].join('\n'));
  const explicitlyWithoutKnowledge = /\bsem\s+(rag|base de conhecimento|knowledge)\b|\bnao\s+(usar|use|consultar|consulte)\s+(rag|a base|base de conhecimento)\b/.test(text);

  if (!explicitlyWithoutKnowledge) {
    let knowledgeNode = nodes.find((node) => node.kind === 'knowledge');
    if (!knowledgeNode) {
      knowledgeNode = {
        id: 'knowledge-base',
        kind: 'knowledge',
        title: 'Base de conhecimento',
        subtitle: 'Consultar contexto indexado',
        x: principal.x - 260,
        y: principal.y + 180,
        referenceId: 'knowledge_base',
        instructions: 'Consulte a base RAG antes de responder perguntas factuais. Entregue ao agente conectado apenas contexto relevante e recuperado.',
      };
      nodes.push(knowledgeNode);
    }
    if (!edges.some((edge) => edge.source === knowledgeNode?.id && edge.target === principal.id)) {
      edges.push({ source: knowledgeNode.id, target: principal.id });
    }
  }

  const requiredToolPatterns: Array<[AgentToolCatalogItem['name'], RegExp]> = [
    ['close_chat', /\b(encerr|finaliz|conclu|fech|close_chat)\w*/],
    ['transfer_chat', /\b(transfer|encaminh|handoff|humano|equipe humana|escal)\w*/],
    ['crm_update_contact_custom_fields', /\b(crm|cadastro|pre-cadastro|lead|salvar dados|registrar dados|atualizar contato|campos? customiz)\w*/],
    ['add_internal_note', /\b(nota interna|registrar contexto|preservar contexto)\b/],
  ];
  const availableTools = new Map(tools.map((tool) => [tool.name, tool]));
  for (const [toolName, pattern] of requiredToolPatterns) {
    const tool = availableTools.get(toolName);
    if (!tool || !pattern.test(text)) continue;
    let toolNode = nodes.find((node) => node.kind === 'tool' && node.toolName === toolName);
    if (!toolNode) {
      const id = `tool-${normalizeId(toolName, 'acao')}`;
      toolNode = {
        id,
        kind: 'tool',
        title: toolName,
        subtitle: tool.description,
        x: principal.x + 300,
        y: principal.y + 180 + (nodes.filter((node) => node.kind === 'tool').length * 110),
        toolName,
        instructions: toolInstructions(tool),
        referenceId: id.replace(/-/g, '_'),
      };
      nodes.push(toolNode);
    }
    let sourceNodeId = principal.id;
    if (toolName === 'crm_update_contact_custom_fields') {
      const formNode = nodes.find((node) => node.kind === 'collect');
      if (formNode) {
        sourceNodeId = formNode.id;
      }
    }
    if (!edges.some((edge) => edge.source === sourceNodeId && edge.target === toolNode?.id)) {
      edges.push({ source: sourceNodeId, target: toolNode.id });
    }
    if (!edges.some((edge) => edge.source === toolNode?.id)) {
      const handoffNode = nodes.find((node) => node.kind === 'handoff');
      const recoveryTarget = handoffNode?.id || principal.id;
      edges.push({ source: toolNode.id, target: recoveryTarget });
    }
  }
  return { ...architecture, nodes, edges };
}

function buildValidationPrompt(flow: FlowBuilderOutput) {
  return `Execute as tasks 6 e 7 do construtor Dialogy: revisar todas as ligacoes e validar o flow final.

Regras:
- Verifique se o caminho operacional principal esta completo.
- Verifique se flows novos usam sequencia operacional com start, message, collect, decision, knowledge, sub_agent, tool, handoff e end.
- Verifique se knowledge geral esta conectado ao sub_agent que usa aqueles fatos.
- Verifique se tools gerais estao conectadas ao passo correto da sequencia.
- Verifique se encerramento, transferencia, persistencia no CRM e nota interna possuem suas tools quando essas capacidades forem exigidas pelo flow.
- Verifique se nao ha blocos soltos, ciclos sem limite, saltos impossiveis ou start usado como encerramento.
- missingEdges deve conter somente correcoes entre ids existentes.
- Nao invente novos blocos nesta fase.
- valid deve ser false quando houver qualquer problema relevante.

Flow final candidato:
${JSON.stringify(flow, null, 2)}`;
}

function applyValidationEdges(
  flow: FlowBuilderOutput,
  validation: z.infer<typeof FlowBuilderValidationSchema>,
): FlowBuilderOutput {
  const nodeById = new Map(flow.nodes.map((node) => [node.id, node]));
  const seen = new Set(flow.edges.map((edge) => `${edge.source}:${edge.target}`));
  const missingEdges = validation.missingEdges.filter((edge) => {
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    const key = `${edge.source}:${edge.target}`;
    if (!source || !target || seen.has(key) || !canConnect(source.kind, target.kind)) return false;
    seen.add(key);
    return true;
  });
  return { ...flow, edges: [...flow.edges, ...missingEdges] };
}

const defaultPrompt = ai.definePrompt({
  name: 'autopilotFlowBuilderPrompt',
  input: { schema: z.object({ prompt: z.string() }) },
  output: { schema: ArchitectureFlowBuilderOutputSchema },
  prompt: '{{{prompt}}}',
});

const defaultEnrichmentPrompt = ai.definePrompt({
  name: 'autopilotFlowBuilderEnrichmentPrompt',
  input: { schema: z.object({ prompt: z.string() }) },
  output: { schema: FlowBuilderEnrichmentSchema },
  prompt: '{{{prompt}}}',
});

const defaultTopologyPrompt = ai.definePrompt({
  name: 'autopilotFlowBuilderTopologyPrompt',
  input: { schema: z.object({ prompt: z.string() }) },
  output: { schema: FlowBuilderTopologySchema },
  prompt: '{{{prompt}}}',
});

const defaultToolSelectionPrompt = ai.definePrompt({
  name: 'autopilotFlowBuilderToolSelectionPrompt',
  input: { schema: z.object({ prompt: z.string() }) },
  output: { schema: FlowBuilderToolSelectionSchema },
  prompt: '{{{prompt}}}',
});

const defaultValidationPrompt = ai.definePrompt({
  name: 'autopilotFlowBuilderValidationPrompt',
  input: { schema: z.object({ prompt: z.string() }) },
  output: { schema: FlowBuilderValidationSchema },
  prompt: '{{{prompt}}}',
});

function positiveIntEnv(name: string, fallback: number) {
  const value = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const FLOW_BUILDER_TIMEOUT_MS = positiveIntEnv('AI_FLOW_BUILDER_TIMEOUT_MS', 600000);
const FLOW_BUILDER_MAX_TOKENS = positiveIntEnv('AI_FLOW_BUILDER_MAX_TOKENS', 32000);
const FLOW_BUILDER_RETRY_ATTEMPTS = Math.max(
  1,
  Math.min(3, positiveIntEnv('AI_FLOW_BUILDER_RETRY_ATTEMPTS', 2))
);

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isRetryableFlowBuilderError(error: unknown) {
  const message = errorMessage(error).toLowerCase();
  return /timed out|timeout|invalid json|truncated|does not match|schema|parse|malformed|unexpected/.test(message);
}

function retryPrompt(userPrompt: string, error: unknown) {
  return `${userPrompt}

CORRECAO OBRIGATORIA DA TENTATIVA ANTERIOR:
- A resposta anterior falhou: ${errorMessage(error).slice(0, 500)}
- Retorne somente UM objeto JSON completo e valido.
- Nao inclua markdown, comentarios, texto antes/depois do JSON, campos fora do schema ou valores nulos desnecessarios.
- Seja mais compacto nos textos longos para evitar truncamento, preservando a estrutura operacional solicitada.`;
}

function flowBuilderStageError(schemaName: string, error: unknown) {
  return new Error(`Falha ao gerar etapa ${schemaName}: ${errorMessage(error)}`);
}

async function runFlowBuilderStage<TSchema extends z.ZodTypeAny>(input: {
  model: string;
  apiKey?: string;
  schema: TSchema;
  schemaName: string;
  jsonSchema: Record<string, unknown>;
  systemPrompt: string;
  userPrompt: string;
  defaultRunner: any;
  maxTokens?: number;
}) {
  if (isLmStudioModel(input.model)) {
    let lastError: unknown;
    for (let attempt = 1; attempt <= FLOW_BUILDER_RETRY_ATTEMPTS; attempt += 1) {
      try {
        return await requestLmStudioJson({
          model: input.model,
          schema: input.schema,
          schemaName: input.schemaName,
          jsonSchema: input.jsonSchema,
          systemPrompt: input.systemPrompt,
          userPrompt: attempt === 1 ? input.userPrompt : retryPrompt(input.userPrompt, lastError),
          timeoutMs: FLOW_BUILDER_TIMEOUT_MS,
          maxTokens: input.maxTokens ?? FLOW_BUILDER_MAX_TOKENS,
        });
      } catch (error) {
        lastError = error;
        if (attempt >= FLOW_BUILDER_RETRY_ATTEMPTS || !isRetryableFlowBuilderError(error)) {
          throw flowBuilderStageError(input.schemaName, error);
        }
        console.warn(
          `[AUTOPILOT_FLOW_BUILDER_AI] Retrying ${input.schemaName} after invalid LM Studio response:`,
          error
        );
      }
    }
    throw flowBuilderStageError(input.schemaName, lastError);
  }

  const apiKey = input.apiKey?.trim() || process.env.GOOGLE_GENAI_API_KEY?.trim() || process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error('Chave Gemini nao configurada para construir o flow.');
  const defaultKey = process.env.GOOGLE_GENAI_API_KEY?.trim() || process.env.GEMINI_API_KEY?.trim();
  const runner: any = apiKey === defaultKey
    ? input.defaultRunner
    : genkit({ plugins: [googleAI({ apiKey })], model: input.model }).definePrompt({
        name: `${input.schemaName}DynamicPrompt`,
        input: { schema: z.object({ prompt: z.string() }) },
        output: { schema: input.schema },
        prompt: '{{{prompt}}}',
      });
  try {
    const result = await runner({ prompt: input.userPrompt }, { model: input.model });
    if (!result.output) throw new Error(`A IA nao retornou JSON estruturado para ${input.schemaName}.`);
    return input.schema.parse(result.output);
  } catch (error) {
    throw flowBuilderStageError(input.schemaName, error);
  }
}

export async function generateAutopilotFlowProposal(input: {
  conversation: Array<{ role: 'user' | 'assistant'; content: string }>;
  currentGraph?: AutopilotFlowGraph | null;
  currentSystemPrompt?: string | null;
  tools: AgentToolCatalogItem[];
  model: string;
  apiKey?: string;
}) {
  const architecture = await runFlowBuilderStage({
    model: input.model,
    apiKey: input.apiKey,
    schema: ArchitectureFlowBuilderOutputSchema,
    schemaName: 'dialogy_autopilot_flow_builder_architecture',
    jsonSchema: architectureJsonSchema,
    systemPrompt: 'Execute a task 1: ordene blocos funcionais compactos, sem tools e sem edges. Retorne somente JSON valido.',
    userPrompt: buildPrompt(input),
    defaultRunner: defaultPrompt,
    maxTokens: FLOW_BUILDER_MAX_TOKENS,
  });
  let output: FlowBuilderOutput = {
    ...architecture,
    nodes: architecture.nodes as FlowBuilderOutput['nodes'],
    edges: [],
  };
  const topology = await runFlowBuilderStage({
    model: input.model,
    apiKey: input.apiKey,
    schema: FlowBuilderTopologySchema,
    schemaName: 'dialogy_autopilot_flow_builder_topology',
    jsonSchema: topologyJsonSchema,
    systemPrompt: 'Execute a task 2: ligue blocos existentes na ordem operacional. Retorne somente JSON valido.',
    userPrompt: buildTopologyPrompt(output),
    defaultRunner: defaultTopologyPrompt,
  });
  output = { ...output, edges: topology.edges };
  const enrichment = await runFlowBuilderStage({
    model: input.model,
    apiKey: input.apiKey,
    schema: FlowBuilderEnrichmentSchema,
    schemaName: 'dialogy_autopilot_flow_builder_enrichment',
    jsonSchema: enrichmentJsonSchema,
    systemPrompt: 'Execute a task 3: enriqueça cada bloco individualmente. Retorne somente JSON valido e nunca omita tasks.',
    userPrompt: buildEnrichmentPrompt({
      architecture: output,
      conversation: input.conversation,
      currentSystemPrompt: input.currentSystemPrompt,
      tools: input.tools,
    }),
    defaultRunner: defaultEnrichmentPrompt,
  });
  output = applyFlowBuilderEnrichment(output, enrichment);
  const toolSelection = await runFlowBuilderStage({
    model: input.model,
    apiKey: input.apiKey,
    schema: FlowBuilderToolSelectionSchema,
    schemaName: 'dialogy_autopilot_flow_builder_tools',
    jsonSchema: toolSelectionJsonSchema,
    systemPrompt: 'Execute as tasks 4 e 5: consulte todo o catalogo e escolha apenas tools necessarias. Retorne somente JSON valido.',
    userPrompt: buildToolSelectionPrompt({ architecture: output, tools: input.tools }),
    defaultRunner: defaultToolSelectionPrompt,
  });
  output = applyToolSelection(output, toolSelection, input.tools);
  output = ensureOperationalCoverage(output, input.tools);
  const validation = await runFlowBuilderStage({
    model: input.model,
    apiKey: input.apiKey,
    schema: FlowBuilderValidationSchema,
    schemaName: 'dialogy_autopilot_flow_builder_validation',
    jsonSchema: validationJsonSchema,
    systemPrompt: 'Execute as tasks 6 e 7: revise ligacoes e reporte correcoes. Retorne somente JSON valido.',
    userPrompt: buildValidationPrompt(output),
    defaultRunner: defaultValidationPrompt,
  });
  output = applyValidationEdges(output, validation);
  output = ensureOperationalCoverage(output, input.tools);
  return sanitizeAutopilotFlowProposal(output, input.tools);
}
