/**
 * Procedure Compiler
 *
 * Deterministically parses a knowledge base document into a ProcedureGraph
 * by analysing @tool mentions, imperative phrases, sequence connectors,
 * and conditional keywords.
 *
 * This compiler is ZERO-COST (no LLM calls). It runs when a document is
 * saved and stores the compiled graph alongside the document in the database.
 */

import type { KnowledgeBaseDocument } from '@/lib/types';
import type { AgentToolCatalogItem } from '@/services/agent-tools/catalog';
import type {
  ProcedureGraph,
  ProcedureStep,
  ProcedureStepType,
  ProcedureCompilationResult,
} from './procedure-types';

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

const TOOL_MENTION = /@([a-zA-Z0-9_.:\-]+)/g;

const SEQUENCE_MARKERS = [
  /\b(primeiro|primeiramente|inicialmente|antes de tudo)\b/i,
  /\b(em seguida|logo em seguida|depois|após isso|na sequência|na sequencia|em sequência|em sequencia)\b/i,
  /\b(por (último|ultimo)|por fim|finalmente|ao final)\b/i,
];

const CONDITIONAL_MARKERS =
  /\b(se |caso |quando |somente se|apenas se|contanto que)\b/i;

const IMPERATIVE_VERBS =
  /\b(você deve|voce deve|deve-se|é necessário|e necessario|precisa|obrigatoriamente|sempre|nunca|não pode|nao pode)\b/i;

const GATHER_HINTS =
  /\b(pergunte|peça|peca|solicite|colete|informe|confirme com o cliente|verifique com o cliente|antes.*inform)\b/i;

const RESPOND_HINTS =
  /\b(responda|diga ao cliente|informe ao cliente|envie|comunique|avise)\b/i;

const VALIDATE_HINTS =
  /\b(verifique|confira|cheque|valide|certifique-se|certifique se)\b/i;

const HANDOFF_HINTS =
  /\b(transfira|encaminhe|escale|envolva um humano|passe para)\b/i;

// Intent hints extracted from document content
const INTENT_KEYWORD_MAP: Record<string, RegExp> = {
  billing_or_payment: /\b(fatura|boleto|pagamento|cobrança|cobranca|pix|segunda via|financeiro)\b/i,
  troubleshooting: /\b(problema|erro|falha|sem sinal|sem internet|lento|travando|nao funciona|não funciona|reiniciar|reboot)\b/i,
  support_request: /\b(suporte|ajuda|duvida|dúvida|orientação|orientacao)\b/i,
  human_handoff: /\b(transferir|transferência|transferencia|encaminhar|humano|atendente)\b/i,
  cancellation_request: /\b(cancelar|cancelamento|desistir|encerrar contrato)\b/i,
  scheduling_request: /\b(agendar|agendamento|marcar|remarcar|visita)\b/i,
  order_or_request_status: /\b(status|andamento|pedido|protocolo|acompanhar)\b/i,
  complaint: /\b(reclamação|reclamacao|insatisf|queixa)\b/i,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateStepId(index: number): string {
  return `step_${index + 1}`;
}

function generateProcedureId(documentId: string): string {
  return `proc_${documentId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 16)}`;
}

function normalizeToolToken(value: string): string {
  return value.trim().replace(/[.,;!?]+$/g, '').toLowerCase();
}

function buildToolLookup(tools: AgentToolCatalogItem[]): Map<string, AgentToolCatalogItem> {
  const lookup = new Map<string, AgentToolCatalogItem>();
  for (const tool of tools) {
    const aliases = [
      tool.name,
      tool.name.split(':').at(-1) || '',
      tool.name.replace(/^mcp:[^:]+:/, ''),
    ].filter(Boolean);
    for (const alias of aliases) {
      lookup.set(normalizeToolToken(alias), tool);
    }
  }
  return lookup;
}

function extractTriggerIntents(content: string): string[] {
  const intents: string[] = [];
  for (const [intent, pattern] of Object.entries(INTENT_KEYWORD_MAP)) {
    if (pattern.test(content)) {
      intents.push(intent);
    }
  }
  return intents.length > 0 ? intents : ['unknown'];
}

function extractTriggerKeywords(content: string): string[] {
  const normalized = content
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  const keywords: string[] = [];
  for (const [, pattern] of Object.entries(INTENT_KEYWORD_MAP)) {
    const matches = normalized.match(pattern);
    if (matches) {
      keywords.push(...matches.map((m) => m.toLowerCase()));
    }
  }
  return [...new Set(keywords)].slice(0, 10);
}

function inferRequiredSlots(text: string): string[] {
  const slots: string[] = [];
  const normalized = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  if (/\b(cpf|cnpj|documento|identificador)\b/.test(normalized)) {
    slots.push('customer_identifier');
  }
  if (/\b(nome completo|nome do cliente|nome)\b/.test(normalized)) {
    slots.push('name');
  }
  if (/\b(endereco|rua|bairro|cep)\b/.test(normalized)) {
    slots.push('address');
  }
  if (/\b(telefone|whatsapp|celular)\b/.test(normalized)) {
    slots.push('phone');
  }
  if (/\b(email|e-mail)\b/.test(normalized)) {
    slots.push('email');
  }
  if (/\b(data|dia)\b/.test(normalized)) {
    slots.push('date');
  }
  if (/\b(horario|hora)\b/.test(normalized)) {
    slots.push('time');
  }

  return [...new Set(slots)];
}

// ---------------------------------------------------------------------------
// Sentence Splitter
// ---------------------------------------------------------------------------

type SentenceSegment = {
  text: string;
  index: number;
  toolMention: string | null;
  resolvedToolName: string | null;
  hasSequenceMarker: boolean;
  hasConditional: boolean;
  hasImperative: boolean;
  inferredType: ProcedureStepType;
};

function splitIntoSegments(
  content: string,
  toolLookup: Map<string, AgentToolCatalogItem>,
): SentenceSegment[] {
  // Split on sentence boundaries (. ! ? and newlines), keeping meaningful chunks
  const rawSentences = content
    .split(/(?<=[.!?\n])\s+|(?:\r?\n){2,}/)
    .map((s) => s.trim())
    .filter((s) => s.length > 10);

  const segments: SentenceSegment[] = [];

  for (let i = 0; i < rawSentences.length; i++) {
    const text = rawSentences[i];

    // Detect tool mentions
    TOOL_MENTION.lastIndex = 0;
    const toolMatch = TOOL_MENTION.exec(text);
    let toolMention: string | null = null;
    let resolvedToolName: string | null = null;
    if (toolMatch) {
      const mention = (toolMatch[1] || '').replace(/[.,;!?]+$/g, '');
      const tool = toolLookup.get(normalizeToolToken(mention));
      if (tool) {
        toolMention = `@${mention}`;
        resolvedToolName = tool.name;
      }
    }

    const hasSequenceMarker = SEQUENCE_MARKERS.some((p) => p.test(text));
    const hasConditional = CONDITIONAL_MARKERS.test(text);
    const hasImperative = IMPERATIVE_VERBS.test(text);

    // Infer step type
    let inferredType: ProcedureStepType = 'respond';
    if (resolvedToolName) {
      inferredType = 'tool_call';
    } else if (HANDOFF_HINTS.test(text) && !resolvedToolName) {
      inferredType = 'handoff';
    } else if (GATHER_HINTS.test(text)) {
      inferredType = 'gather_data';
    } else if (VALIDATE_HINTS.test(text) && hasConditional) {
      inferredType = 'validate';
    } else if (RESPOND_HINTS.test(text)) {
      inferredType = 'respond';
    } else if (hasConditional) {
      inferredType = 'decide';
    }

    segments.push({
      text,
      index: i,
      toolMention,
      resolvedToolName,
      hasSequenceMarker,
      hasConditional,
      hasImperative,
      inferredType,
    });
  }

  return segments;
}

// ---------------------------------------------------------------------------
// Step Builder
// ---------------------------------------------------------------------------

function buildStepsFromSegments(segments: SentenceSegment[]): ProcedureStep[] {
  // Only keep segments that indicate actionable procedure steps
  const actionable = segments.filter(
    (s) =>
      s.resolvedToolName ||
      s.hasImperative ||
      s.hasSequenceMarker ||
      s.inferredType !== 'respond',
  );

  // If nothing is actionable, try to build from tool mentions only
  const toolSegments = segments.filter((s) => s.resolvedToolName);
  const source = actionable.length > 0 ? actionable : toolSegments;

  if (source.length === 0) return [];

  const steps: ProcedureStep[] = [];

  for (let i = 0; i < source.length; i++) {
    const segment = source[i];
    const stepId = generateStepId(i);
    const nextStepId = i < source.length - 1 ? generateStepId(i + 1) : null;

    const step: ProcedureStep = {
      id: stepId,
      order: i + 1,
      type: segment.inferredType,
      label: segment.text.slice(0, 200),
      nextStepId,
      maxRetries: segment.inferredType === 'tool_call' ? 2 : 1,
    };

    // Type-specific fields
    switch (segment.inferredType) {
      case 'tool_call':
        step.toolName = segment.resolvedToolName || undefined;
        step.toolPayloadTemplate = {};
        break;
      case 'gather_data':
        step.promptTemplate = segment.text;
        step.requiredSlots = inferRequiredSlots(segment.text);
        break;
      case 'validate':
        step.condition = segment.text;
        step.onFail = segment.hasConditional ? 'handoff' : 'skip';
        break;
      case 'decide':
        step.decisionPrompt = segment.text;
        step.branches = [];
        break;
      case 'respond':
        step.responseTemplate = segment.text;
        step.useLlm = true;
        break;
      case 'handoff':
        step.handoffReason = segment.text;
        break;
    }

    steps.push(step);
  }

  return steps;
}

// ---------------------------------------------------------------------------
// Enrichment — merge adjacent steps of same type, add implicit gathers
// ---------------------------------------------------------------------------

function enrichSteps(steps: ProcedureStep[], content: string): ProcedureStep[] {
  if (steps.length === 0) return steps;

  const enriched = [...steps];

  // If first tool_call requires customer_identifier and no gather_data precedes it,
  // inject a gather_data step at position 0
  const firstToolStep = enriched.find((s) => s.type === 'tool_call');
  if (firstToolStep) {
    const needsIdentifier =
      firstToolStep.toolName === 'sgp_fetch_contact_panel_data' ||
      firstToolStep.toolName === 'sgp_fetch_contracts';

    const hasGather = enriched.some(
      (s) => s.type === 'gather_data' && s.order < (firstToolStep.order || 999),
    );

    if (needsIdentifier && !hasGather) {
      // Check if document mentions CPF/CNPJ gathering
      const mentionsIdentifier = /\b(cpf|cnpj|documento|identificador)\b/i.test(content);
      if (mentionsIdentifier) {
        const gatherStep: ProcedureStep = {
          id: 'step_0_gather',
          order: 0,
          type: 'gather_data',
          label: 'Coletar CPF/CNPJ do cliente antes da consulta',
          requiredSlots: ['customer_identifier'],
          promptTemplate: 'Para consultar com segurança, me informe o CPF/CNPJ ou identificador cadastrado.',
          nextStepId: firstToolStep.id,
          maxRetries: 1,
        };
        enriched.unshift(gatherStep);
        // Re-number
        enriched.forEach((s, idx) => {
          s.order = idx + 1;
          s.nextStepId = idx < enriched.length - 1 ? enriched[idx + 1].id : null;
        });
      }
    }
  }

  return enriched;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function compileProcedureFromDocument(input: {
  document: KnowledgeBaseDocument;
  tools: AgentToolCatalogItem[];
  enabledToolNames: string[];
}): ProcedureCompilationResult {
  const { document, tools } = input;
  const warnings: string[] = [];

  const content = document.content || '';
  if (!content.trim()) {
    return { success: false, graph: null, warnings: [], error: 'Documento vazio.' };
  }

  // Only compile documents that have @tool mentions
  TOOL_MENTION.lastIndex = 0;
  if (!TOOL_MENTION.test(content)) {
    return { success: false, graph: null, warnings: [], error: 'Documento sem @tool mencionada.' };
  }

  const toolLookup = buildToolLookup(tools);
  const segments = splitIntoSegments(content, toolLookup);

  // Check if any tool mention was resolved
  const resolvedTools = segments.filter((s) => s.resolvedToolName);
  if (resolvedTools.length === 0) {
    return {
      success: false,
      graph: null,
      warnings: ['Documento tem @tool mas nenhuma foi resolvida no catálogo.'],
      error: 'Nenhuma @tool resolvida.',
    };
  }

  // Check if tools are enabled
  const enabledSet = new Set(input.enabledToolNames);
  for (const seg of resolvedTools) {
    if (seg.resolvedToolName && !enabledSet.has(seg.resolvedToolName)) {
      warnings.push(`Tool ${seg.resolvedToolName} mencionada mas não habilitada para o agente.`);
    }
  }

  const rawSteps = buildStepsFromSegments(segments);
  const steps = enrichSteps(rawSteps, content);

  if (steps.length === 0) {
    return {
      success: false,
      graph: null,
      warnings,
      error: 'Nenhum passo executável identificado.',
    };
  }

  const graph: ProcedureGraph = {
    id: generateProcedureId(document.id),
    documentId: document.id,
    documentName: document.name || 'Sem nome',
    version: 1,
    compiledAt: new Date().toISOString(),
    triggerIntents: extractTriggerIntents(content),
    triggerKeywords: extractTriggerKeywords(content),
    steps,
    metadata: {
      totalSegments: segments.length,
      actionableSegments: steps.length,
      toolMentions: resolvedTools.map((s) => s.resolvedToolName),
    },
  };

  return { success: true, graph, warnings };
}

/**
 * Re-compile a procedure when a document is updated.
 * Bumps the version if the graph changed.
 */
export function recompileProcedure(input: {
  document: KnowledgeBaseDocument;
  tools: AgentToolCatalogItem[];
  enabledToolNames: string[];
  existingGraph: ProcedureGraph | null;
}): ProcedureCompilationResult {
  const result = compileProcedureFromDocument({
    document: input.document,
    tools: input.tools,
    enabledToolNames: input.enabledToolNames,
  });

  if (result.success && result.graph && input.existingGraph) {
    result.graph.version = input.existingGraph.version + 1;
  }

  return result;
}

/**
 * Compile all documents in a config that have @tool mentions.
 */
export function compileAllProcedures(input: {
  documents: KnowledgeBaseDocument[];
  tools: AgentToolCatalogItem[];
  enabledToolNames: string[];
}): ProcedureGraph[] {
  const graphs: ProcedureGraph[] = [];

  for (const document of input.documents) {
    const result = compileProcedureFromDocument({
      document,
      tools: input.tools,
      enabledToolNames: input.enabledToolNames,
    });

    if (result.success && result.graph) {
      graphs.push(result.graph);
    }
  }

  return graphs;
}
