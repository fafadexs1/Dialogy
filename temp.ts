import { genkit } from 'genkit';
import { googleAI } from '@genkit-ai/googleai';
import { z } from 'zod';

import { ai } from '@/ai/genkit';
import type { AutopilotFlowAiProposal, AutopilotFlowGraph, AutopilotFlowNodeKind } from '@/lib/types';
import type { AgentToolCatalogItem } from '@/services/agent-tools/catalog';
import { isLmStudioModel } from '@/services/ai/lm-studio';
import { requestLmStudioJson } from '@/services/ai/lm-studio-client';

const FlowNodeKindSchema = z.enum([
  'trigger', 'understand', 'intent', 'assistant', 'knowledge', 'reply',
  'send_message', 'form', 'handoff', 'close', 'tool', 'rule',
]);

const FlowIntentSchema = z.enum([
  'greeting', 'human_handoff', 'purchase_inquiry', 'catalog_request', 'pricing_request',
  'promotion_request', 'availability_request', 'billing_or_payment', 'scheduling_request',
  'order_or_request_status', 'support_request', 'troubleshooting', 'change_request',
  'return_or_refund', 'cancellation_request', 'document_request', 'complaint', 'thanks', 'unknown',
]);

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
  knowledgeCollectionIds: z.array(z.string()).max(32).optional(),
});

const FlowEdgeSchema = z.object({
  source: z.string().min(1),
  target: z.string().min(1),
});

const FlowBuilderOutputSchema = z.object({
  summary: z.string().min(1),
  systemPrompt: z.string().min(1),
  nodes: z.array(FlowNodeSchema).min(1).max(32),
  edges: z.array(FlowEdgeSchema).max(64),
});

type FlowBuilderOutput = z.infer<typeof FlowBuilderOutputSchema>;

const FlowNodeEnrichmentSchema = z.object({
  id: z.string().min(1),
  instructions: z.string().min(1),
  message: z.string().optional(),
});

const FlowBuilderEnrichmentSchema = z.object({
  systemPrompt: z.string().min(1),
  nodes: z.array(FlowNodeEnrichmentSchema).min(1).max(32),
});

type FlowBuilderEnrichment = z.infer<typeof FlowBuilderEnrichmentSchema>;

const FlowBuilderTopologySchema = z.object({
  edges: z.array(FlowEdgeSchema).max(64),
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
    systemPrompt: { type: 'string' },
    nodes: {
      type: 'array',
      maxItems: 32,
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          kind: { type: 'string', enum: FlowNodeKindSchema.options },
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
          knowledgeCollectionIds: { type: 'array', maxItems: 32, items: { type: 'string' } },
        },
        required: ['id', 'kind', 'title', 'subtitle', 'x', 'y'],
        additionalProperties: false,
      },
    },
    edges: {
      type: 'array',
      maxItems: 64,
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
      maxItems: 64,
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
    return sourceKind === 'knowledge' && (targetKind === 'assistant' || targetKind === 'intent');
  }
  if (sourceKind === 'tool' || targetKind === 'tool') {
    return (sourceKind === 'assistant' || sourceKind === 'intent') && targetKind === 'tool';
  }
  if (sourceKind === 'rule' || targetKind === 'rule') {
    return (sourceKind === 'assistant' || sourceKind === 'intent') && targetKind === 'rule';
  }
  return true;
}

function defaultNodeInstructions(node: {
  kind: AutopilotFlowNodeKind;
  title: string;
  subtitle: string;
  toolName?: string;
}, relatedTitles: string[]) {
  const relation = relatedTitles.length > 0 ? ` Relaciona-se com: ${relatedTitles.join(', ')}.` : '';
  switch (node.kind) {
    case 'trigger':
      return `Inicie este fluxo quando ocorrer: ${node.title}. ${node.subtitle}`.trim();
    case 'understand':
      return `Analise a mensagem atual, identifique a necessidade do cliente e encaminhe para a proxima etapa adequada.${relation}`;
    case 'intent':
      return `Assuma este sub-agente somente para o assunto "${node.title}". Siga o escopo descrito em "${node.subtitle}" e retorne ao agente principal quando a intencao mudar.${relation}`;
    case 'assistant':
      return `Atue como agente principal, coordene os blocos conectados e responda conforme o prompt system geral.${relation}`;
    case 'knowledge':
      return `Consulte a base de conhecimento para obter informacoes relevantes antes de responder. Use somente fatos recuperados e nao invente dados.${relation}`;
    case 'tool':
      return `Use a ferramenta ${node.toolName || node.title} somente quando a etapa conectada exigir sua execucao. Monte o payload conforme o schema disponivel e nao execute sem os dados obrigatorios.${relation}`;
    case 'rule':
      return `Aplique esta regra somente quando o contexto do atendimento satisfizer sua condicao.${relation}`;
    case 'form':
      return `Colete os dados necessarios desta etapa sem repetir perguntas ja respondidas pelo cliente.${relation}`;
    case 'send_message':
    case 'reply':
      return `Envie a mensagem configurada no momento indicado pelo fluxo.${relation}`;
    case 'handoff':
      return `Transfira o atendimento somente quando o criterio desta etapa estiver atendido.${relation}`;
    case 'close':
      return `Finalize o atendimento somente quando a solicitacao estiver concluida ou o cliente pedir encerramento.${relation}`;
  }
}

export function sanitizeAutopilotFlowProposal(output: FlowBuilderOutput, tools: AgentToolCatalogItem[]): AutopilotFlowAiProposal {
  const availableToolNames = new Set<string>(tools.map((tool) => tool.name));
  const usedIds = new Set<string>();
  const usedReferenceIds = new Set<string>();
  const usedIntentValues = new Set<string>();
  let hasPrincipalAssistant = false;
  const nodes = output.nodes.flatMap((node, index) => {
    const idBase = normalizeId(node.id, `bloco-${index + 1}`);
    let id = idBase;
    let suffix = 2;
    while (usedIds.has(id)) id = `${idBase}-${suffix++}`;
    usedIds.add(id);

    if (node.kind === 'tool' && (!node.toolName || !availableToolNames.has(node.toolName))) return [];
    let kind: AutopilotFlowNodeKind = node.kind === 'assistant' && hasPrincipalAssistant ? 'intent' : node.kind;
    if (kind === 'assistant') hasPrincipalAssistant = true;
    if (kind === 'intent') {
      const intent = node.intent || 'unknown';
      if (usedIntentValues.has(intent)) {
        kind = 'understand';
      } else {
        usedIntentValues.add(intent);
      }
    }
    const referenceBase = normalizeId(node.referenceId || id, id).replace(/-/g, '_');
    let referenceId = referenceBase;
    let referenceSuffix = 2;
    while (usedReferenceIds.has(referenceId)) referenceId = `${referenceBase}_${referenceSuffix++}`;
    usedReferenceIds.add(referenceId);
    const knowledgeCollectionIds = node.knowledgeCollectionIds?.map((value) => normalizeId(value, '')).filter(Boolean) || [];
    const instructions = cleanPromptText(node.instructions, 2400)
      || (kind === 'intent' ? `Atenda especificamente o assunto "${cleanText(node.title, 100) || 'deste sub-agente'}". ${cleanText(node.subtitle, 140)}`.trim() : undefined);
    return [{
      id,
      kind,
      title: cleanText(node.title, 100) || 'Bloco',
      subtitle: cleanText(node.subtitle, 140),
      position: { x: Math.round(node.x), y: Math.round(node.y) },
      ...(node.kind === 'tool' ? { toolName: node.toolName } : {}),
      config: {
        instructions,
        message: cleanPromptText(node.message, 2400) || undefined,
        referenceId,
        variableName: normalizeId(node.variableName || `resultado-${id}`, `resultado-${id}`).replace(/-/g, '_'),
        ...(kind === 'intent' ? {
          intent: node.intent || 'unknown',
          customIntentLabel: cleanText(node.customIntentLabel, 180) || cleanText(node.title, 100),
          knowledgeCollectionIds: knowledgeCollectionIds.length > 0 ? knowledgeCollectionIds : ['general'],
          returnToMainPrompt: true,
        } : {}),
      },
    }];
  });

  if (!nodes.some((node) => node.kind === 'assistant')) {
    nodes.push({
      id: 'agente-principal',
      kind: 'assistant',
      title: 'Agente principal',
      subtitle: 'Responder com IA',
      position: { x: 420, y: 340 },
      config: {
        instructions: undefined,
        message: undefined,
        referenceId: 'agente_principal',
        variableName: 'resposta_ia',
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

  const nodeByOriginalId = new Map<string, string>();
  output.nodes.forEach((node) => {
    const normalized = normalizeId(node.id, '');
    if (normalized && nodes.some((candidate) => candidate.id === normalized)) nodeByOriginalId.set(node.id, normalized);
  });
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
    return [{ id: `ia-${index + 1}-${source}-${target}`.slice(0, 120), source, target }];
  });

  const agentNodes = nodes.filter((node) => node.kind === 'assistant' || node.kind === 'intent');
  const nearestAgent = (node: (typeof nodes)[number]) => agentNodes
    .filter((candidate) => candidate.id !== node.id)
    .sort((left, right) => distanceBetween(node, left) - distanceBetween(node, right))[0];
  for (const node of nodes) {
    const mustAttachToAgent = node.kind === 'knowledge' || node.kind === 'tool' || node.kind === 'rule';
    if (!mustAttachToAgent) continue;
    const hasValidAttachment = edges.some((edge) => (
      node.kind === 'knowledge'
        ? edge.source === node.id && agentNodes.some((candidate) => candidate.id === edge.target)
        : edge.target === node.id && agentNodes.some((candidate) => candidate.id === edge.source)
    ));
    if (hasValidAttachment) continue;
    const target = nearestAgent(node);
    if (!target) continue;
    const sourceId = node.kind === 'knowledge' ? node.id : target.id;
    const targetId = node.kind === 'knowledge' ? target.id : node.id;
    const key = `${sourceId}:${targetId}`;
    if (seenEdges.has(key)) continue;
    seenEdges.add(key);
    edges.push({ id: `ia-reparo-${sourceId}-${targetId}`.slice(0, 120), source: sourceId, target: targetId });
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
  return `Voce e o arquiteto de flows do Dialogy. Execute somente a task 1: definir e ordenar os blocos funcionais de um atendimento generico.

Regras obrigatorias:
- Gere blocos em ordem operacional, com coordenadas organizadas da esquerda para a direita ou de cima para baixo.
- Inclua exatamente um assistant principal. Nunca use varios blocos assistant para representar etapas.
- Para sub-agentes especializados, use kind intent e escreva instructions exclusivas para aquele assunto. Para etapas deterministicas, use understand, form ou send_message.
- Nunca crie dois blocos intent com o mesmo valor de intent. Etapas sequenciais da mesma jornada devem ser understand, form ou send_message.
- Nao crie blocos kind tool nesta etapa. A selecao de ferramentas ocorrera depois, consultando o catalogo completo.
- Retorne edges vazio. Uma segunda task especializada fara as ligacoes.
- Inclua ao menos um bloco knowledge por padrao e conecte a base ao assistant principal. Sub-agentes intent herdam knowledge e tools do principal no runtime. Omita knowledge somente quando o usuario pedir explicitamente um agente sem RAG ou sem base de conhecimento.
- Preencha instructions iniciais curtas. Uma task posterior detalhara cada bloco individualmente.
- Cada bloco deve ter referenceId unico. Para citar um bloco use exatamente @ seguido pelo valor de referenceId, por exemplo @consulta_planos. Nunca escreva o texto literal "@referenceId:".
- No systemPrompt, descreva persona, objetivo e limites gerais. Mencione somente blocos relevantes usando @id_real. Instrucoes especificas de sub-agente devem ficar no campo instructions do respectivo intent, sem duplicar o prompt global.
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
- Knowledge liga preferencialmente knowledge -> assistant principal. Sub-agentes intent herdam a base do principal; use ligacao direta no intent apenas para restricao ou base adicional especifica.
- Nao crie tools nesta fase.
- Nao deixe blocos funcionais soltos, exceto quando forem anexos opcionais sem uso real.
- Nao use trigger como encerramento. Encerramento sera tratado por tool quando necessario.

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
        : node.kind === 'intent'
          ? 'Escreva um system prompt exclusivo deste sub-agente: escopo, objetivo, limites, uso da base e retorno ao agente principal.'
          : node.kind === 'knowledge'
            ? 'Explique quando consultar a base e para qual agente conectado entregar o contexto.'
            : 'Escreva uma instrucao operacional especifica para a funcao deste bloco e sua relacao com os vizinhos.',
    };
  });
  return `Voce e o revisor operacional de flows do Dialogy. A arquitetura ja foi definida. Agora execute uma task de escrita para cada bloco.

Regras obrigatorias:
- Retorne exatamente um item para cada id recebido. Nunca omita blocos.
- Cada instructions deve ser especifico para aquele bloco. Nao replique o mesmo texto em blocos diferentes.
- Considere incoming e outgoing para explicar como o bloco participa do fluxo.
- Para intent, escreva o system prompt exclusivo do sub-agente.
- Para tool, descreva quando executar, quando nao executar, dados obrigatorios e montagem do payload conforme o schema real.
- Para knowledge, descreva a consulta RAG e o agente que recebe o contexto.
- Para send_message ou reply, preencha message com a mensagem adequada ao cliente.
- O systemPrompt geral deve tratar apenas persona, objetivo global, limites e coordenacao dos blocos por @referenceId real.
- Para citar bloco use @ seguido de referenceId real. Nunca escreva "@referenceId:" literalmente.
- Nao invente fatos, ferramentas ou conexoes.

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
- attachToNodeId deve apontar preferencialmente para o assistant principal quando a ferramenta for capacidade geral do agente. Sub-agentes intent herdam tools do principal no runtime.
- Use attachToNodeId em intent apenas quando a ferramenta for adicional ou restrita aquele sub-agente.
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
    if (!target || (target.kind !== 'assistant' && target.kind !== 'intent')) continue;
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
  const agentNodes = nodes.filter((node) => node.kind === 'assistant' || node.kind === 'intent');
  if (agentNodes.length === 0) return architecture;
  const principal = nodes.find((node) => node.kind === 'assistant') || agentNodes[0];

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
    if (!edges.some((edge) => edge.source === principal.id && edge.target === toolNode?.id)) {
      edges.push({ source: principal.id, target: toolNode.id });
    }
  }
  return { ...architecture, nodes, edges };
}

function buildValidationPrompt(flow: FlowBuilderOutput) {
  return `Execute as tasks 6 e 7 do construtor Dialogy: revisar todas as ligacoes e validar o flow final.

Regras:
- Verifique se o caminho operacional principal esta completo.
- Verifique se knowledge geral esta conectado ao assistant principal.
- Verifique se tools gerais estao conectadas ao assistant principal. Sub-agentes herdam essas tools; conecte tool em intent apenas quando for adicional ou restrita aquele sub-agente.
- Verifique se encerramento, transferencia, persistencia no CRM e nota interna possuem suas tools quando essas capacidades forem exigidas pelo flow.
- Verifique se nao ha blocos soltos, saltos impossiveis ou trigger usado como encerramento.
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
  output: { schema: FlowBuilderOutputSchema },
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

async function runFlowBuilderStage<TSchema extends z.ZodTypeAny>(input: {
  model: string;
  apiKey?: string;
  schema: TSchema;
  schemaName: string;
  jsonSchema: Record<string, unknown>;
  systemPrompt: string;
  userPrompt: string;
  defaultRunner: any;
}) {
  if (isLmStudioModel(input.model)) {
    return requestLmStudioJson({
      model: input.model,
      schema: input.schema,
      schemaName: input.schemaName,
      jsonSchema: input.jsonSchema,
      systemPrompt: input.systemPrompt,
      userPrompt: input.userPrompt,
      timeoutMs: 120000,
      maxTokens: 12000,
    });
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
  const result = await runner({ prompt: input.userPrompt }, { model: input.model });
  if (!result.output) throw new Error(`A IA nao retornou JSON estruturado para ${input.schemaName}.`);
  return input.schema.parse(result.output);
}

export async function generateAutopilotFlowProposal(input: {
  conversation: Array<{ role: 'user' | 'assistant'; content: string }>;
  currentGraph?: AutopilotFlowGraph | null;
  currentSystemPrompt?: string | null;
  tools: AgentToolCatalogItem[];
  model: string;
  apiKey?: string;
}) {
  let output = await runFlowBuilderStage({
    model: input.model,
    apiKey: input.apiKey,
    schema: FlowBuilderOutputSchema,
    schemaName: 'dialogy_autopilot_flow_builder_architecture',
    jsonSchema,
    systemPrompt: 'Execute a task 1: ordene blocos funcionais sem tools e sem edges. Retorne somente JSON valido.',
    userPrompt: buildPrompt(input),
    defaultRunner: defaultPrompt,
  });
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
    systemPrompt: 'Execute a task 3: enrique├ºa cada bloco individualmente. Retorne somente JSON valido e nunca omita tasks.',
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
