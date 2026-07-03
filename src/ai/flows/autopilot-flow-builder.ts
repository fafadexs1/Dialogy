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
  x: z.number().optional(),
  y: z.number().optional(),
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

type ArchitectureFlowBuilderOutput = z.infer<typeof ArchitectureFlowBuilderOutputSchema>;

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

type FlowBuilderTopology = z.infer<typeof FlowBuilderTopologySchema>;

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
        required: ['id', 'kind', 'title', 'subtitle'],
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

function defaultFlowNodePosition(index: number) {
  return {
    x: 120 + (index % 4) * 260,
    y: 120 + Math.floor(index / 4) * 220,
  };
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
  legacyKind?: AutopilotFlowNodeKind;
}): string | undefined {
  switch (node.kind) {
    case 'message': {
      if (node.legacyKind && node.legacyKind !== 'message') {
        return node.subtitle?.trim() || node.title?.trim() || 'Mensagem configurada.';
      }
      const context = normalizeSearchText(`${node.title} ${node.subtitle}`);
      if (/\b(boas[-\s]vindas|bem[-\s]vindo|saudacao|inicio do atendimento)\b/.test(context)) {
        return 'Ola! Como posso ajudar voce hoje?';
      }
      if (/\b(confirmar|confirmacao)\b/.test(context) && /\b(reboot|reiniciar|roteador)\b/.test(context)) {
        return 'Antes de reiniciar o roteador, preciso da sua confirmacao explicita. Posso prosseguir?';
      }
      return undefined;
    }
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
    const fallbackPosition = defaultFlowNodePosition(index);
    const x = Number.isFinite(node.x) ? node.x : fallbackPosition.x;
    const y = Number.isFinite(node.y) ? node.y : fallbackPosition.y;
    return [{
      id,
      kind,
      title: cleanText(node.title, 100) || 'Bloco',
      subtitle: cleanText(node.subtitle, 140),
      position: { x: Math.round(x), y: Math.round(y) },
      ...(node.kind === 'tool' ? { toolName: node.toolName } : {}),
      config: {
        instructions,
        message: cleanPromptText(node.message, 2400)
          || defaultNodeMessage({
            kind,
            title: cleanText(node.title, 100) || 'Bloco',
            subtitle: cleanText(node.subtitle, 140),
            legacyKind: node.kind,
          }),
        referenceId,
        variableName: normalizeId(node.variableName || `resultado-${id}`, `resultado-${id}`).replace(/-/g, '_'),
        requiredSlots: (node.requiredSlots || []).map((slot) => normalizeId(slot, '')).filter(Boolean),
        inputSchema: node.inputSchema,
        outputSchema: node.outputSchema,
        successHandles: (node.successHandles || []).map((handle) => normalizeId(handle, '')).filter(Boolean),
        errorHandles: kind === 'tool'
          ? Array.from(new Set([...(node.errorHandles || []).map((handle) => normalizeId(handle, '')).filter(Boolean), 'error']))
          : (node.errorHandles || []).map((handle) => normalizeId(handle, '')).filter(Boolean),
        maxAttempts: typeof node.maxAttempts === 'number'
          ? Math.max(1, Math.min(12, Math.round(node.maxAttempts)))
          : (kind === 'tool' ? 3 : undefined),
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
        const currentTarget = target ? nodes.find((candidate) => candidate.id === target) : undefined;
        if (!currentTarget || !isSafeFallbackKind(currentTarget.kind) || !canConnect(node.kind, currentTarget.kind)) {
          const routeText = normalizeSearchText(`${route.id || ''} ${route.label || ''} ${route.description || ''}`);
          const routeId = normalizeId(route.id || '', '');
          const fallbackId = normalizeId((node.config as any).fallbackRouteId || '', '');
          const isFallbackRoute = routeId === fallbackId
            || /^(fallback|outro|esclarecer|esclarecimento|fora_do_escopo|baixa_confianca)$/.test(routeId)
            || /\b(fallback|fora do procedimento|fora do escopo|mudanca de assunto|baixa confianca)\b/.test(routeText);
          if (isFallbackRoute) {
            target = undefined;
          } else {
            const candidates = nodes.filter((candidate) => (
              candidate.id !== node.id
              && isSafeFallbackKind(candidate.kind)
              && canConnect(node.kind, candidate.kind)
            ));
            const byKind = (kind: V2FlowNodeKind) => candidates.find((candidate) => candidate.kind === kind)?.id;
            if (/\b(humano|atendente|transfer|handoff|equipe|especialista)\b/.test(routeText)) {
              target = byKind('handoff') || byKind('sub_agent') || byKind('message') || byKind('end');
            } else if (/\b(colet|dados|cadastro|nome|telefone|email|cpf|cnpj|documento|endereco|data|horario|agend|orcamento|lead|contratar|comprar)\b/.test(routeText)) {
              target = byKind('collect') || byKind('sub_agent') || byKind('message') || byKind('end');
            } else if (/\b(encerr|finaliz|conclu|obrigad|fim|tchau)\b/.test(routeText)) {
              target = byKind('end') || byKind('message') || byKind('sub_agent');
            } else {
              target = byKind('sub_agent') || byKind('message') || byKind('collect') || byKind('end') || byKind('handoff');
            }
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

function summarizeToolCatalogForPrompt(tools: AgentToolCatalogItem[]) {
  if (tools.length === 0) {
    return 'Nenhuma ferramenta habilitada para este agente.';
  }
  return tools.map((tool) => ({
    name: tool.name,
    source: tool.source,
    description: tool.description,
    class: tool.class,
    riskLevel: tool.riskLevel,
    sideEffect: tool.sideEffect,
    requiresHumanApproval: tool.requiresHumanApproval,
    inputSchema: tool.inputSchema || null,
  }));
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
- Mesmo sem criar blocos tool nesta task, leve em conta as ferramentas habilitadas para desenhar decisoes e sub-agentes que permitam usa-las corretamente depois.
- Ferramentas MCP habilitadas aparecem sempre com nome qualificado real mcp:<server_id>:<tool_name>. Nunca trate uma MCP como "mcp_call_tool" no planejamento do flow.
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

Ferramentas habilitadas para este agente:
${JSON.stringify(summarizeToolCatalogForPrompt(input.tools), null, 2)}

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
  relevanceMap: ToolRelevanceEntry[];
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
- MCP deve ser selecionada pelo nome qualificado real do catalogo, por exemplo mcp:<server_id>:get_wifi_view. Nunca retorne "mcp_call_tool" como toolName.
- attachToNodeId deve apontar para o passo imediatamente anterior a execucao da ferramenta. Em flows v2, prefira collect, sub_agent ou message conforme a sequencia operacional.
- Para cada tool escolhida, explique quando executar, quando nao executar, dados obrigatorios e montagem do payload.
- Encerramento real exige close_chat. Transferencia humana exige transfer_chat. Consultas externas exigem a tool de leitura adequada.
- Coleta ou atualizacao de dados persistentes do contato exige a ferramenta de CRM adequada quando ela existir no catalogo.
- Preservacao de contexto operacional para equipe humana exige add_internal_note quando ela existir no catalogo.
- Para Wi-Fi: consultar usuario/senha/SSID deve usar ferramenta de consulta de Wi-Fi, nao reboot. Reboot so quando o cliente pedir reinicio explicitamente. Troca de senha/nome exige novos valores e confirmacao.
- Para diagnostico de canais/interferencia/redes ao redor, priorize ferramentas de scan/cache/listagem/topologia antes de qualquer side effect.
- Nao invente ferramenta e nao duplique a mesma tool no mesmo agente.

Flow apos tasks 1, 2 e 3:
${JSON.stringify(input.architecture, null, 2)}

Mapa deterministico de relevancia das ferramentas habilitadas:
${formatToolRelevanceMap(input.relevanceMap)}

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
      maxAttempts: 3,
      errorHandles: ['error'],
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

type ToolRelevanceIntent =
  | 'customer_contract_lookup'
  | 'wifi_credentials_lookup'
  | 'wifi_credentials_change'
  | 'wifi_channel_diagnostics'
  | 'router_reboot'
  | 'order_status_lookup'
  | 'billing_lookup'
  | 'payment_pix_generation'
  | 'payment_promise'
  | 'support_ticket_creation'
  | 'catalog_lookup'
  | 'pricing_lookup'
  | 'availability_lookup'
  | 'scheduling_lookup'
  | 'document_lookup'
  | 'external_read'
  | 'external_action'
  | 'human_handoff'
  | 'close_conversation'
  | 'internal_note'
  | 'crm_update';

type ToolRelevanceEntry = {
  toolName: string;
  intents: ToolRelevanceIntent[];
  score: number;
  reason: string;
  source: AgentToolCatalogItem['source'];
  sideEffect: AgentToolCatalogItem['sideEffect'];
  riskLevel: AgentToolCatalogItem['riskLevel'];
  description: string;
};

function toolText(tool: AgentToolCatalogItem) {
  return normalizeSearchText([
    tool.name,
    tool.description,
    tool.serverName || '',
    tool.inputSchema ? JSON.stringify(tool.inputSchema) : '',
    tool.outputSchema ? JSON.stringify(tool.outputSchema) : '',
  ].join(' '));
}

function inferRequestedToolIntents(searchText: string): Set<ToolRelevanceIntent> {
  const intents = new Set<ToolRelevanceIntent>();
  const mentionsWifi = /\b(wi[\s-]?fi|wifi|ssid|rede|senha|usuario|usu[aá]rio|credencia)\w*/.test(searchText);
  const wantsChange = /\b(trocar|mudar|alterar|atualizar|definir|configurar|nova|novo)\w*/.test(searchText);
  const wantsLookup = /\b(ver|verificar|consultar|saber|mostrar|recuperar|esqueci|qual|quais)\w*/.test(searchText)
    || /\b(usuario e senha|senha atual|ssid atual|nome da rede atual|credenciais? atuais?)\b/.test(searchText);
  const wantsChannelDiagnostics = /\b(canal|canais|redes ao redor|vizin|interferencia|interfer[eê]ncia|lento|lentidao|lentid[aã]o|oscila|queda|sinal fraco|analisar)\w*/.test(searchText);
  const wantsReboot = /\b(reiniciar|reinicie|reboot|resetar|desligar e ligar|roteador|modem)\w*/.test(searchText)
    && /\b(reiniciar|reinicie|reboot|resetar|desligar e ligar)\w*/.test(searchText);

  if (mentionsWifi && wantsChange) intents.add('wifi_credentials_change');
  if (mentionsWifi && wantsLookup) intents.add('wifi_credentials_lookup');
  if (mentionsWifi && wantsChannelDiagnostics) intents.add('wifi_channel_diagnostics');
  if (wantsReboot) intents.add('router_reboot');
  if (/\b(cpf|cnpj|contrato|cliente|assinante|roteador|ip|conexao|conex[aã]o|wi[\s-]?fi|wifi)\b/.test(searchText)) {
    intents.add('customer_contract_lookup');
  }
  if (/\b(humano|atendente|transferir|transferencia|especialista|equipe)\w*/.test(searchText)) intents.add('human_handoff');
  if (/\b(encerrar|finalizar|fechar atendimento|tchau|obrigad)\w*/.test(searchText)) intents.add('close_conversation');
  if (/\b(nota interna|registrar contexto|preservar contexto|resumo interno)\b/.test(searchText)) intents.add('internal_note');
  if (/\b(crm|cadastro|campo customizado|salvar dado|atualizar contato)\w*/.test(searchText)) intents.add('crm_update');
  if (/\b(status|andamento|rastre|tracking|previsao|previs[aÃ£]o|pedido|order|entrega|shipment|protocolo|solicitacao|solicita[cÃ§][aÃ£]o|ticket|chamado)\w*/.test(searchText)) intents.add('order_status_lookup');
  if (/\b(fatura|boleto|segunda via|2a via|pagamento|mensalidade|debito|d[eÃ©]bito|cobranca|cobran[cÃ§]a|vencimento)\w*/.test(searchText)) intents.add('billing_lookup');
  if (/\b(pix|qr code|copia e cola)\w*/.test(searchText) && /\b(gerar|emitir|enviar|codigo|c[oÃ³]digo)\w*/.test(searchText)) intents.add('payment_pix_generation');
  if (/\b(promessa|prometer|negociar|acordo|renegociar)\w*/.test(searchText) && /\b(pagamento|pagar|fatura|boleto)\w*/.test(searchText)) intents.add('payment_promise');
  if (/\b(abrir|criar|registrar)\w*/.test(searchText) && /\b(chamado|ticket|os|ordem de servi[cÃ§]o|suporte)\w*/.test(searchText)) intents.add('support_ticket_creation');
  if (/\b(catalogo|cat[aÃ¡]logo|cardapio|card[aÃ¡]pio|produtos?|servicos?|servi[cÃ§]os?|planos?|menu|opcoes|op[cÃ§][oÃµ]es)\w*/.test(searchText)) intents.add('catalog_lookup');
  if (/\b(preco|pre[cÃ§]o|valor|cotacao|cota[cÃ§][aÃ£]o|orcamento|or[cÃ§]amento|quanto custa|mensalidade)\w*/.test(searchText)) intents.add('pricing_lookup');
  if (/\b(disponivel|disponibilidade|estoque|tem vaga|tem horario|tem hor[aÃ¡]rio|agenda disponivel|entrega disponivel)\w*/.test(searchText)) intents.add('availability_lookup');
  if (/\b(agendar|marcar|remarcar|desmarcar|agenda|horario|hor[aÃ¡]rio|consulta|visita|instalacao|instala[cÃ§][aÃ£]o)\w*/.test(searchText)) intents.add('scheduling_lookup');
  if (/\b(documento|contrato|comprovante|nota fiscal|nf|termo|segunda via|2a via|declaracao|declara[cÃ§][aÃ£]o)\w*/.test(searchText)) intents.add('document_lookup');
  if (/\b(consultar|verificar|buscar|checar|conferir|validar|sistema|api|mcp|externo|painel)\w*/.test(searchText)) intents.add('external_read');
  return intents;
}

const SEARCH_STOP_WORDS = new Set([
  'para', 'como', 'quando', 'onde', 'qual', 'quais', 'quero', 'preciso', 'pode', 'cliente',
  'atendimento', 'agente', 'fluxo', 'dialogy', 'sistema', 'dados', 'usar', 'deve', 'depois',
  'pelo', 'pela', 'pelos', 'pelas', 'com', 'sem', 'sobre', 'entre', 'criar', 'crie', 'monte',
  'numero', 'codigo', 'motivo', 'informado', 'informada',
]);

function overlapScore(toolSearchText: string, requestSearchText: string): number {
  const tokens = requestSearchText.match(/[a-z0-9_]{4,}/g) || [];
  const uniqueTokens = [...new Set(tokens)].filter((token) => !SEARCH_STOP_WORDS.has(token));
  const matches = uniqueTokens.filter((token) => toolSearchText.includes(token));
  return Math.min(6, matches.length);
}

type ExternalActionCategory =
  | 'schedule'
  | 'cancel'
  | 'refund'
  | 'change'
  | 'create'
  | 'delete'
  | 'approve'
  | 'activate'
  | 'document'
  | 'purchase'
  | 'support';

function externalActionCategories(textValue: string): Set<ExternalActionCategory> {
  const text = normalizeSearchText(textValue).replace(/[_-]+/g, ' ');
  const categories = new Set<ExternalActionCategory>();
  if (/\b(schedul|book|reserv|reschedul|agend|marc|remarc)\w*/.test(text)) categories.add('schedule');
  if (/\b(cancel|terminat|suspend|encerr)\w*/.test(text)) categories.add('cancel');
  if (/\b(refund|return|reverse|estorn|reembols|devolv)\w*/.test(text)) categories.add('refund');
  if (/\b(updat|chang|edit|replac|alter|atualiz|troc|mud)\w*/.test(text)) categories.add('change');
  if (/\b(creat|register|open|submit|cri|cadastr|registr|abr|envi)\w*/.test(text)) categories.add('create');
  if (/\b(delet|remov|clear|exclu|apag|limp)\w*/.test(text)) categories.add('delete');
  if (/\b(approv|authoriz|accept|aprov|autoriz|aceit)\w*/.test(text)) categories.add('approve');
  if (/\b(activat|enabl|disabl|deactivat|ativ|habilit|desabilit|desativ)\w*/.test(text)) categories.add('activate');
  if (/\b(issu|generat|send|emit|ger|envi)\w*.{0,32}\b(document|certificat|invoice|receipt|documento|certificado|nota|comprovante)\w*/.test(text)) categories.add('document');
  if (
    /\b(buy|purchas|checkout|compr|contrat|assin)\w*/.test(text) ||
    /\b(creat|place|make|cri|faz|realiz)\w*.{0,24}\b(order|pedido)\w*/.test(text)
  ) {
    categories.add('purchase');
  }
  if (
    /\b(reboot|restart|reset|reinici)\w*/.test(text) ||
    /\b(open|creat|register|abr|cri|registr)\w*.{0,24}\b(ticket|support|chamado|suporte)\w*/.test(text)
  ) {
    categories.add('support');
  }
  return categories;
}

function requestsExternalAction(text: string): boolean {
  return externalActionCategories(text).size > 0;
}

function isReadOnlyExternalTool(tool: AgentToolCatalogItem) {
  return (
    tool.source === 'mcp' ||
    tool.class === 'read_only' ||
    tool.class === 'retrieval'
  ) && tool.sideEffect === 'none';
}

function scoreToolForIntent(
  tool: AgentToolCatalogItem,
  requestedIntent: ToolRelevanceIntent,
  requestSearchText: string,
): number {
  const text = toolText(tool);
  const lastNamePart = normalizeSearchText(tool.name.split(':').at(-1) || tool.name);

  switch (requestedIntent) {
    case 'customer_contract_lookup':
      if (tool.name === 'sgp_fetch_contact_panel_data') return 10;
      if (tool.name === 'sgp_fetch_contracts') return 8;
      if (/\b(find_router_by_ip|get_router|router|contrato|cliente|assinante|sgp|panel|contract)\b/.test(text)) return 5;
      return 0;
    case 'wifi_credentials_lookup':
      if (/\b(get_wifi_view|wifi_view|consultar wifi|senha|ssid|credencia|nome da rede|password)\b/.test(text)) return 10;
      if (/\b(refresh_wifi_summary|wifi_summary)\b/.test(text)) return 7;
      return 0;
    case 'wifi_credentials_change':
      if (/\b(change_wifi_credentials|trocar.*wifi|alterar.*wifi|senha|ssid|credentials)\b/.test(text)) return 10;
      return 0;
    case 'wifi_channel_diagnostics':
      if (/\b(scan_wifi_neighbors|wifi_neighbors|redes ao redor|neighbors|canal|channel|interferencia)\b/.test(text)) return 10;
      if (/\b(get_wifi_scan_cached|wifi_scan|scan cached)\b/.test(text)) return 8;
      if (/\b(list_connected_devices|connected devices|dispositivos conectados|get_router|mesh|topology|topologia)\b/.test(text)) return 5;
      return 0;
    case 'router_reboot':
      return /\b(reboot_router|reiniciar|reboot)\b/.test(text) || lastNamePart === 'reboot_router' ? 10 : 0;
    case 'order_status_lookup':
      if (/\b(get_order_status|order_status|track_order|tracking|shipment_status|get_ticket_status|get_request_status|status_pedido|rastreio|pedido|protocolo|ticket|chamado)\b/.test(text)) return 10;
      if (tool.allowedIntents.includes('order_or_request_status') && /\b(status|andamento|pedido|protocolo|solicitacao|ticket|chamado|entrega)\b/.test(text)) return 7;
      return 0;
    case 'billing_lookup':
      if (tool.name === 'sgp_fetch_contact_panel_data') return 9;
      if (tool.name === 'sgp_fetch_contracts') return 6;
      if (isReadOnlyExternalTool(tool) && /\b(fatura|boleto|invoice|billing|payment|pagamento|debito|cobranca|mensalidade|vencimento)\b/.test(text)) return 9;
      return 0;
    case 'payment_pix_generation':
      if (tool.name === 'sgp_generate_invoice_pix') return 10;
      return /\b(generate.*pix|pix|qr code|payment link|codigo de pagamento)\b/.test(text) ? 9 : 0;
    case 'payment_promise':
      if (tool.name === 'sgp_create_payment_promise') return 10;
      return /\b(payment_promise|promessa|acordo|renegociar|promise)\b/.test(text) ? 9 : 0;
    case 'support_ticket_creation':
      return /\b(open_support_ticket|create_ticket|abrir chamado|criar chamado|ordem de servico|service order|support ticket)\b/.test(text) ? 8 : 0;
    case 'catalog_lookup':
      return isReadOnlyExternalTool(tool) && /\b(catalog|catalogo|cat[aÃ¡]logo|cardapio|produto|product|servico|service|plano|menu)\b/.test(text) ? 8 : 0;
    case 'pricing_lookup':
      return isReadOnlyExternalTool(tool) && /\b(price|pricing|preco\w*|pre[cÃ§]o\w*|valor|cotacao|orcamento|quote|mensalidade)\b/.test(text) ? 8 : 0;
    case 'availability_lookup':
      return isReadOnlyExternalTool(tool) && /\b(availability|disponibilidade|estoque|stock|slot|agenda|vaga|horario|hor[aÃ¡]rio)\b/.test(text) ? 8 : 0;
    case 'scheduling_lookup':
      return isReadOnlyExternalTool(tool) && /\b(schedule|appointment|agenda|agendar|marcar|remarcar|visita|consulta|instalacao|instala[cÃ§][aÃ£]o)\b/.test(text) ? 8 : 0;
    case 'document_lookup':
      return isReadOnlyExternalTool(tool) && /\b(document|documento|contrato|comprovante|nota fiscal|invoice|declaracao|declara[cÃ§][aÃ£]o|termo)\b/.test(text) ? 8 : 0;
    case 'external_read':
      if (!isReadOnlyExternalTool(tool)) return 0;
      return overlapScore(text, requestSearchText) >= 3 ? 5 + overlapScore(text, requestSearchText) : 0;
    case 'external_action': {
      if (tool.source !== 'mcp' || tool.sideEffect === 'none') return 0;
      const requestCategories = externalActionCategories(requestSearchText);
      const toolCategories = externalActionCategories(text);
      const categoryMatches = [...requestCategories].filter((category) => toolCategories.has(category));
      const overlap = overlapScore(text, requestSearchText);
      if (categoryMatches.length > 0 && overlap >= 1) {
        return 8 + Math.min(4, categoryMatches.length * 2) + overlap;
      }
      return overlap >= 3 ? 6 + overlap : 0;
    }
    case 'human_handoff':
      return tool.name === 'transfer_chat' ? 10 : 0;
    case 'close_conversation':
      return tool.name === 'close_chat' ? 10 : 0;
    case 'internal_note':
      return tool.name === 'add_internal_note' ? 10 : 0;
    case 'crm_update':
      return tool.name === 'crm_update_contact_custom_fields' ? 10 : 0;
    default:
      return 0;
  }
}

function sideEffectExplicitlyRequested(intent: ToolRelevanceIntent) {
  return [
    'router_reboot',
    'wifi_credentials_change',
    'payment_pix_generation',
    'payment_promise',
    'support_ticket_creation',
    'human_handoff',
    'close_conversation',
    'internal_note',
    'crm_update',
    'external_action',
  ].includes(intent);
}

function isUnsafeToolForRequestedIntents(tool: AgentToolCatalogItem, requestedIntents: Set<ToolRelevanceIntent>) {
  const text = toolText(tool);
  if (/\b(bloqueada para ia|bloqueado para ia|blocked for ai|ai blocked)\b/.test(text)) {
    return true;
  }
  if (
    requestedIntents.has('wifi_credentials_lookup')
    && !requestedIntents.has('router_reboot')
    && /\b(reboot_router|reboot|reiniciar)\b/.test(text)
  ) {
    return true;
  }
  if (
    requestedIntents.has('wifi_credentials_lookup') &&
    !requestedIntents.has('wifi_credentials_change') &&
    /\b(change_wifi_credentials|trocar.*wifi|alterar.*wifi|credentials)\b/.test(text)
  ) {
    return true;
  }
  const onlyReadIntents = [...requestedIntents].every((intent) => !sideEffectExplicitlyRequested(intent));
  if (onlyReadIntents && tool.sideEffect === 'high') return true;
  return false;
}

export function buildToolRelevanceMap(input: {
  conversation: Array<{ role: 'user' | 'assistant'; content: string }>;
  architecture?: FlowBuilderOutput | null;
  currentSystemPrompt?: string | null;
  tools: AgentToolCatalogItem[];
}): ToolRelevanceEntry[] {
  const requestSearchText = normalizeSearchText([
    input.currentSystemPrompt || '',
    input.conversation.map((message) => message.content).join('\n'),
  ].join('\n'));
  const searchText = normalizeSearchText([
    input.currentSystemPrompt || '',
    input.conversation.map((message) => message.content).join('\n'),
    input.architecture?.summary || '',
    input.architecture?.procedureManifest || '',
    input.architecture?.systemPrompt || '',
    ...(input.architecture?.nodes || []).flatMap((node) => [
      node.title,
      node.subtitle,
      node.instructions || '',
      node.message || '',
      ...(node.routes || []).flatMap((route) => [route.label, route.description, ...(route.examples || [])]),
    ]),
  ].join('\n'));
  // Generated architecture text may describe safety branches that the user did not request.
  // Never let model-generated text authorize a mutating capability.
  const requestedIntents = inferRequestedToolIntents(requestSearchText);
  if (requestsExternalAction(requestSearchText)) {
    requestedIntents.add('external_action');
  }
  if (requestedIntents.size === 0) return [];

  const entries: ToolRelevanceEntry[] = [];
  for (const tool of input.tools) {
    if (isUnsafeToolForRequestedIntents(tool, requestedIntents)) continue;
    const matched: ToolRelevanceIntent[] = [];
    let score = 0;
    for (const intent of requestedIntents) {
      const intentScore = scoreToolForIntent(
        tool,
        intent,
        intent === 'external_action' ? requestSearchText : searchText,
      );
      if (intentScore > 0) {
        matched.push(intent);
        score += intentScore;
      }
    }
    if (score <= 0) continue;
    const hasExplicitSideEffectIntent = matched.some(sideEffectExplicitlyRequested);
    const safeScore = tool.sideEffect === 'high' && !hasExplicitSideEffectIntent
      ? Math.min(score, 4)
      : score;
    if (safeScore < 5) continue;
    entries.push({
      toolName: tool.name,
      intents: matched,
      score: safeScore,
      reason: `Relevante para ${matched.join(', ')} usando nome, descricao e schema da ferramenta.`,
      source: tool.source,
      sideEffect: tool.sideEffect,
      riskLevel: tool.riskLevel,
      description: tool.description,
    });
  }

  return entries
    .sort((left, right) => right.score - left.score || left.toolName.localeCompare(right.toolName))
    .slice(0, 18);
}

function formatToolRelevanceMap(entries: ToolRelevanceEntry[]) {
  if (entries.length === 0) return 'Nenhuma ferramenta habilitada parece necessaria para este pedido.';
  return entries.map((entry) => (
    `- ${entry.toolName} | intents=${entry.intents.join(',')} | score=${entry.score} | sideEffect=${entry.sideEffect} | risco=${entry.riskLevel} | ${entry.reason} Descricao: ${entry.description}`
  )).join('\n');
}

function findBestAttachNode(flow: FlowBuilderOutput, entry: ToolRelevanceEntry): FlowBuilderOutput['nodes'][number] | null {
  const text = normalizeSearchText(`${entry.toolName} ${entry.intents.join(' ')} ${entry.description}`);
  const candidates = flow.nodes.filter((node) => ['sub_agent', 'collect', 'message'].includes(node.kind));
  if (candidates.length === 0) return null;
  const qualifiedToolName = normalizeSearchText(entry.toolName);
  const dedicatedCandidates = candidates.filter((node) => (
    normalizeSearchText(`${node.title} ${node.subtitle} ${node.instructions || ''}`).includes(qualifiedToolName)
  ));
  if (dedicatedCandidates.length > 0) {
    if (entry.sideEffect !== 'none') {
      return dedicatedCandidates.find((node) => node.kind === 'message')
        || dedicatedCandidates.find((node) => node.kind === 'collect')
        || dedicatedCandidates[0];
    }
    return dedicatedCandidates.find((node) => node.kind === 'collect')
      || dedicatedCandidates.find((node) => node.kind === 'message')
      || dedicatedCandidates[0];
  }
  if (entry.intents.includes('customer_contract_lookup')) {
    return candidates.find((node) => node.kind === 'collect') || candidates.find((node) => node.kind === 'sub_agent') || candidates[0];
  }
  if (entry.intents.some((intent) => [
    'order_status_lookup',
    'billing_lookup',
    'document_lookup',
    'availability_lookup',
    'scheduling_lookup',
  ].includes(intent))) {
    return candidates.find((node) => node.kind === 'collect') || candidates.find((node) => node.kind === 'sub_agent') || candidates[0];
  }
  if (/\b(change|trocar|credentials|senha|ssid)\b/.test(text)) {
    return candidates.find((node) => normalizeSearchText(`${node.title} ${node.subtitle}`).match(/\b(wifi|wi fi|senha|credencia|trocar|alterar)\b/))
      || candidates.find((node) => node.kind === 'sub_agent')
      || candidates[0];
  }
  return candidates.find((node) => node.kind === 'sub_agent') || candidates[0];
}

function toolTitleFromEntry(entry: ToolRelevanceEntry) {
  if (entry.intents.includes('wifi_credentials_lookup')) return 'Consultar Wi-Fi atual';
  if (entry.intents.includes('wifi_channel_diagnostics')) return 'Diagnosticar canais Wi-Fi';
  if (entry.intents.includes('wifi_credentials_change')) return 'Trocar credenciais Wi-Fi';
  if (entry.intents.includes('router_reboot')) return 'Reiniciar roteador';
  if (entry.intents.includes('customer_contract_lookup')) return 'Validar cliente e contrato';
  if (entry.intents.includes('order_status_lookup')) return 'Consultar status';
  if (entry.intents.includes('billing_lookup')) return 'Consultar financeiro';
  if (entry.intents.includes('payment_pix_generation')) return 'Gerar PIX';
  if (entry.intents.includes('payment_promise')) return 'Registrar promessa';
  if (entry.intents.includes('support_ticket_creation')) return 'Registrar chamado';
  if (entry.intents.includes('catalog_lookup')) return 'Consultar catalogo';
  if (entry.intents.includes('pricing_lookup')) return 'Consultar precos';
  if (entry.intents.includes('availability_lookup')) return 'Consultar disponibilidade';
  if (entry.intents.includes('scheduling_lookup')) return 'Consultar agenda';
  if (entry.intents.includes('document_lookup')) return 'Consultar documento';
  if (entry.intents.includes('external_read')) return 'Consulta externa';
  return entry.toolName.split(':').at(-1) || entry.toolName;
}

export function ensureToolRelevanceCoverage(
  architecture: FlowBuilderOutput,
  tools: AgentToolCatalogItem[],
  relevanceMap: ToolRelevanceEntry[],
): FlowBuilderOutput {
  if (relevanceMap.length === 0) return architecture;
  const availableTools = new Map<string, AgentToolCatalogItem>(tools.map((tool) => [tool.name, tool]));
  const nodes = [...architecture.nodes];
  const edges = [...architecture.edges];
  const existingToolNames = new Set(nodes.filter((node) => node.kind === 'tool').map((node) => node.toolName).filter(Boolean));

  for (const entry of relevanceMap) {
    const tool = availableTools.get(entry.toolName);
    if (!tool || existingToolNames.has(entry.toolName)) continue;
    const attachTo = findBestAttachNode({ ...architecture, nodes }, entry);
    if (!attachTo) continue;
    const id = `tool-${normalizeId(entry.toolName, 'acao')}`;
    const toolNode: FlowBuilderOutput['nodes'][number] = {
      id,
      kind: 'tool',
      title: toolTitleFromEntry(entry),
      subtitle: tool.source === 'mcp' ? `MCP qualificada: ${tool.name}` : tool.description,
      x: attachTo.x + 300,
      y: attachTo.y + 160 + (nodes.filter((node) => node.kind === 'tool').length * 130),
      toolName: tool.name,
      instructions: [
        `Ferramenta real: ${tool.name}. Nunca referencie esta MCP como mcp_call_tool no planejamento; mcp_call_tool e apenas detalhe interno do executor.`,
        `Criterio de uso: ${entry.reason}`,
        `Descricao/schema: ${tool.description}`,
        tool.sideEffect === 'high'
          ? 'Tem side effect alto: exige pedido explicito, confirmacao clara do cliente e nunca deve ser usada em teste destrutivo sem autorizacao.'
          : 'Use somente apos validar dados necessarios e mantenha a resposta alinhada ao pedido atual do cliente.',
      ].join(' '),
      referenceId: id.replace(/-/g, '_'),
      inputSchema: tool.inputSchema || undefined,
      outputSchema: tool.outputSchema || undefined,
      maxAttempts: tool.maxAttempts || 1,
      errorHandles: ['error'],
    };
    nodes.push(toolNode);
    existingToolNames.add(entry.toolName);
    const isDedicatedCapability = attachTo.id.startsWith('cap-');
    if (isDedicatedCapability) {
      for (let edgeIndex = edges.length - 1; edgeIndex >= 0; edgeIndex -= 1) {
        if (edges[edgeIndex].source === attachTo.id && !edges[edgeIndex].routeId) {
          edges.splice(edgeIndex, 1);
        }
      }
    }
    if (!edges.some((edge) => edge.source === attachTo.id && edge.target === toolNode.id)) {
      edges.push({ source: attachTo.id, target: toolNode.id });
    }
    if (isDedicatedCapability) {
      const principal = nodes.find((node) => node.kind === 'sub_agent');
      if (principal && !edges.some((edge) => edge.source === toolNode.id && edge.target === principal.id)) {
        edges.push({ source: toolNode.id, target: principal.id });
      }
    }
  }

  return { ...architecture, nodes, edges };
}

type WifiBranchDefinition = {
  routeId: string;
  intent: Extract<
    ToolRelevanceIntent,
    'wifi_credentials_lookup' | 'wifi_channel_diagnostics' | 'wifi_credentials_change' | 'router_reboot'
  >;
  slug: string;
  title: string;
  collectTitle: string;
};

const WIFI_BRANCH_DEFINITIONS: WifiBranchDefinition[] = [
  {
    routeId: 'consultar_wifi',
    intent: 'wifi_credentials_lookup',
    slug: 'consulta',
    title: 'Responder credenciais Wi-Fi',
    collectTitle: 'Validar cliente para consultar Wi-Fi',
  },
  {
    routeId: 'diagnosticar_wifi',
    intent: 'wifi_channel_diagnostics',
    slug: 'diagnostico',
    title: 'Responder diagnostico Wi-Fi',
    collectTitle: 'Validar cliente para diagnosticar Wi-Fi',
  },
  {
    routeId: 'trocar_wifi',
    intent: 'wifi_credentials_change',
    slug: 'troca',
    title: 'Confirmar resultado da troca de Wi-Fi',
    collectTitle: 'Coletar e confirmar nova configuracao Wi-Fi',
  },
  {
    routeId: 'reiniciar_roteador',
    intent: 'router_reboot',
    slug: 'reboot',
    title: 'Confirmar resultado do reboot',
    collectTitle: 'Validar cliente e confirmar reboot',
  },
];

function uniqueFormFields(
  fields: NonNullable<ArchitectureFlowBuilderOutput['nodes'][number]['formFields']>,
) {
  const seen = new Set<string>();
  return fields.filter((field) => {
    const key = String(field.fieldKey || field.id).trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function wifiBranchFields(
  definition: WifiBranchDefinition,
  branchTools: AgentToolCatalogItem[],
): NonNullable<ArchitectureFlowBuilderOutput['nodes'][number]['formFields']> {
  const customerIdentifier = {
    id: `wifi-${definition.slug}-customer-identifier`,
    label: 'CPF, CNPJ ou contrato',
    fieldKey: 'customer_identifier',
    type: 'document' as const,
    required: true,
    aliases: ['cpf', 'cnpj', 'contrato', 'codigo do cliente'],
  };
  const schemaFields = branchTools.flatMap((tool) => fallbackCapabilityFormFields(tool));

  if (definition.intent === 'wifi_credentials_change') {
    return uniqueFormFields([
      customerIdentifier,
      ...schemaFields,
      {
        id: 'wifi-change-requested-value',
        label: 'Novo nome ou nova senha solicitada',
        fieldKey: 'wifi_requested_change',
        type: 'text',
        required: true,
        aliases: ['novo nome', 'nova senha', 'ssid', 'password'],
      },
      {
        id: 'wifi-change-confirmation',
        label: 'Confirmacao explicita da alteracao',
        fieldKey: 'wifi_change_confirmation',
        type: 'text',
        required: true,
        aliases: ['confirmo', 'pode alterar', 'autorizo'],
      },
    ]);
  }
  if (definition.intent === 'router_reboot') {
    return uniqueFormFields([
      customerIdentifier,
      ...schemaFields,
      {
        id: 'wifi-reboot-confirmation',
        label: 'Confirmacao explicita do reboot',
        fieldKey: 'router_reboot_confirmation',
        type: 'text',
        required: true,
        aliases: ['confirmo', 'pode reiniciar', 'autorizo'],
      },
    ]);
  }
  if (definition.intent === 'wifi_channel_diagnostics') {
    return uniqueFormFields([
      customerIdentifier,
      ...schemaFields,
      {
        id: 'wifi-diagnostic-symptom',
        label: 'Sintoma observado',
        fieldKey: 'wifi_symptom',
        type: 'text',
        required: false,
        aliases: ['lentidao', 'queda', 'oscilacao', 'interferencia'],
      },
    ]);
  }
  return uniqueFormFields([customerIdentifier, ...schemaFields]);
}

function wifiToolOrder(toolName: string) {
  const normalized = normalizeSearchText(toolName);
  if (/sgp|contract|customer|cliente/.test(normalized)) return 10;
  if (/get_router|router_view/.test(normalized)) return 20;
  if (/list_connected|connected_devices/.test(normalized)) return 30;
  if (/scan_wifi_neighbors|scan_neighbors/.test(normalized)) return 40;
  if (/get_wifi_scan_cached|scan_cached|cached_scan/.test(normalized)) return 50;
  return 60;
}

export function ensureWifiBranchIsolation(
  architecture: FlowBuilderOutput,
  tools: AgentToolCatalogItem[],
  relevanceMap: ToolRelevanceEntry[],
): FlowBuilderOutput {
  const decision = architecture.nodes.find((node) => (
    node.kind === 'decision'
    && WIFI_BRANCH_DEFINITIONS.some((definition) => node.routes?.some((route) => route.id === definition.routeId))
  ));
  if (!decision) return architecture;

  const activeDefinitions = WIFI_BRANCH_DEFINITIONS.filter((definition) => (
    decision.routes?.some((route) => route.id === definition.routeId)
  ));
  const toolByName = new Map(tools.map((tool) => [String(tool.name), tool]));
  const specializedWifiIntents = new Set<ToolRelevanceIntent>(
    WIFI_BRANCH_DEFINITIONS.map((definition) => definition.intent),
  );
  const dominantWifiIntent = (entry: ToolRelevanceEntry) => {
    const tool = toolByName.get(entry.toolName);
    const name = normalizeSearchText(entry.toolName.split(':').at(-1) || entry.toolName);
    const text = normalizeSearchText(`${entry.toolName} ${tool?.description || entry.description}`);
    if (/^(reboot_router|reboot|restart_router)/.test(name)) return 'router_reboot' as const;
    if (/^(change_wifi_credentials|update_wifi_credentials|set_wifi_credentials)/.test(name)) {
      return 'wifi_credentials_change' as const;
    }
    if (/^(get_wifi_view|wifi_view|refresh_wifi_summary|wifi_summary)/.test(name)) {
      return 'wifi_credentials_lookup' as const;
    }
    if (/(scan|neighbor|channel|connected|device|get_router|mesh|topolog|queue_get|find_router)/.test(name)) {
      return 'wifi_channel_diagnostics' as const;
    }
    if (/\b(reboot_router|reboot|reiniciar)\w*/.test(text)) return 'router_reboot' as const;
    if (/\b(change_wifi_credentials|update_wifi_credentials|trocar.*wifi|alterar.*wifi)\w*/.test(text)) {
      return 'wifi_credentials_change' as const;
    }
    if (/\b(get_wifi_view|wifi_view|refresh_wifi_summary|wifi_summary)\w*/.test(text)) {
      return 'wifi_credentials_lookup' as const;
    }
    if (/\b(scan|neighbor|channel|canal|connected|device|router|mesh|topolog|queue_get|find_router)\w*/.test(text)) {
      return 'wifi_channel_diagnostics' as const;
    }
    const matched = entry.intents.filter((intent) => specializedWifiIntents.has(intent));
    return matched.length === 1 ? matched[0] : null;
  };
  const isContractValidationEntry = (entry: ToolRelevanceEntry) => (
    (
      entry.toolName === 'sgp_fetch_contact_panel_data'
      || entry.toolName === 'sgp_fetch_contracts'
      || entry.intents.includes('customer_contract_lookup')
    )
    && !dominantWifiIntent(entry)
    && !entry.intents.some((intent) => specializedWifiIntents.has(intent))
  );
  const wifiEntries = relevanceMap.filter((entry) => (
    isContractValidationEntry(entry)
    || activeDefinitions.some((definition) => dominantWifiIntent(entry) === definition.intent)
  ));
  const wifiToolNames = new Set(wifiEntries.map((entry) => entry.toolName));
  const obsoleteNodeIds = new Set(
    architecture.nodes
      .filter((node) => (
        node.id === 'validar-cliente'
        || node.id === 'coleta-credenciais-wifi'
        || node.id === 'confirmar-reboot'
        || node.id.startsWith('wifi-branch-')
        || (node.kind === 'tool' && Boolean(node.toolName && wifiToolNames.has(node.toolName)))
      ))
      .map((node) => node.id),
  );
  const nodes = architecture.nodes.filter((node) => !obsoleteNodeIds.has(node.id));
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const principal = nodes.find((node) => node.kind === 'sub_agent');
  const end = nodes.find((node) => node.kind === 'end');
  const knowledgeNodes = nodes.filter((node) => node.kind === 'knowledge');
  const activeRouteIds = new Set(activeDefinitions.map((definition) => definition.routeId));
  const edges = architecture.edges.filter((edge) => (
    !obsoleteNodeIds.has(edge.source)
    && !obsoleteNodeIds.has(edge.target)
    && !(edge.source === decision.id && Boolean(edge.routeId && activeRouteIds.has(edge.routeId)))
  ));
  const edgeKeys = new Set(edges.map((edge) => `${edge.source}:${edge.target}:${edge.routeId || ''}`));
  const addEdge = (source: string, target: string, routeId?: string) => {
    const sourceNode = nodeById.get(source);
    const targetNode = nodeById.get(target);
    const key = `${source}:${target}:${routeId || ''}`;
    if (!sourceNode || !targetNode || source === target || edgeKeys.has(key) || !canConnect(sourceNode.kind, targetNode.kind)) {
      return;
    }
    edgeKeys.add(key);
    edges.push({ source, target, ...(routeId ? { routeId } : {}) });
  };
  const nextRoutes = (decision.routes || []).map((route) => ({ ...route }));

  for (const [branchIndex, definition] of activeDefinitions.entries()) {
    const branchEntries = wifiEntries
      .filter((entry) => (
        isContractValidationEntry(entry)
        || dominantWifiIntent(entry) === definition.intent
      ))
      .filter((entry, index, entries) => entries.findIndex((candidate) => candidate.toolName === entry.toolName) === index)
      .sort((left, right) => (
        wifiToolOrder(left.toolName) - wifiToolOrder(right.toolName)
        || right.score - left.score
        || left.toolName.localeCompare(right.toolName)
      ));
    const branchTools = branchEntries
      .map((entry) => toolByName.get(entry.toolName))
      .filter((tool): tool is AgentToolCatalogItem => Boolean(tool));
    const collectId = `wifi-branch-${definition.slug}-collect`;
    const responseId = `wifi-branch-${definition.slug}-response`;
    const y = 220 + branchIndex * 300;
    const collectNode: FlowBuilderOutput['nodes'][number] = {
      id: collectId,
      kind: 'collect',
      title: definition.collectTitle,
      subtitle: definition.intent === 'wifi_credentials_change' || definition.intent === 'router_reboot'
        ? 'Side effect permitido somente com pedido e confirmacao explicitos'
        : 'Validacao isolada para esta intencao',
      x: 760,
      y,
      referenceId: collectId.replace(/-/g, '_'),
      formMode: 'ai',
      formFields: wifiBranchFields(definition, branchTools),
      instructions: definition.intent === 'wifi_credentials_change'
        ? 'Colete somente a mudanca solicitada e a confirmacao explicita. Nunca trate uma consulta de senha como pedido de alteracao.'
        : definition.intent === 'router_reboot'
          ? 'Exija pedido e confirmacao explicitos para reboot. Nunca use este branch para consultar credenciais ou diagnosticar canal.'
          : 'Valide o cliente e contrato sem pedir novamente dados ja confirmados no atendimento.',
    };
    const responseNode: FlowBuilderOutput['nodes'][number] = {
      id: responseId,
      kind: 'sub_agent',
      title: definition.title,
      subtitle: 'Responder somente com resultados deste branch',
      x: 1500,
      y,
      referenceId: responseId.replace(/-/g, '_'),
      requiredKnowledgeCoverage: 'low',
      instructions: [
        `Intencao exclusiva deste branch: ${definition.intent}.`,
        'Use somente resultados das ferramentas conectadas neste caminho.',
        'Nao execute nem proponha ferramentas de outro branch.',
        definition.intent === 'wifi_credentials_lookup'
          ? 'Entregue as credenciais confirmadas; nunca reinicie nem altere o roteador.'
          : definition.intent === 'wifi_channel_diagnostics'
            ? 'Analise evidencia real de canais, interferencia e dispositivos antes de recomendar; nao altere configuracao.'
            : 'Relate o resultado real da acao confirmada e nunca alegue sucesso sem retorno da ferramenta.',
      ].join(' '),
    };
    nodes.push(collectNode, responseNode);
    nodeById.set(collectId, collectNode);
    nodeById.set(responseId, responseNode);
    const route = nextRoutes.find((candidate) => candidate.id === definition.routeId);
    if (route) route.targetNodeId = collectId;
    addEdge(decision.id, collectId, definition.routeId);

    let previousId = collectId;
    for (const [toolIndex, entry] of branchEntries.entries()) {
      const tool = toolByName.get(entry.toolName);
      if (!tool) continue;
      const toolId = `wifi-branch-${definition.slug}-tool-${toolIndex + 1}-${normalizeId(tool.name, 'tool')}`;
      const toolNode: FlowBuilderOutput['nodes'][number] = {
        id: toolId,
        kind: 'tool',
        title: toolTitleFromEntry(entry),
        subtitle: tool.source === 'mcp' ? `MCP qualificada: ${tool.name}` : tool.description,
        x: 1020 + toolIndex * 260,
        y,
        toolName: tool.name,
        referenceId: toolId.replace(/-/g, '_'),
        inputSchema: tool.inputSchema || undefined,
        outputSchema: tool.outputSchema || undefined,
        maxAttempts: tool.maxAttempts || 1,
        errorHandles: ['error'],
        instructions: [
          toolInstructions(tool),
          `Branch autorizado: ${definition.intent}.`,
          `Nome de planejamento e log: ${tool.name}.`,
          'Para MCP, mcp_call_tool e apenas detalhe interno e nunca substitui o nome qualificado.',
        ].join(' '),
      };
      nodes.push(toolNode);
      nodeById.set(toolId, toolNode);
      addEdge(previousId, toolId);
      previousId = toolId;

      if (toolIndex < branchEntries.length - 1) {
        const bridgeId = `wifi-branch-${definition.slug}-bridge-${toolIndex + 1}`;
        const bridgeNode: FlowBuilderOutput['nodes'][number] = {
          id: bridgeId,
          kind: 'message',
          title: `Validar resultado ${toolIndex + 1}`,
          subtitle: 'Avancar somente com retorno util ou fallback seguro',
          x: 1150 + toolIndex * 260,
          y: y + 130,
          referenceId: bridgeId.replace(/-/g, '_'),
          message: 'Estou validando as informacoes antes de continuar.',
          instructions: 'Nao repita a ferramenta anterior sem novo dado. Se ela falhou, siga somente para um fallback read-only compativel ou responda com a limitacao real.',
        };
        nodes.push(bridgeNode);
        nodeById.set(bridgeId, bridgeNode);
        addEdge(previousId, bridgeId);
        previousId = bridgeId;
      }
    }
    addEdge(previousId, responseId);
    if (end) addEdge(responseId, end.id);
    for (const knowledgeNode of knowledgeNodes) addEdge(knowledgeNode.id, responseId);
  }

  const updatedDecision = {
    ...decision,
    routes: nextRoutes,
  };
  const updatedNodes = nodes.map((node) => node.id === decision.id ? updatedDecision : node);
  nodeById.set(decision.id, updatedDecision);
  if (principal && end) addEdge(principal.id, end.id);

  return { ...architecture, nodes: updatedNodes, edges };
}

function normalizeArchitectureOutput(architecture: ArchitectureFlowBuilderOutput): FlowBuilderOutput {
  return {
    ...architecture,
    nodes: architecture.nodes.map((node, index): FlowBuilderOutput['nodes'][number] => {
      const fallbackPosition = defaultFlowNodePosition(index);
      return {
        ...node,
        x: Number.isFinite(node.x) ? node.x as number : fallbackPosition.x,
        y: Number.isFinite(node.y) ? node.y as number : fallbackPosition.y,
      };
    }),
    edges: [],
  };
}

function fallbackSystemPrompt(input: {
  currentSystemPrompt?: string | null;
  conversation: Array<{ role: 'user' | 'assistant'; content: string }>;
}) {
  const basePrompt = cleanPromptText(input.currentSystemPrompt || '', 7600)
    || `Voce e um atendente Dialogy V2. Siga o fluxo conectado, use somente dados confirmados, consulte knowledge quando houver e transfira para humano quando o pedido exigir. Pedido original: ${cleanText(input.conversation.map((message) => message.content).join(' '), 900)}`;
  const safetyPrompt = [
    'Regras operacionais obrigatorias do fallback:',
    '- Quando usar MCP, raciocine e registre a ferramenta real pelo nome qualificado mcp:<server_id>:<tool_name>; mcp_call_tool e apenas detalhe interno de execucao.',
    '- Se o cliente pedir usuario, senha, SSID ou credenciais do Wi-Fi, valide cliente/contrato e consulte a ferramenta de visualizacao de Wi-Fi disponivel, como get_wifi_view. Nunca reinicie o roteador para esse pedido.',
    '- Diagnostico de Wi-Fi lento/canal deve consultar scan/cache/redes ao redor/dispositivos/roteador quando houver ferramentas habilitadas e responder com analise antes de qualquer acao sensivel.',
    '- Trocar nome/senha do Wi-Fi e reiniciar roteador exigem pedido explicito, novos valores quando aplicavel e confirmacao clara. Em testes reais, nao altere nome nem senha do Wi-Fi.',
    '- Se uma etapa ou ferramenta nao bater com a intencao atual do cliente, pare e faca uma pergunta curta de esclarecimento.',
  ].join('\n');
  return cleanPromptText(`${basePrompt}\n\n${safetyPrompt}`, 9000);
}

type FallbackCapabilitySpec = {
  entry: ToolRelevanceEntry;
  tool: AgentToolCatalogItem;
  slug: string;
  routeId: string;
  collectNodeId: string | null;
  confirmationNodeId: string | null;
  formFields: NonNullable<ArchitectureFlowBuilderOutput['nodes'][number]['formFields']>;
};

function fallbackSchemaFieldType(
  propertyName: string,
  property: Record<string, unknown>,
): 'text' | 'name' | 'phone' | 'email' | 'document' | 'date' | 'time' | 'address' | 'number' | 'boolean' {
  const text = normalizeSearchText([
    propertyName,
    property.title,
    property.description,
    property.format,
  ].filter(Boolean).join(' ')).replace(/[_-]+/g, ' ');
  const type = Array.isArray(property.type) ? property.type[0] : property.type;
  if (type === 'boolean') return 'boolean';
  if (type === 'integer' || type === 'number') return 'number';
  if (property.format === 'email' || /\bemail|e mail\b/.test(text)) return 'email';
  if (property.format === 'date' || /\bdate|data|dia\b/.test(text)) return 'date';
  if (property.format === 'time' || /\btime|hora|horario|periodo\b/.test(text)) return 'time';
  if (/\bphone|telefone|celular|whatsapp\b/.test(text)) return 'phone';
  if (/\bcpf|cnpj|document|documento|customer id|client id\b/.test(text)) return 'document';
  if (/\baddress|endereco|cep|street|rua\b/.test(text)) return 'address';
  if (/\bname|nome|responsavel|titular\b/.test(text)) return 'name';
  return 'text';
}

function fallbackCapabilityFormFields(
  tool: AgentToolCatalogItem,
): NonNullable<ArchitectureFlowBuilderOutput['nodes'][number]['formFields']> {
  const schema = tool.inputSchema as Record<string, unknown> | null | undefined;
  const properties = schema?.properties && typeof schema.properties === 'object' && !Array.isArray(schema.properties)
    ? schema.properties as Record<string, Record<string, unknown>>
    : {};
  const required = new Set([
    ...(Array.isArray(schema?.required) ? schema.required.map(String) : []),
    ...tool.requiredSlots.map(String),
  ]);

  return [...required]
    .slice(0, 16)
    .map((propertyName) => {
      const property = properties[propertyName] || {};
      const label = cleanText(
        String(property.title || property.description || propertyName).replace(/[_-]+/g, ' '),
        120,
      );
      return {
        id: normalizeId(`campo-${propertyName}`, 'campo'),
        label,
        fieldKey: propertyName,
        type: fallbackSchemaFieldType(propertyName, property),
        required: true,
        aliases: Array.from(new Set([
          propertyName,
          propertyName.replace(/[_-]+/g, ' '),
          label,
        ].map((value) => cleanText(value, 80)).filter(Boolean))).slice(0, 6),
      };
    });
}

function buildFallbackCapabilitySpecs(input: {
  conversation: Array<{ role: 'user' | 'assistant'; content: string }>;
  currentSystemPrompt?: string | null;
  tools: AgentToolCatalogItem[];
}): FallbackCapabilitySpec[] {
  const specializedIntents = new Set<ToolRelevanceIntent>([
    'customer_contract_lookup',
    'wifi_credentials_lookup',
    'wifi_credentials_change',
    'wifi_channel_diagnostics',
    'router_reboot',
    'order_status_lookup',
    'billing_lookup',
    'payment_pix_generation',
    'payment_promise',
    'support_ticket_creation',
    'catalog_lookup',
    'pricing_lookup',
    'availability_lookup',
    'scheduling_lookup',
    'document_lookup',
    'human_handoff',
    'close_conversation',
    'internal_note',
    'crm_update',
  ]);
  const relevance = buildToolRelevanceMap({
    conversation: input.conversation,
    currentSystemPrompt: input.currentSystemPrompt,
    tools: input.tools,
  });
  const toolByName = new Map<string, AgentToolCatalogItem>(
    input.tools.map((tool) => [String(tool.name), tool]),
  );

  return relevance
    .filter((entry) => (
      entry.source === 'mcp' &&
      (
        entry.intents.includes('external_action') ||
        (
          entry.intents.includes('external_read') &&
          !entry.intents.some((intent) => specializedIntents.has(intent))
        )
      )
    ))
    .slice(0, 6)
    .map((entry): FallbackCapabilitySpec | null => {
      const tool = toolByName.get(entry.toolName);
      if (!tool) return null;
      const slug = normalizeId(entry.toolName.replace(/^mcp:/, ''), 'capacidade').replace(/_/g, '-');
      const formFields = fallbackCapabilityFormFields(tool);
      return {
        entry,
        tool,
        slug,
        routeId: `cap_${slug}`,
        collectNodeId: formFields.length > 0 ? `cap-coletar-${slug}` : null,
        confirmationNodeId: tool.sideEffect !== 'none' ? `cap-confirmar-${slug}` : null,
        formFields,
      };
    })
    .filter((spec): spec is FallbackCapabilitySpec => Boolean(spec));
}

export function buildFallbackArchitecture(input: {
  conversation: Array<{ role: 'user' | 'assistant'; content: string }>;
  currentSystemPrompt?: string | null;
  tools?: AgentToolCatalogItem[];
}, _error: unknown): ArchitectureFlowBuilderOutput {
  const requestText = input.conversation.map((message) => message.content).join('\n');
  const normalizedRequest = normalizeSearchText(requestText);
  const requestedIntents = inferRequestedToolIntents(normalizedRequest);
  const isWifiSupportFlow = requestedIntents.has('wifi_credentials_lookup')
    || requestedIntents.has('wifi_credentials_change')
    || requestedIntents.has('wifi_channel_diagnostics')
    || requestedIntents.has('router_reboot')
    || /\b(wi[\s-]?fi|wifi|ssid|senha|usuario|credencia|roteador|modem|canal|interferencia|lentidao|lento)\w*/.test(normalizedRequest);
  const isOrderStatusFlow = requestedIntents.has('order_status_lookup');
  const isBillingFlow = requestedIntents.has('billing_lookup')
    || requestedIntents.has('payment_pix_generation')
    || requestedIntents.has('payment_promise');
  const isSchedulingFlow = requestedIntents.has('scheduling_lookup');
  const isDocumentFlow = requestedIntents.has('document_lookup');
  const isCommercialLookupFlow = requestedIntents.has('catalog_lookup')
    || requestedIntents.has('pricing_lookup')
    || requestedIntents.has('availability_lookup');
  const needsOrderIdentifier = isOrderStatusFlow;
  const needsScheduleCollection = isSchedulingFlow;
  const needsCustomerValidation = isWifiSupportFlow
    || requestedIntents.has('customer_contract_lookup')
    || isBillingFlow
    || isDocumentFlow;
  const needsGenericCollection = /\b(nome|telefone|email|cpf|cnpj|documento|endereco|endere[cç]o|data|horario|agend|orcamento|or[cç]amento|pedido|cadastro|lead|contratar|comprar)\b/.test(normalizedRequest);
  const needsCollection = needsCustomerValidation || needsOrderIdentifier || needsScheduleCollection || needsGenericCollection;
  const includeHandoff = /\b(humano|atendente|transfer|equipe|suporte|especialista|vendedor)\b/.test(normalizedRequest) || true;
  const capabilitySpecs = isWifiSupportFlow
    ? []
    : buildFallbackCapabilitySpecs({
        conversation: input.conversation,
        currentSystemPrompt: input.currentSystemPrompt,
        tools: input.tools || [],
      });
  const decisionRoutes: NonNullable<ArchitectureFlowBuilderOutput['nodes'][number]['routes']> = isWifiSupportFlow
    ? [
      {
        id: 'consultar_wifi',
        label: 'Consultar Wi-Fi atual',
        description: 'Cliente pediu usuario, senha, SSID, nome da rede ou credenciais atuais do Wi-Fi.',
        examples: ['Esqueci a senha do Wi-Fi', 'Qual o usuario e senha?', 'Me passa o nome da rede'],
        targetNodeId: needsCustomerValidation ? 'validar-cliente' : 'agente-principal',
      },
      {
        id: 'diagnosticar_wifi',
        label: 'Diagnosticar Wi-Fi lento',
        description: 'Cliente relata lentidao, oscilacao, queda, interferencia, canal ruim ou redes ao redor.',
        examples: ['Meu Wi-Fi esta lento', 'Analisa os canais', 'Tem muita rede ao redor?'],
        targetNodeId: needsCustomerValidation ? 'validar-cliente' : 'agente-principal',
      },
      {
        id: 'trocar_wifi',
        label: 'Trocar nome ou senha',
        description: 'Cliente pediu explicitamente alteracao de SSID, nome da rede ou senha do Wi-Fi.',
        examples: ['Quero trocar a senha', 'Muda o nome da rede', 'Coloca uma senha nova'],
        targetNodeId: 'coleta-credenciais-wifi',
      },
      {
        id: 'reiniciar_roteador',
        label: 'Reiniciar roteador',
        description: 'Cliente pediu explicitamente reboot/reinicio do roteador ou modem.',
        examples: ['Pode reiniciar o roteador', 'Reinicia meu modem', 'Faz um reboot'],
        targetNodeId: 'confirmar-reboot',
      },
      ...(includeHandoff ? [{
        id: 'humano',
        label: 'Atendente humano',
        description: 'Cliente pediu humano, caso sensivel ou baixa confianca apos tentativa segura.',
        examples: ['Quero falar com atendente', 'Me transfere', 'Preciso de um humano'],
        targetNodeId: 'transferencia-humana',
      }] : []),
      {
        id: 'fallback',
        label: 'Esclarecer intencao',
        description: 'Pedido ambiguo, fora do procedimento de Wi-Fi ou baixa confianca.',
        examples: ['Nao era isso', 'Tenho outro assunto'],
        targetNodeId: 'agente-principal',
      },
    ]
    : [
      ...capabilitySpecs.map((spec) => ({
        id: spec.routeId,
        label: toolTitleFromEntry(spec.entry).replace(/[_-]+/g, ' '),
        description: `Executar a capacidade real ${spec.tool.name} somente quando o pedido corresponder a: ${spec.tool.description}`,
        examples: input.conversation
          .filter((message) => message.role === 'user')
          .map((message) => cleanText(message.content, 180))
          .filter(Boolean)
          .slice(-2),
        targetNodeId: spec.collectNodeId || spec.confirmationNodeId || 'agente-principal',
      })),
      ...(isOrderStatusFlow ? [{
        id: 'status_pedido',
        label: 'Status de pedido ou protocolo',
        description: 'Cliente quer consultar andamento, rastreio, previsao ou situacao de pedido, protocolo, ticket ou chamado.',
        examples: ['Qual o status do meu pedido?', 'Rastrear pedido AB1234', 'Como esta meu protocolo?'],
        targetNodeId: 'coleta-pedido',
      }] : []),
      ...(isBillingFlow ? [{
        id: 'financeiro',
        label: 'Financeiro',
        description: 'Cliente pediu boleto, fatura, vencimento, PIX, debito ou promessa de pagamento.',
        examples: ['Preciso da segunda via', 'Gerar PIX da fatura', 'Quero negociar pagamento'],
        targetNodeId: needsCustomerValidation ? 'validar-cliente' : 'agente-principal',
      }] : []),
      ...(isSchedulingFlow ? [{
        id: 'agendamento',
        label: 'Agendamento',
        description: 'Cliente quer agendar, marcar, remarcar ou consultar horarios disponiveis.',
        examples: ['Quero agendar uma visita', 'Tem horario amanha?', 'Remarcar consulta'],
        targetNodeId: 'coleta-agendamento',
      }] : []),
      ...(isCommercialLookupFlow ? [{
        id: 'consulta_comercial',
        label: 'Catalogo, preco ou disponibilidade',
        description: 'Cliente pediu catalogo, produtos, servicos, valores, estoque ou disponibilidade.',
        examples: ['Quais produtos voces tem?', 'Qual o preco?', 'Tem em estoque?'],
        targetNodeId: 'agente-principal',
      }] : []),
      {
        id: 'coleta_dados',
        label: 'Coletar dados',
        description: 'Cliente quer seguir com atendimento, orcamento, compra, cadastro ou agendamento.',
        examples: ['Quero contratar', 'Quero fazer um orcamento', 'Quero agendar'],
        targetNodeId: needsCollection ? 'coleta-dados' : 'agente-principal',
      },
      {
        id: 'duvida_suporte',
        label: 'Duvida ou suporte',
        description: 'Cliente fez uma pergunta, pediu orientacao, detalhes ou suporte.',
        examples: ['Tenho uma duvida', 'Como funciona?', 'Preciso de ajuda'],
        targetNodeId: 'agente-principal',
      },
      ...(includeHandoff ? [{
        id: 'humano',
        label: 'Atendente humano',
        description: 'Cliente pediu humano, negociacao sensivel ou caso que exige equipe.',
        examples: ['Quero falar com atendente', 'Me transfere', 'Preciso de um humano'],
        targetNodeId: 'transferencia-humana',
      }] : []),
      {
        id: 'fallback',
        label: 'Esclarecer intencao',
        description: 'Baixa confianca, mudanca de assunto ou intencao fora do procedimento.',
        examples: ['Nao era isso', 'Tenho outro assunto'],
        targetNodeId: 'agente-principal',
      },
    ];
  const nodes: ArchitectureFlowBuilderOutput['nodes'] = [
    {
      id: 'inicio',
      kind: 'start',
      title: 'Início do atendimento',
      subtitle: 'Entrada segura do fluxo',
      referenceId: 'inicio',
    },
    {
      id: 'boas-vindas',
      kind: 'message',
      title: 'Boas-vindas e triagem',
      subtitle: 'Apresentar o atendimento e entender o objetivo do cliente',
      referenceId: 'boas_vindas',
    },
    {
      id: 'triagem',
      kind: 'decision',
      title: 'Triagem inteligente',
      subtitle: isWifiSupportFlow
        ? 'Separar consulta Wi-Fi, diagnostico, troca, reboot e humano'
        : 'Classificar intencao, baixa confianca e pedido humano',
      referenceId: 'triagem',
      switchMode: 'ai',
      confidenceThreshold: 0.8,
      fallbackRouteId: 'fallback',
      routes: decisionRoutes,
    },
    ...(needsCustomerValidation ? [{
      id: 'validar-cliente',
      kind: 'collect' as const,
      title: 'Validar cliente e contrato',
      subtitle: isWifiSupportFlow
        ? 'Confirmar identificador minimo antes de consultar dados do roteador'
        : 'Confirmar identificador minimo antes de consultar dados sensiveis',
      referenceId: 'validar_cliente',
      formMode: 'ai' as const,
      formFields: [
        { id: 'cpf_cnpj_contrato', label: 'CPF, CNPJ ou contrato', fieldKey: 'customer_identifier', type: 'text' as const, required: true, aliases: ['cpf', 'cnpj', 'contrato', 'codigo do cliente'] },
      ],
    }] : []),
    ...(isWifiSupportFlow ? [{
      id: 'coleta-credenciais-wifi',
      kind: 'collect' as const,
      title: 'Coletar nova configuracao Wi-Fi',
      subtitle: 'Somente para pedido explicito de troca; nao executar alteracao em teste real',
      referenceId: 'coleta_credenciais_wifi',
      formMode: 'ai' as const,
      formFields: [
        { id: 'novo_ssid', label: 'Novo nome da rede', fieldKey: 'wifi_ssid', type: 'text' as const, required: false, aliases: ['ssid', 'nome da rede', 'rede'] },
        { id: 'nova_senha_wifi', label: 'Nova senha do Wi-Fi', fieldKey: 'wifi_password', type: 'text' as const, required: false, aliases: ['senha', 'senha nova', 'password'] },
        { id: 'confirmacao_alteracao', label: 'Confirmacao explicita', fieldKey: 'wifi_change_confirmation', type: 'text' as const, required: true, aliases: ['confirmo', 'pode alterar', 'autorizo'] },
      ],
    }, {
      id: 'confirmar-reboot',
      kind: 'message' as const,
      title: 'Confirmar reboot',
      subtitle: 'Reboot so pode seguir com pedido explicito e confirmacao clara',
      referenceId: 'confirmar_reboot',
    }] : []),
    ...(needsOrderIdentifier ? [{
      id: 'coleta-pedido',
      kind: 'collect' as const,
      title: 'Coletar pedido ou protocolo',
      subtitle: 'Identificador necessario para consulta externa precisa',
      referenceId: 'coleta_pedido',
      formMode: 'ai' as const,
      formFields: [
        { id: 'pedido_protocolo', label: 'Pedido, protocolo, ticket ou chamado', fieldKey: 'order_or_request_id', type: 'text' as const, required: true, aliases: ['pedido', 'protocolo', 'ticket', 'chamado', 'rastreio'] },
      ],
    }] : []),
    ...(needsScheduleCollection ? [{
      id: 'coleta-agendamento',
      kind: 'collect' as const,
      title: 'Coletar dados de agendamento',
      subtitle: 'Preferencia de data, horario e objetivo',
      referenceId: 'coleta_agendamento',
      formMode: 'ai' as const,
      formFields: [
        { id: 'data_preferida', label: 'Data preferida', fieldKey: 'date', type: 'date' as const, required: false, aliases: ['data', 'dia', 'quando'] },
        { id: 'horario_preferido', label: 'Horario preferido', fieldKey: 'time', type: 'time' as const, required: false, aliases: ['horario', 'hora', 'periodo'] },
        { id: 'objetivo_agendamento', label: 'Objetivo do agendamento', fieldKey: 'objetivo', type: 'text' as const, required: true, aliases: ['motivo', 'servico', 'assunto'] },
      ],
    }] : []),
    ...(needsCollection && !needsCustomerValidation && !needsOrderIdentifier && !needsScheduleCollection ? [{
      id: 'coleta-dados',
      kind: 'collect' as const,
      title: 'Coleta de dados essenciais',
      subtitle: 'Confirmar dados minimos antes de avancar',
      referenceId: 'coleta_dados',
      formMode: 'ai' as const,
      formFields: [
        { id: 'nome', label: 'Nome', fieldKey: 'nome', type: 'name' as const, required: true, aliases: ['nome', 'como se chama'] },
        { id: 'telefone', label: 'Telefone', fieldKey: 'telefone', type: 'phone' as const, required: false, aliases: ['telefone', 'whatsapp', 'celular'] },
        { id: 'objetivo', label: 'Objetivo', fieldKey: 'objetivo', type: 'text' as const, required: true, aliases: ['objetivo', 'necessidade', 'pedido'] },
      ],
    }] : []),
    ...capabilitySpecs.flatMap((spec): ArchitectureFlowBuilderOutput['nodes'] => {
      const capabilityNodes: ArchitectureFlowBuilderOutput['nodes'] = [];
      if (spec.collectNodeId) {
        capabilityNodes.push({
          id: spec.collectNodeId,
          kind: 'collect',
          title: `Dados para ${toolTitleFromEntry(spec.entry).replace(/[_-]+/g, ' ')}`,
          subtitle: `Campos obrigatorios do schema de ${spec.tool.name}`,
          referenceId: normalizeReferenceKey(spec.collectNodeId),
          formMode: 'ai',
          formFields: spec.formFields,
          requiredSlots: spec.formFields.map((field) => String(field.fieldKey || field.id)),
        });
      }
      if (spec.confirmationNodeId) {
        capabilityNodes.push({
          id: spec.confirmationNodeId,
          kind: 'message',
          title: `Confirmar ${toolTitleFromEntry(spec.entry).replace(/[_-]+/g, ' ')}`,
          subtitle: `Confirmacao explicita vinculada aos argumentos de ${spec.tool.name}`,
          referenceId: normalizeReferenceKey(spec.confirmationNodeId),
        });
      }
      return capabilityNodes;
    }),
    {
      id: 'base-conhecimento',
      kind: 'knowledge',
      title: 'Base de conhecimento',
      subtitle: isWifiSupportFlow
        ? 'Consultar politicas de validacao, contrato, Wi-Fi e ferramentas habilitadas'
        : 'Consultar politicas, produtos, servicos e contexto salvo',
      referenceId: 'base_conhecimento',
      requiredKnowledgeCoverage: 'medium',
    },
    {
      id: 'agente-principal',
      kind: 'sub_agent',
      title: isWifiSupportFlow ? 'Atendimento Wi-Fi seguro' : 'Agente principal',
      subtitle: isWifiSupportFlow
        ? 'Usar ferramenta coerente com a intencao atual e bloquear acoes fora do pedido'
        : 'Responder com grounding, clareza e proximo passo',
      referenceId: 'agente_principal',
      requiredKnowledgeCoverage: 'low',
    },
    {
      id: 'encerramento',
      kind: 'end',
      title: 'Encerramento',
      subtitle: 'Finalizar quando o objetivo estiver concluído',
      referenceId: 'encerramento',
    },
    ...(includeHandoff ? [{
      id: 'transferencia-humana',
      kind: 'handoff' as const,
      title: 'Transferencia humana',
      subtitle: 'Encaminhar para a equipe quando necessario',
      referenceId: 'transferencia_humana',
    }] : []),
  ];
  const fallbackGoal = cleanText(requestText, 1500) || 'atendimento geral';
  const summary = isWifiSupportFlow
    ? 'Fluxo de Wi-Fi montado pelo modo deterministico com validacao de cliente, consulta, diagnostico e protecao contra acoes sensiveis.'
    : 'Fluxo operacional montado pelo modo deterministico com triagem, coleta segura, base de conhecimento, atendimento e transferencia quando necessario.';

  return {
    summary,
    procedureManifest: [
      'Modo deterministico de alta disponibilidade ativado; a proposta permanece capability-aware e foi validada localmente.',
      `Objetivo inferido do pedido: ${fallbackGoal}.`,
      isWifiSupportFlow
        ? 'Procedimento Wi-Fi: validar cliente/contrato antes de consultar dados, usar MCP qualificada quando disponivel, nunca tratar MCP como mcp_call_tool no planejamento, bloquear reboot em consulta de senha, exigir confirmacao para reboot/troca e nao alterar SSID/senha em teste real.'
        : 'Procedimento geral: classificar intencao, coletar apenas dados necessarios, consultar knowledge, responder com proximo passo claro e transferir quando a confianca for baixa ou o cliente pedir humano.',
    ].join(' '),
    systemPrompt: fallbackSystemPrompt(input),
    nodes: nodes.map((node, index) => ({ ...node, ...defaultFlowNodePosition(index) })),
    edges: [],
  };
}

function isAllowedDecisionTarget(target: FlowBuilderOutput['nodes'][number] | undefined) {
  return Boolean(target && isSafeFallbackKind(target.kind));
}

function findDecisionRouteTarget(
  flow: FlowBuilderOutput,
  decision: FlowBuilderOutput['nodes'][number],
  route: NonNullable<FlowBuilderOutput['nodes'][number]['routes']>[number],
) {
  const routeText = normalizeSearchText(`${route.id} ${route.label} ${route.description} ${(route.examples || []).join(' ')}`);
  const candidates = flow.nodes.filter((node) => (
    node.id !== decision.id
    && isAllowedDecisionTarget(node)
    && canConnect(decision.kind, node.kind)
  ));
  const byKind = (kind: V2FlowNodeKind) => candidates.find((node) => node.kind === kind)?.id;
  if (/\b(humano|atendente|transfer|handoff|equipe|especialista)\b/.test(routeText)) {
    return byKind('handoff') || byKind('sub_agent') || byKind('message') || byKind('end');
  }
  if (/\b(colet|dados|cadastro|nome|telefone|email|cpf|cnpj|documento|endereco|data|horario|agend|orcamento|lead|contratar|comprar)\b/.test(routeText)) {
    return byKind('collect') || byKind('sub_agent') || byKind('message') || byKind('end');
  }
  if (/\b(encerr|finaliz|conclu|obrigad|fim|tchau)\b/.test(routeText)) {
    return byKind('end') || byKind('message') || byKind('sub_agent');
  }
  return byKind('sub_agent') || byKind('message') || byKind('collect') || byKind('end') || byKind('handoff');
}

function repairDecisionRouteTargets(flow: FlowBuilderOutput): FlowBuilderOutput {
  const nodeById = new Map(flow.nodes.map((node) => [node.id, node]));
  return {
    ...flow,
    nodes: flow.nodes.map((node) => {
      if (node.kind !== 'decision' || !node.routes?.length) return node;
      const routes = node.routes.map((route) => {
        const currentTarget = route.targetNodeId ? nodeById.get(route.targetNodeId) : undefined;
        const safeCurrentTarget = isAllowedDecisionTarget(currentTarget) && currentTarget && canConnect(node.kind, currentTarget.kind);
        const routeText = normalizeSearchText(`${route.id} ${route.label} ${route.description} ${(route.examples || []).join(' ')}`);
        const routeId = normalizeId(route.id, '');
        const fallbackId = normalizeId(node.fallbackRouteId || '', '');
        const isFallbackRoute = routeId === fallbackId
          || /^(fallback|outro|esclarecer|esclarecimento|fora_do_escopo|baixa_confianca)$/.test(routeId)
          || /\b(fallback|fora do procedimento|fora do escopo|mudanca de assunto|baixa confianca)\b/.test(routeText);
        const targetNodeId = safeCurrentTarget
          ? currentTarget.id
          : (isFallbackRoute ? undefined : findDecisionRouteTarget(flow, node, route));
        return {
          ...route,
          targetNodeId,
        };
      });
      const fallbackRouteId = node.fallbackRouteId && routes.some((route) => route.id === node.fallbackRouteId)
        ? node.fallbackRouteId
        : (routes.find((route) => normalizeId(route.id, '') === 'fallback')?.id || routes[0]?.id);
      return {
        ...node,
        fallbackRouteId,
        routes,
      };
    }),
  };
}

function buildDeterministicTopology(flow: FlowBuilderOutput): FlowBuilderTopology {
  const repairedFlow = repairDecisionRouteTargets(flow);
  const nodeById = new Map(repairedFlow.nodes.map((node) => [node.id, node]));
  const edges: FlowBuilderTopology['edges'] = [];
  const seen = new Set<string>();
  const addEdge = (sourceId: string | undefined, targetId: string | undefined, routeId?: string) => {
    if (!sourceId || !targetId || sourceId === targetId) return;
    const source = nodeById.get(sourceId);
    const target = nodeById.get(targetId);
    const key = `${sourceId}:${targetId}:${routeId || ''}`;
    if (!source || !target || seen.has(key) || !canConnect(source.kind, target.kind)) return;
    seen.add(key);
    edges.push({ source: sourceId, target: targetId, ...(routeId ? { routeId } : {}) });
  };

  const mainNodes = repairedFlow.nodes.filter((node) => node.kind !== 'knowledge' && node.kind !== 'tool');
  const orderedMainNodes = [
    ...mainNodes.filter((node) => node.kind === 'start'),
    ...mainNodes.filter((node) => node.kind !== 'start'),
  ];

  for (let index = 0; index < orderedMainNodes.length; index += 1) {
    const node = orderedMainNodes[index];
    if (node.kind === 'decision') {
      for (const route of node.routes || []) {
        addEdge(node.id, route.targetNodeId, route.id);
      }
      continue;
    }
    if (node.kind === 'end' || node.kind === 'handoff') continue;
    const next = orderedMainNodes.slice(index + 1).find((candidate) => canConnect(node.kind, candidate.kind));
    addEdge(node.id, next?.id);
  }

  const firstAgent = repairedFlow.nodes.find((node) => node.kind === 'sub_agent');
  for (const knowledgeNode of repairedFlow.nodes.filter((node) => node.kind === 'knowledge')) {
    const nextAgent = repairedFlow.nodes.find((node) => node.kind === 'sub_agent' && node.y >= knowledgeNode.y) || firstAgent;
    addEdge(knowledgeNode.id, nextAgent?.id);
  }

  return { edges };
}

function buildDeterministicEnrichment(input: {
  flow: FlowBuilderOutput;
  conversation: Array<{ role: 'user' | 'assistant'; content: string }>;
  currentSystemPrompt?: string | null;
}): FlowBuilderEnrichment {
  const relatedById = new Map<string, string[]>();
  const nodeById = new Map(input.flow.nodes.map((node) => [node.id, node]));
  for (const edge of input.flow.edges) {
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    if (!source || !target) continue;
    relatedById.set(source.id, [...(relatedById.get(source.id) || []), target.title]);
    relatedById.set(target.id, [...(relatedById.get(target.id) || []), source.title]);
  }

  return {
    systemPrompt: fallbackSystemPrompt(input),
    nodes: input.flow.nodes.map((node) => ({
      id: node.id,
      instructions: cleanPromptText(node.instructions, 2400)
        || defaultNodeInstructions(node, relatedById.get(node.id) || []),
      message: cleanPromptText(node.message, 2400)
        || defaultNodeMessage({ kind: node.kind, title: node.title, subtitle: node.subtitle }),
    })),
  };
}

function warnFlowBuilderFallback(stage: string, error: unknown) {
  console.warn(
    `[AUTOPILOT_FLOW_BUILDER_AI] Falling back to deterministic ${stage} after stage failure:`,
    error,
  );
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
        maxAttempts: tool.maxAttempts || 3,
        errorHandles: ['error'],
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

export function buildDeterministicFallbackProposal(input: {
  conversation: Array<{ role: 'user' | 'assistant'; content: string }>;
  currentSystemPrompt?: string | null;
  tools: AgentToolCatalogItem[];
}, error: unknown): AutopilotFlowAiProposal {
  let output = repairDecisionRouteTargets(
    normalizeArchitectureOutput(buildFallbackArchitecture(input, error)),
  );
  output = {
    ...output,
    edges: buildDeterministicTopology(output).edges,
  };
  output = applyFlowBuilderEnrichment(output, buildDeterministicEnrichment({
    flow: output,
    conversation: input.conversation,
    currentSystemPrompt: input.currentSystemPrompt,
  }));
  const relevanceMap = buildToolRelevanceMap({
    conversation: input.conversation,
    architecture: output,
    currentSystemPrompt: input.currentSystemPrompt,
    tools: input.tools,
  });
  output = ensureToolRelevanceCoverage(output, input.tools, relevanceMap);
  output = repairDecisionRouteTargets(ensureOperationalCoverage(output, input.tools));
  output = ensureWifiBranchIsolation(output, input.tools, relevanceMap);
  return sanitizeAutopilotFlowProposal(output, input.tools);
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
  return /timed out|timeout|fetch failed|network request failed|econnreset|econnrefused|etimedout|socket|und_err|invalid json|truncated|does not match|schema|parse|malformed|unexpected/.test(message);
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
  let architecture: ArchitectureFlowBuilderOutput;
  try {
    architecture = await runFlowBuilderStage({
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
  } catch (error) {
    warnFlowBuilderFallback('architecture', error);
    return buildDeterministicFallbackProposal(input, error);
  }

  let output = repairDecisionRouteTargets(normalizeArchitectureOutput(architecture));
  try {
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
    output = repairDecisionRouteTargets({ ...output, edges: topology.edges });
  } catch (error) {
    warnFlowBuilderFallback('topology', error);
    output = repairDecisionRouteTargets({ ...output, edges: buildDeterministicTopology(output).edges });
  }
  try {
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
  } catch (error) {
    warnFlowBuilderFallback('enrichment', error);
    output = applyFlowBuilderEnrichment(output, buildDeterministicEnrichment({
      flow: output,
      conversation: input.conversation,
      currentSystemPrompt: input.currentSystemPrompt,
    }));
  }
  const toolRelevanceMap = buildToolRelevanceMap({
    conversation: input.conversation,
    architecture: output,
    currentSystemPrompt: input.currentSystemPrompt,
    tools: input.tools,
  });
  try {
    const toolSelection = await runFlowBuilderStage({
    model: input.model,
    apiKey: input.apiKey,
    schema: FlowBuilderToolSelectionSchema,
    schemaName: 'dialogy_autopilot_flow_builder_tools',
    jsonSchema: toolSelectionJsonSchema,
    systemPrompt: 'Execute as tasks 4 e 5: consulte todo o catalogo e escolha apenas tools necessarias. Retorne somente JSON valido.',
    userPrompt: buildToolSelectionPrompt({ architecture: output, tools: input.tools, relevanceMap: toolRelevanceMap }),
    defaultRunner: defaultToolSelectionPrompt,
  });
    output = applyToolSelection(output, toolSelection, input.tools);
  } catch (error) {
    warnFlowBuilderFallback('tool selection', error);
    output = applyToolSelection(output, { tools: [] }, input.tools);
  }
  output = ensureToolRelevanceCoverage(output, input.tools, toolRelevanceMap);
  output = repairDecisionRouteTargets(ensureOperationalCoverage(output, input.tools));
  const deterministicTopology = buildDeterministicTopology(output);
  if (deterministicTopology.edges.length > output.edges.length) {
    output = { ...output, edges: deterministicTopology.edges };
  }
  output = ensureWifiBranchIsolation(output, input.tools, toolRelevanceMap);

  try {
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
  } catch (error) {
    warnFlowBuilderFallback('validation', error);
    output = applyValidationEdges(output, { valid: true, issues: [], missingEdges: [] });
  }
  output = ensureToolRelevanceCoverage(output, input.tools, toolRelevanceMap);
  output = repairDecisionRouteTargets(ensureOperationalCoverage(output, input.tools));
  output = ensureWifiBranchIsolation(output, input.tools, toolRelevanceMap);
  try {
    return sanitizeAutopilotFlowProposal(output, input.tools);
  } catch (error) {
    warnFlowBuilderFallback('final sanitization', error);
    return buildDeterministicFallbackProposal(input, error);
  }
}
