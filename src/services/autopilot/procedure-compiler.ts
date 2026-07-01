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

type ProcedureDocumentSection = {
  title: string;
  content: string;
  index: number;
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

function stripAccents(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function normalizedContentText(value: string): string {
  return stripAccents(value)
    .toLowerCase()
    .replace(/[^a-z0-9@:_\-\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isLikelySectionHeading(line: string): boolean {
  const trimmed = line.trim().replace(/^#{1,6}\s*/, '').replace(/[:：]\s*$/, '');
  if (trimmed.length < 3 || trimmed.length > 90) return false;
  if (/@[a-zA-Z0-9_.:\-]+/.test(trimmed)) return false;
  if (/[.!?]\s*$/.test(trimmed)) return false;
  const ascii = stripAccents(trimmed);
  const letters = ascii.replace(/[^A-Za-z]/g, '');
  if (letters.length < 3) return false;
  const uppercaseLetters = letters.replace(/[^A-Z]/g, '');
  const upperRatio = uppercaseLetters.length / letters.length;
  return line.trim().startsWith('#') || upperRatio >= 0.65 || /^[0-9]+[\).\-\s]+[A-Z]/.test(trimmed);
}

function splitIntoSections(content: string): ProcedureDocumentSection[] {
  const lines = content.replace(/\r\n?/g, '\n').split('\n');
  const sections: ProcedureDocumentSection[] = [];
  let currentTitle: string | null = null;
  let currentLines: string[] = [];

  const flush = () => {
    const body = currentLines.join('\n').trim();
    if (currentTitle && body.length > 0) {
      sections.push({
        title: currentTitle,
        content: body,
        index: sections.length,
      });
    }
    currentLines = [];
  };

  for (const line of lines) {
    if (isLikelySectionHeading(line)) {
      flush();
      currentTitle = line.trim().replace(/^#{1,6}\s*/, '').replace(/[:：]\s*$/, '');
      continue;
    }
    currentLines.push(line);
  }
  flush();
  return sections.filter((section) => section.content.length > 10);
}

function inferToolSemanticIntent(toolName: string | null | undefined, text: string): string | undefined {
  const normalized = normalizedContentText(`${toolName || ''} ${text}`);
  if (/\b(reboot_router|reboot|reiniciar|resetar)\b/.test(normalized)) return 'router_reboot';
  if (/\b(change_wifi_credentials|trocar|mudar|alterar)\b/.test(normalized) && /\b(wifi|wi fi|ssid|senha|rede)\b/.test(normalized)) {
    return 'wifi_credentials_change';
  }
  if (/\b(scan_wifi_neighbors|get_wifi_scan_cached|canal|canais|vizin|interferencia|redes ao redor|lentidao|lento)\b/.test(normalized)) {
    return 'wifi_channel_diagnostics';
  }
  if (/\b(get_wifi_view|refresh_wifi_summary|wifi|wi fi|ssid|senha|usuario|credencia)\b/.test(normalized)) {
    return 'wifi_credentials_lookup';
  }
  if (/\b(sgp_fetch_contact_panel_data|sgp_fetch_contracts|contrato|cliente|cpf|cnpj)\b/.test(normalized)) {
    return 'customer_contract_lookup';
  }
  return undefined;
}

function forbiddenCustomerIntentsForTool(toolName: string | null | undefined, text: string): string[] {
  const semanticIntent = inferToolSemanticIntent(toolName, text);
  if (semanticIntent === 'router_reboot') {
    return ['wifi_credentials_lookup', 'wifi_credentials_change', 'wifi_channel_diagnostics'];
  }
  if (semanticIntent === 'wifi_credentials_change') {
    return ['wifi_credentials_lookup', 'router_reboot'];
  }
  return [];
}

function sectionTriggerDescription(section: ProcedureDocumentSection): string {
  const normalized = normalizedContentText(`${section.title}\n${section.content}`);
  if (/\b(reiniciar|reboot|resetar|reboot_router)\b/.test(normalized)) {
    return `${section.title}: use somente quando o cliente pedir explicitamente reinicio, reboot ou reset do roteador ou modem.`;
  }
  if (/\b(trocar|mudar|alterar|change_wifi_credentials)\b/.test(normalized) && /\b(wifi|wi fi|senha|ssid|nome da rede|credenciais)\b/.test(normalized)) {
    return `${section.title}: use quando o cliente pedir troca de nome, SSID ou senha do Wi-Fi. Exige novos valores e confirmacao.`;
  }
  if (/\b(canal|canais|scan_wifi_neighbors|get_wifi_scan_cached|redes ao redor|vizin|interferencia|lentidao|lento)\b/.test(normalized)) {
    return `${section.title}: use quando o cliente pedir diagnostico de Wi-Fi lento, canais, interferencia ou redes ao redor.`;
  }
  if (/\b(get_wifi_view|refresh_wifi_summary|consultar|senha|usuario|ssid|credenciais|esqueci|nome da rede)\b/.test(normalized)) {
    return `${section.title}: use quando o cliente quiser consultar usuario, senha, SSID, nome da rede ou dados atuais do Wi-Fi. Nao reinicie roteador.`;
  }
  return `${section.title}: use quando a mensagem do cliente combinar com este objetivo e nao com outra secao mais especifica.`;
}

function renameSectionSteps(
  steps: ProcedureStep[],
  nextOrder: { value: number },
  firstStepIdByOldId: Map<string, string>,
): ProcedureStep[] {
  const idMap = new Map<string, { id: string; order: number }>();
  for (const step of steps) {
    const order = nextOrder.value++;
    idMap.set(step.id, { id: `step_${order}`, order });
  }
  for (const [oldId, mapped] of idMap.entries()) {
    firstStepIdByOldId.set(oldId, mapped.id);
  }
  return steps.map((step) => ({
    ...step,
    id: idMap.get(step.id)?.id || `step_${nextOrder.value++}`,
    order: idMap.get(step.id)?.order || nextOrder.value,
    nextStepId: step.nextStepId ? idMap.get(step.nextStepId)?.id || null : null,
  }));
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
      semanticIntent: inferToolSemanticIntent(segment.resolvedToolName, segment.text),
      forbiddenCustomerIntents: forbiddenCustomerIntentsForTool(segment.resolvedToolName, segment.text),
      requiresExplicitCustomerRequest: Boolean(segment.resolvedToolName && /reboot_router|change_wifi_credentials/i.test(segment.resolvedToolName)),
      requiresConfirmation: Boolean(segment.resolvedToolName && /reboot_router|change_wifi_credentials/i.test(segment.resolvedToolName)),
      sideEffect: segment.resolvedToolName && /reboot_router|change_wifi_credentials/i.test(segment.resolvedToolName) ? 'high' : undefined,
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

function buildSectionedSteps(input: {
  content: string;
  toolLookup: Map<string, AgentToolCatalogItem>;
}): { steps: ProcedureStep[]; sections: ProcedureDocumentSection[] } | null {
  const sections = splitIntoSections(input.content)
    .map((section) => ({
      section,
      segments: splitIntoSegments(section.content, input.toolLookup),
    }))
    .filter((item) => item.segments.some((segment) => segment.resolvedToolName));

  if (sections.length < 2) return null;

  const steps: ProcedureStep[] = [];
  const decisionStep: ProcedureStep = {
    id: 'step_1',
    order: 1,
    type: 'decide',
    label: 'Classificar objetivo operacional do procedimento antes de executar ferramentas',
    decisionPrompt: [
      'Escolha exatamente uma secao com base no pedido atual do cliente.',
      'Nunca escolha reboot para pedido de usuario, senha, SSID ou nome de rede Wi-Fi.',
      'Nunca escolha troca de credenciais sem pedido explicito de troca e novos valores/confirmacao.',
    ].join(' '),
    branches: [],
    maxRetries: 1,
  };
  steps.push(decisionStep);

  const nextOrder = { value: 2 };
  const compiledSections: ProcedureDocumentSection[] = [];

  for (const item of sections) {
    const rawSteps = buildStepsFromSegments(item.segments);
    const enrichedSteps = enrichSteps(rawSteps, item.section.content);
    if (enrichedSteps.length === 0) continue;
    const firstStepIdByOldId = new Map<string, string>();
    const renamedSteps = renameSectionSteps(enrichedSteps, nextOrder, firstStepIdByOldId)
      .map((step) => ({
        ...step,
        label: `${item.section.title}: ${step.label}`.slice(0, 220),
        semanticIntent: step.semanticIntent || inferToolSemanticIntent(step.toolName, `${item.section.title}\n${step.label}`),
        forbiddenCustomerIntents: step.forbiddenCustomerIntents?.length
          ? step.forbiddenCustomerIntents
          : forbiddenCustomerIntentsForTool(step.toolName, `${item.section.title}\n${step.label}`),
      }));
    if (renamedSteps.length === 0) continue;
    decisionStep.branches?.push({
      condition: sectionTriggerDescription(item.section),
      nextStepId: renamedSteps[0].id,
    });
    steps.push(...renamedSteps);
    compiledSections.push(item.section);
  }

  if ((decisionStep.branches || []).length < 2) return null;
  return { steps, sections: compiledSections };
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

  const sectioned = buildSectionedSteps({ content, toolLookup });
  const rawSteps = sectioned ? [] : buildStepsFromSegments(segments);
  const steps = sectioned ? sectioned.steps : enrichSteps(rawSteps, content);

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
      sectionAware: Boolean(sectioned),
      sections: sectioned?.sections.map((section) => ({
        title: section.title,
        index: section.index,
      })) || undefined,
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
