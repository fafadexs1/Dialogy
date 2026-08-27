/**
 * Procedure Executor
 *
 * Executes a compiled procedure graph step by step. The executor owns the
 * deterministic parts of a procedure: data collection, tool orchestration,
 * validation, branching, and persisted state transitions. Optional resolver
 * callbacks let the autopilot LLM compose decisions and final responses when a
 * procedure step explicitly asks for AI behavior.
 */

import type { AgentToolAction, AgentToolExecutionResult } from '@/services/agent-tools/types';
import type {
  ProcedureAdvanceResult,
  ProcedureBranch,
  ProcedureExecutionContext,
  ProcedureKnowledgeContext,
  ProcedureGraph,
  ProcedureSlotDefinition,
  ProcedureStep,
  StepExecutionRecord,
} from './procedure-types';
import { saveProcedureExecution } from './procedure-store';
import { extractAutopilotSlots, isValidCustomerIdentifier, labelSlotForCustomer } from './slots';
import type { AutopilotSlotName } from './intent-types';
import { isConversationCloseRequest } from './close-intent';
import { hasClinicalTriageSignal } from './clinical-triage';

const MAX_STEPS_PER_INVOCATION = 6;

export type ProcedureDecisionResolver = (input: {
  step: ProcedureStep;
  context: ProcedureExecutionContext;
  customerMessage: string;
  branches: ProcedureBranch[];
  prompt: string;
  toolResults: AgentToolExecutionResult[];
}) => Promise<string | null | undefined>;

export type ProcedureResponseResolver = (input: {
  step: ProcedureStep;
  context: ProcedureExecutionContext;
  customerMessage: string;
  prompt: string;
  toolResults: AgentToolExecutionResult[];
}) => Promise<string | null | undefined>;

export type ProcedureKnowledgeResolver = (input: {
  step: ProcedureStep;
  context: ProcedureExecutionContext;
  customerMessage: string;
  query: string;
  requiredCoverage: NonNullable<ProcedureStep['requiredKnowledgeCoverage']>;
}) => Promise<ProcedureKnowledgeContext | null | undefined>;

type StepResult = {
  status: 'continue' | 'pause' | 'wait_tool' | 'complete' | 'error';
  response?: string | null;
  action?: AgentToolAction | null;
  error?: string;
  slotCollected?: Record<string, string>;
  decision?: string;
  knowledgeContext?: ProcedureKnowledgeContext | null;
  output?: unknown;
  replaceResponse?: boolean;
  advanceToNextOnPause?: boolean;
  nextStepId?: string | null;
};

function interpolate(
  template: string,
  context: ProcedureExecutionContext,
  extras?: Record<string, unknown>,
): string {
  const vars: Record<string, string> = {
    ...context.collectedSlots,
    ...Object.fromEntries(
      Object.entries(context.decisions).map(([key, value]) => [key, String(value)]),
    ),
    ...Object.fromEntries(
      Object.entries(extras || {}).map(([key, value]) => [key, String(value)]),
    ),
  };

  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] || `{{${key}}}`);
}

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function compactText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function customerMessageLooksLikeQuestion(value: string): boolean {
  const normalized = normalizeText(value);
  if (!normalized) return false;
  return value.includes('?') ||
    /^(e\s+)?(o que|que|qual|quais|como|quando|onde|por que|porque|me explica|explica|queria saber|gostaria de saber|tenho duvida|duvida)\b/.test(normalized) ||
    /\b(como funciona|o que e|o que eh|queria saber|gostaria de saber|me explica|tenho duvida)\b/.test(normalized);
}

function responseAsksForCustomerInput(value: string): boolean {
  const normalized = normalizeText(value);
  return value.includes('?') ||
    /\b(pergunte|me informe|informe|envie|me passe|passa|diga|responda|confirme|qual e|qual seria|quando|onde|como prefere|como deseja|preciso que|por favor|escolha|selecione)\b/.test(normalized);
}

function isExplicitAffirmativeMessage(value: string): boolean {
  return /^(sim|s|sim confirmo|sim pode transferir|sim pode encaminhar|confirmo|confirmado|pode|pode sim|pode transferir|pode encaminhar|autorizo|autorizado|prossiga|ok|okay|certo)$/i
    .test(normalizeText(value));
}

function isExplicitTransferCancellation(value: string): boolean {
  return /^(nao|n|nao quero|melhor nao|deixa|deixa pra la|deixa para la|cancelar|cancela|desisto)$/i
    .test(normalizeText(value));
}

function isExplicitHumanHandoffRequest(value: string): boolean {
  const normalized = normalizeText(value);
  return /\b(falar|conversar)\s+com\s+(um\s+|uma\s+)?(humano|atendente|pessoa)\b/.test(normalized) ||
    /\b(quero|preciso|pode|gostaria)\b.{0,35}\b(atendente|humano|pessoa|suporte humano)\b/.test(normalized) ||
    /\b(me transfere|me encaminha|transferir para|encaminhar para)\b/.test(normalized);
}

function customerAlreadyProvidedActionableDetails(value: string): boolean {
  const normalized = normalizeText(value);
  if (!normalized) return false;
  const wordCount = normalized.split(/\s+/).filter(Boolean).length;
  return (
    hasClinicalTriageSignal(value) ||
    /\d/.test(normalized) ||
    (
      wordCount >= 8 &&
      /\b(problema|febre|tosse|vomit|diarreia|dor|respir|cansaco|pedido|protocolo|fatura|boleto|agendar|consulta|internet|conexao|entrega|orcamento)\b/.test(normalized)
    )
  );
}

function digits(value: string): string {
  return value.replace(/\D/g, '');
}

function isKnownAutopilotSlot(slot: string): slot is AutopilotSlotName {
  return [
    'name',
    'customer_identifier',
    'date',
    'time',
    'phone',
    'email',
    'address',
    'order_or_request_id',
    'invoice_or_payment_id',
    'product_or_service_id',
    'product_or_service_preference',
    'quantity',
    'location',
  ].includes(slot);
}

function inferSlotType(slot: string, definition?: ProcedureSlotDefinition): ProcedureSlotDefinition['type'] {
  const explicitType = definition?.type;
  const text = normalizeText([
    slot,
    definition?.label || '',
    ...(definition?.aliases || []),
  ].join(' '));

  if (explicitType && explicitType !== 'text') return explicitType;

  if (/\b(nome|name|responsavel|responsavel|crianca|criança|paciente)\b/.test(text)) return 'name';
  if (/\b(telefone|phone|whatsapp|celular|contato|ddd)\b/.test(text)) return 'phone';
  if (/\b(email|e-mail)\b/.test(text)) return 'email';
  if (/\b(cpf|cnpj|documento|identificador)\b/.test(text)) return 'document';
  if (/\b(data|nascimento|dia)\b/.test(text)) return 'date';
  if (/\b(horario|hora|periodo|período)\b/.test(text)) return 'time';
  if (/\b(endereco|endereço|bairro|cidade|local|localidade)\b/.test(text)) return 'address';
  if (/\b(quantidade|numero|número|idade|valor)\b/.test(text)) return 'number';
  return 'text';
}

function knownSlotForDefinition(slot: string, definition?: ProcedureSlotDefinition): AutopilotSlotName | null {
  if (isKnownAutopilotSlot(slot)) return slot;
  const type = inferSlotType(slot, definition);
  if (type === 'name') return 'name';
  if (type === 'phone') return 'phone';
  if (type === 'email') return 'email';
  if (type === 'document') return 'customer_identifier';
  if (type === 'date') return 'date';
  if (type === 'time') return 'time';
  if (type === 'address') return 'address';
  return null;
}

function findSlotDefinition(step: ProcedureStep, slot: string): ProcedureSlotDefinition | undefined {
  return step.slotDefinitions?.find((definition) => definition.key === slot);
}

function extractPhone(text: string): string | null {
  const matches = text.match(/(?:\+?\d{1,3}\s*)?(?:\(?\d{2}\)?\s*)?\d{4,5}[-\s]?\d{4}/g);
  if (!matches?.length) return null;
  return digits(matches[matches.length - 1]) || compactText(matches[matches.length - 1]);
}

function extractEmail(text: string): string | null {
  const matches = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig);
  return matches?.[matches.length - 1]?.toLowerCase() || null;
}

function extractDocument(text: string): string | null {
  const match = text.match(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b|\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/);
  return match ? digits(match[0]) : null;
}

function extractGenericName(text: string): string | null {
  if (customerMessageLooksLikeQuestion(text)) return null;
  const withoutPhoneEmailDoc = text
    .replace(/(?:\+?\d{1,3}\s*)?(?:\(?\d{2}\)?\s*)?\d{4,5}[-\s]?\d{4}/g, ' ')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig, ' ')
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b|\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, ' ');
  const explicit = withoutPhoneEmailDoc.match(/\b(?:meu nome(?: completo)?\s*(?:e|é|eh)|nome(?: completo)?\s*[:=]|sou|me chamo|chamo)\s+([a-zÀ-ÿ][a-zÀ-ÿ' ]{2,80})/i)?.[1];
  const candidate = compactText(explicit || withoutPhoneEmailDoc.split(/[,;\n]/)[0] || '');
  if (!candidate || candidate.length < 4) return null;
  const normalized = normalizeText(candidate);
  if (/^(oi|ola|olá|sim|nao|não|ok|certo|obrigad[ao]|e agora|por favor)$/.test(normalized)) return null;
  if (!/[a-zÀ-ÿ]{2,}/i.test(candidate)) return null;
  return candidate.replace(/[.!?;:,]+$/g, '').trim();
}

function isLikelyRawAddressAnswer(text: string): boolean {
  if (customerMessageLooksLikeQuestion(text)) return false;
  const normalized = normalizeText(text);
  return /\d/.test(normalized) ||
    /\b(rua|avenida|av|travessa|alameda|rodovia|estrada|quadra|lote|numero|nro|bairro|cidade|casa|apto|apartamento|bloco|condominio|cep)\b/.test(normalized);
}

function extractGenericSlotValue(input: {
  slot: string;
  definition?: ProcedureSlotDefinition;
  customerMessage: string;
  extraction: ReturnType<typeof extractAutopilotSlots>;
}): string | null {
  const slotType = inferSlotType(input.slot, input.definition);
  const knownSlot = knownSlotForDefinition(input.slot, input.definition);
  if (knownSlot && input.extraction.slots[knownSlot]) return String(input.extraction.slots[knownSlot]);

  if (slotType === 'phone') return extractPhone(input.customerMessage);
  if (slotType === 'email') return extractEmail(input.customerMessage);
  if (slotType === 'document') return extractDocument(input.customerMessage);
  if (slotType === 'name') return extractGenericName(input.customerMessage);
  if (slotType === 'number') return input.customerMessage.match(/\b\d+(?:[,.]\d+)?\b/)?.[0] || null;
  if (
    slotType === 'text' &&
    compactText(input.customerMessage).length >= 2 &&
    !customerMessageLooksLikeQuestion(input.customerMessage)
  ) {
    return compactText(input.customerMessage);
  }
  return null;
}

function findStep(graph: ProcedureGraph, stepId: string): ProcedureStep | null {
  return graph.steps.find((step) => step.id === stepId) || null;
}

function getToolResultsForStep(
  context: ProcedureExecutionContext,
  stepId: string,
): AgentToolExecutionResult[] {
  const raw = context.toolResults?.[stepId];
  if (!raw) return [];
  return Array.isArray(raw)
    ? raw as AgentToolExecutionResult[]
    : [raw as AgentToolExecutionResult];
}

function getAllToolResults(context: ProcedureExecutionContext): AgentToolExecutionResult[] {
  return Object.values(context.toolResults || {}).flatMap((value) => {
    if (!value) return [];
    return Array.isArray(value)
      ? value as AgentToolExecutionResult[]
      : [value as AgentToolExecutionResult];
  });
}

function hasSuccessfulToolResult(context: ProcedureExecutionContext): boolean {
  return getAllToolResults(context).some((result) => result.status === 'success');
}

function hasFailedToolResult(context: ProcedureExecutionContext): boolean {
  return getAllToolResults(context).some((result) => result.status !== 'success');
}

function summarizeRuntimeContext(
  context: ProcedureExecutionContext,
  customerMessage: string,
): string {
  const slotValues = Object.values(context.collectedSlots || {}).join(' ');
  const decisionValues = Object.values(context.decisions || {}).join(' ');
  const toolValues = getAllToolResults(context)
    .map((result) => [
      result.toolName,
      result.status,
      result.error || '',
      JSON.stringify(result.output || {}),
    ].join(' '))
    .join(' ');

  return normalizeText([
    customerMessage,
    slotValues,
    decisionValues,
    toolValues,
  ].filter(Boolean).join(' '));
}

type CustomerToolIntent =
  | 'wifi_credentials_lookup'
  | 'wifi_credentials_change'
  | 'wifi_channel_diagnostics'
  | 'router_reboot'
  | 'unknown';

function inferCustomerToolIntent(customerMessage: string): CustomerToolIntent {
  const normalized = normalizeText(customerMessage);
  const mentionsWifi = /\b(wi fi|wifi|ssid|rede|senha|usuario|credencia)\w*/.test(normalized);
  const wantsChange = /\b(trocar|mudar|alterar|atualizar|nova|novo|configurar)\w*/.test(normalized);
  if (/\b(reiniciar|reinicie|reboot|resetar|desligar e ligar)\w*/.test(normalized)) {
    return 'router_reboot';
  }
  if (mentionsWifi && wantsChange) return 'wifi_credentials_change';
  if (mentionsWifi && /\b(canal|canais|redes ao redor|vizin|interferencia|lento|lentidao|oscila|queda|sinal fraco|analisar)\w*/.test(normalized)) {
    return 'wifi_channel_diagnostics';
  }
  if (mentionsWifi && /\b(ver|verificar|consultar|saber|mostrar|recuperar|esqueci|qual|usuario|senha|ssid|nome da rede|credencia)\w*/.test(normalized)) {
    return 'wifi_credentials_lookup';
  }
  return 'unknown';
}

function semanticIntentForToolStep(step: ProcedureStep): CustomerToolIntent {
  const text = normalizeText([
    step.semanticIntent || '',
    step.toolName || '',
    step.label || '',
    step.promptTemplate || '',
    step.condition || '',
  ].join(' '));
  if (/\b(router_reboot|reboot_router|reboot|reiniciar|resetar)\b/.test(text)) return 'router_reboot';
  if (/\b(wifi_credentials_change|change_wifi_credentials|trocar|mudar|alterar)\b/.test(text) && /\b(wifi|wi fi|ssid|senha|rede|credentials)\b/.test(text)) {
    return 'wifi_credentials_change';
  }
  if (/\b(wifi_channel_diagnostics|scan_wifi_neighbors|get_wifi_scan_cached|canal|canais|interferencia|redes ao redor|vizin|lento|lentidao)\b/.test(text)) {
    return 'wifi_channel_diagnostics';
  }
  if (/\b(wifi_credentials_lookup|get_wifi_view|refresh_wifi_summary|ssid|senha|usuario|credencia|nome da rede)\b/.test(text)) {
    return 'wifi_credentials_lookup';
  }
  return 'unknown';
}

function buildToolIntentMismatchResponse(input: {
  step: ProcedureStep;
  customerIntent: CustomerToolIntent;
  stepIntent: CustomerToolIntent;
}): string | null {
  if (input.customerIntent === 'unknown' || input.stepIntent === 'unknown') return null;
  if (input.customerIntent === input.stepIntent) return null;

  if (input.customerIntent === 'wifi_credentials_lookup' && input.stepIntent === 'router_reboot') {
    return 'Entendi que voce quer consultar os dados atuais do Wi-Fi, nao reiniciar o roteador. Vou interromper esta etapa automatica para seguir pela consulta correta de usuario/senha/SSID.';
  }
  if (input.customerIntent === 'wifi_credentials_lookup' && input.stepIntent === 'wifi_credentials_change') {
    return 'Entendi que voce quer consultar os dados atuais do Wi-Fi, nao trocar nome ou senha. Vou pausar esta etapa para seguir pelo caminho correto de consulta.';
  }
  if (input.customerIntent === 'wifi_channel_diagnostics' && (input.stepIntent === 'router_reboot' || input.stepIntent === 'wifi_credentials_change')) {
    return 'Entendi que o pedido e diagnosticar o Wi-Fi/canais antes de qualquer alteracao. Vou pausar esta etapa para usar primeiro as ferramentas de analise.';
  }
  if (input.customerIntent === 'wifi_credentials_change' && input.stepIntent === 'router_reboot') {
    return 'Entendi que o pedido e alterar dados do Wi-Fi, nao reiniciar o roteador. Vou pausar este caminho para coletar os novos dados e confirmar antes de qualquer mudanca.';
  }
  return null;
}

function shouldBlockToolForCustomerIntent(step: ProcedureStep, customerMessage: string): { blocked: boolean; response?: string; customerIntent?: CustomerToolIntent; stepIntent?: CustomerToolIntent } {
  const customerIntent = inferCustomerToolIntent(customerMessage);
  const stepIntent = semanticIntentForToolStep(step);
  const mismatchResponse = buildToolIntentMismatchResponse({ step, customerIntent, stepIntent });
  if (mismatchResponse) {
    return { blocked: true, response: mismatchResponse, customerIntent, stepIntent };
  }

  if (step.requiresExplicitCustomerRequest && stepIntent !== 'unknown' && customerIntent !== stepIntent) {
    return {
      blocked: true,
      response: 'Para evitar executar uma ferramenta sensivel fora do pedido atual, vou pausar esta etapa e confirmar o objetivo antes de continuar.',
      customerIntent,
      stepIntent,
    };
  }

  return { blocked: false, customerIntent, stepIntent };
}

function hasRepeatedStepWithoutProgress(context: ProcedureExecutionContext, step: ProcedureStep): boolean {
  if (step.type === 'gather_data') return false;
  const recent = context.stepHistory.slice(-6).filter((record) => record.stepId === step.id);
  if (recent.length < 3) return false;
  const hasSuccessfulToolOutput = getToolResultsForStep(context, step.id).some((result) => result.status === 'success');
  if (hasSuccessfulToolOutput) return false;
  return recent.every((record) => record.status === 'waiting' || record.status === 'waiting_tool' || record.status === 'error');
}

function matchDecisionToBranch(
  branches: ProcedureBranch[] | undefined,
  decision: string | null | undefined,
): ProcedureBranch | null {
  if (!branches?.length || !decision) return null;
  const normalizedDecision = normalizeText(decision);

  return branches.find((branch) => {
    const condition = normalizeText(branch.condition);
    const nextStepId = normalizeText(branch.nextStepId);
    return normalizedDecision === condition
      || normalizedDecision === nextStepId
      || normalizedDecision.includes(condition)
      || condition.includes(normalizedDecision);
  }) || null;
}

function chooseBranchHeuristically(
  branches: ProcedureBranch[] | undefined,
  context: ProcedureExecutionContext,
  customerMessage: string,
): ProcedureBranch | null {
  if (!branches?.length) return null;
  if (branches.length === 1) return branches[0];

  const haystack = summarizeRuntimeContext(context, customerMessage);
  const explicitHighRiskBranch = branches.find((branch) => {
    const branchText = normalizeText(branch.condition);
    return /\b(vermelh|emergenc|emergencia|transferencia imediata|pronto socorro|pronto atendimento)\w*/.test(branchText);
  });
  if (explicitHighRiskBranch && hasExplicitHighRiskSignal(haystack)) {
    return explicitHighRiskBranch;
  }
  if (explicitHighRiskBranch && isMedicationDosageRequest(haystack)) {
    const nonHighRiskBranch = branches.find((branch) => branch !== explicitHighRiskBranch);
    if (nonHighRiskBranch) return nonHighRiskBranch;
  }

  let best: { branch: ProcedureBranch; score: number } | null = null;

  for (const branch of branches) {
    const terms = normalizeText(branch.condition)
      .split(/\s+/)
      .filter((term) => term.length >= 3);
    const score = terms.reduce((total, term) => total + (haystack.includes(term) ? 1 : 0), 0);
    if (!best || score > best.score) {
      best = { branch, score };
    }
  }

  return best && best.score > 0 ? best.branch : null;
}

function isMedicationDosageRequest(text: string): boolean {
  return (
    /\b(quant[ao]s?|dose|dosagem|gotas?|gotinha|ml|mg)\b/.test(text) &&
    /\b(dipirona|paracetamol|ibuprofeno|remedio|medicamento|antitermico|antiinflamatorio|antibiotico|dar|dou|posso dar)\b/.test(text)
  );
}

function hasExplicitHighRiskSignal(text: string): boolean {
  const hasSevereRespiratorySignal =
    /\b(costela|costelas|furcula|peito)\b.{0,40}\b(afunda|afundando|puxa|repuxa)\b/.test(text) ||
    /\b(respirando|respiracao|respira)\b.{0,40}\b(muito rapido|rapida demais|dificuldade|falta de ar|cansaco intenso)\b/.test(text) ||
    /\b(labios?|dedos?)\b.{0,30}\b(rox|azulad|cianos)\w*/.test(text);
  const hasNeurologicalSignal =
    /\b(convuls|dificil de acordar|nao acorda|sonolencia extrema|muito sonolent|inconsolavel)\w*/.test(text);
  const hasSevereDehydrationSignal =
    /\b(nao urina|sem urinar|nao fez xixi|sem xixi)\b.{0,30}\b(6|7|8|9|10|seis|sete|oito|nove|dez)\b/.test(text) ||
    /\b(vomita tudo|vomitando tudo|vomitos incoerciveis|recusa liquidos|nao aceita liquido|boca seca|olhos fundos|choro sem lagrima)\b/.test(text);
  const hasPurpuricRash = /\b(manchas?)\b.{0,40}\b(rox|arroxead|vermelh)\w*/.test(text) && /\b(nao somem|nao some|pressionar)\b/.test(text);
  const hasYoungBabyFever =
    /\b(0|1|2)\s*mes(?:es)?\b/.test(text) &&
    /\b(38|38\s*[1-9]|39|40|41|42)\b/.test(text);

  return hasSevereRespiratorySignal ||
    hasNeurologicalSignal ||
    hasSevereDehydrationSignal ||
    hasPurpuricRash ||
    hasYoungBabyFever;
}

function findNextStep(
  graph: ProcedureGraph,
  currentStep: ProcedureStep,
  context: ProcedureExecutionContext,
): ProcedureStep | null {
  if (currentStep.branches?.length) {
    const branch = matchDecisionToBranch(currentStep.branches, context.decisions[currentStep.id]);
    if (branch) {
      const target = findStep(graph, branch.nextStepId);
      if (target) return target;
    }
  }

  return currentStep.nextStepId ? findStep(graph, currentStep.nextStepId) : null;
}

function missingRequiredSlots(
  requiredSlots: string[] | undefined,
  context: ProcedureExecutionContext,
): string[] {
  return (requiredSlots || []).filter((slot) => !String(context.collectedSlots[slot] || '').trim());
}

function labelProcedureSlot(slot: string, step?: ProcedureStep): string {
  const definition = step ? findSlotDefinition(step, slot) : undefined;
  if (definition?.label?.trim()) return definition.label.trim();
  return isKnownAutopilotSlot(slot) ? labelSlotForCustomer(slot) : slot;
}

function buildMissingSlotsPrompt(slots: string[], step?: ProcedureStep): string {
  if (slots.length === 0) return 'Para seguir, me informe os dados solicitados.';
  const label = labelProcedureSlot(slots[0], step).replace(/^./, (char) => char.toLowerCase());
  return `Para seguir, me informe ${label}.`;
}

function buildCollectPromptForNextSlot(step: ProcedureStep, slots: string[], context: ProcedureExecutionContext): string {
  const requestedSlots = slots.slice(0, 1);
  if (requestedSlots.length === 1 && step.requiredSlots?.length === 1 && step.promptTemplate?.trim()) {
    return interpolate(step.promptTemplate, context);
  }
  return buildMissingSlotsPrompt(requestedSlots, step);
}

async function executeGatherDataStep(
  step: ProcedureStep,
  customerMessage: string,
  context: ProcedureExecutionContext,
  isResuming: boolean,
  responseResolver?: ProcedureResponseResolver,
  forceLlmRespond?: boolean,
): Promise<StepResult> {
  const isOpenQuestionCheckpoint = (
    (step.requiredSlots || []).length === 0 &&
    Boolean(step.promptTemplate?.trim()) &&
    responseAsksForCustomerInput(step.promptTemplate || '')
  );
  if (isOpenQuestionCheckpoint) {
    if (!isResuming || !customerMessage.trim()) {
      const prompt = interpolate(step.promptTemplate || step.label, context);
      if (forceLlmRespond && responseResolver) {
        const resolved = await responseResolver({
          step,
          context,
          customerMessage,
          prompt: [
            'Transforme a instrucao operacional abaixo em uma unica pergunta curta, natural e empatica para o cliente.',
            'Nao mencione fluxo, procedimento, documento, etapa, ferramenta ou instrucao interna.',
            'Nao diga que realizou verificacoes que ainda nao foram feitas.',
            `Instrucao operacional: ${prompt}`,
          ].join('\n'),
          toolResults: getAllToolResults(context),
        });
        if (resolved?.trim()) {
          return {
            status: 'pause',
            response: resolved.trim(),
          };
        }
      }
      return {
        status: 'pause',
        response: prompt,
      };
    }
    return {
      status: 'continue',
      slotCollected: {
        [`response_${step.id}`]: customerMessage.trim(),
      },
    };
  }

  const missing = missingRequiredSlots(step.requiredSlots, context);
  if (missing.length === 0) {
    return { status: 'continue' };
  }
  const priorWaitAttempts = context.stepHistory.filter((record) => (
    record.stepId === step.id && record.status === 'waiting'
  )).length;

  if (!isResuming) {
    const requestedSlots = missing.slice(0, 1);
    const prompt = buildCollectPromptForNextSlot(step, requestedSlots, context);

    if (forceLlmRespond && responseResolver && process.env.AI_COLLECT_LLM_PROMPTS === '1') {
      const resolved = await responseResolver({
        step,
        context,
        customerMessage,
        prompt: `Por favor, solicite de forma empática e profissional os seguintes dados do cliente que estão faltando: ${missing.join(', ')}. Contexto operacional: ${prompt}`,
        toolResults: getAllToolResults(context),
      });
      if (resolved) {
        return { status: 'pause', response: resolved };
      }
    }

    return { status: 'pause', response: prompt };
  }

  const missingBefore = missingRequiredSlots(step.requiredSlots, context);
  const collected: Record<string, string> = {};

  if (missingBefore.length === 0) {
    if (customerMessage.trim()) collected._response = customerMessage.trim();
    return { status: 'continue', slotCollected: collected };
  }

  const extraction = extractAutopilotSlots({ customerMessage });
  for (const slot of missingBefore) {
    const definition = findSlotDefinition(step, slot);
    const knownSlot = knownSlotForDefinition(slot, definition);
    if (knownSlot && extraction.slots[knownSlot]) {
      collected[slot] = String(extraction.slots[knownSlot]);
      continue;
    }

    const genericValue = extractGenericSlotValue({
      slot,
      definition,
      customerMessage,
      extraction,
    });
    if (genericValue) {
      collected[slot] = genericValue;
    }
  }

  const missingAfterExtraction = missingBefore.filter((slot) => !collected[slot]);
  if (missingAfterExtraction.includes('customer_identifier')) {
    const invalidIdentifier = extraction.invalidSlots.find((slot) => slot.name === 'customer_identifier');
    if (invalidIdentifier) {
      if (forceLlmRespond && responseResolver) {
        const resolved = await responseResolver({
          step,
          context,
          customerMessage,
          prompt: `Informe ao cliente com empatia que o CPF/CNPJ digitado é inválido e peça para ele digitar novamente.`,
          toolResults: getAllToolResults(context),
        });
        if (resolved) {
          return {
            status: 'pause',
            response: resolved,
            slotCollected: collected,
          };
        }
      }
      return {
        status: 'pause',
        response: 'O CPF/CNPJ informado parece invalido. Pode enviar novamente, por favor?',
        slotCollected: collected,
      };
    }
  }

  if (missingAfterExtraction.length === 1 && customerMessage.trim()) {
    const fallbackSlot = missingAfterExtraction[0];
    const fallbackDefinition = findSlotDefinition(step, fallbackSlot);
    const fallbackType = inferSlotType(fallbackSlot, fallbackDefinition);
    const canUseRawTextFallback = fallbackType === 'text'
      ? !customerMessageLooksLikeQuestion(customerMessage)
      : fallbackType === 'address' && isLikelyRawAddressAnswer(customerMessage);
    if (
      (fallbackSlot === 'customer_identifier' && isValidCustomerIdentifier(customerMessage)) ||
      (fallbackSlot !== 'customer_identifier' && canUseRawTextFallback)
    ) {
      collected[fallbackSlot] = customerMessage.trim();
    }
  }

  const stillMissing = missingBefore.filter((slot) => !collected[slot] && !context.collectedSlots[slot]);
  if (stillMissing.length > 0) {
    const madeProgress = Object.keys(collected).some((slot) => Boolean(collected[slot]));
    const maxAttempts = step.maxRetries ?? 2;
    if (!madeProgress && priorWaitAttempts >= maxAttempts) {
      return {
        status: 'complete',
        response: 'Para evitar repetir a mesma pergunta, vou pausar esta etapa automatica. Pode enviar os dados em uma unica mensagem ou solicitar atendimento humano.',
        slotCollected: collected,
        output: {
          loopBreaker: true,
          missingSlots: stillMissing,
          attempts: priorWaitAttempts + 1,
        },
      };
    }

    const requestedSlots = stillMissing.slice(0, 1);
    const prompt = buildCollectPromptForNextSlot(step, requestedSlots, context);

    if (forceLlmRespond && responseResolver && process.env.AI_COLLECT_LLM_PROMPTS === '1') {
      const resolved = await responseResolver({
        step,
        context,
        customerMessage,
        prompt: `Solicite de forma empática e profissional os seguintes dados que continuam ausentes: ${stillMissing.join(', ')}. Contexto operacional: ${prompt}`,
        toolResults: getAllToolResults(context),
      });
      if (resolved) {
        return {
          status: 'pause',
          response: resolved,
          slotCollected: collected,
        };
      }
    }

    return {
      status: 'pause',
      response: prompt,
      slotCollected: collected,
    };
  }

  return { status: 'continue', slotCollected: collected };
}

function executeToolCallStep(
  step: ProcedureStep,
  context: ProcedureExecutionContext,
  customerMessage: string,
): StepResult {
  if (!step.toolName) {
    return { status: 'error', error: 'Passo de tool_call sem toolName definido.' };
  }

  if (step.toolName === 'transfer_chat' && step.requiresConfirmation) {
    const transferAuthorized = (
      isExplicitHumanHandoffRequest(customerMessage) ||
      isExplicitAffirmativeMessage(customerMessage)
    );
    if (!transferAuthorized) {
      const cancelled = isExplicitTransferCancellation(customerMessage);
      return {
        status: 'complete',
        response: cancelled
          ? 'Certo, nao vou transferir o atendimento. Podemos continuar a verificacao por aqui.'
          : 'Antes de transferir o atendimento, preciso da sua confirmacao explicita. Posso encaminhar para uma pessoa da equipe?',
        output: {
          transferBlocked: true,
          reason: cancelled
            ? 'customer_declined_transfer'
            : 'explicit_transfer_confirmation_missing',
        },
      };
    }
  }

  if (
    step.toolName === 'close_chat' &&
    !isConversationCloseRequest(customerMessage) &&
    !stepAllowsProcedureDrivenClose(step)
  ) {
    return {
      status: 'complete',
      output: {
        skipped: true,
        reason: 'close_chat bloqueado porque a mensagem atual nao pediu encerramento.',
      },
    };
  }

  const intentGate = shouldBlockToolForCustomerIntent(step, customerMessage);
  if (intentGate.blocked) {
    return {
      status: 'complete',
      response: intentGate.response,
      output: {
        toolIntentBlocked: true,
        toolName: step.toolName,
        customerIntent: intentGate.customerIntent,
        stepIntent: intentGate.stepIntent,
      },
    };
  }

  const existingResults = getToolResultsForStep(context, step.id);
  if (existingResults.length > 0) {
    const successful = existingResults.some((result) => result.status === 'success');
    if (successful) {
      return {
        status: 'continue',
        output: existingResults,
        nextStepId: step.successStepId || step.nextStepId || null,
      };
    }
    if (step.errorStepId) {
      return {
        status: 'continue',
        output: {
          toolFailed: true,
          routedTo: step.errorStepId,
          results: existingResults,
        },
        nextStepId: step.errorStepId,
      };
    }
    return {
      status: 'error',
      error: existingResults.map((result) => result.error).filter(Boolean).join(' ')
        || `A ferramenta ${step.toolName} falhou.`,
      output: existingResults,
    };
  }

  if (step.requiresConfirmation && step.toolName !== 'transfer_chat') {
    const confirmationKey = `confirmation_${step.id}`;
    const alreadyConfirmed = context.decisions[confirmationKey] === 'confirmed';
    const confirmationWasRequested = context.stepHistory.some((record) => (
      record.stepId === step.id
      && record.status === 'waiting'
      && Boolean((record.output as Record<string, unknown> | null)?.confirmationRequired)
    ));
    if (!alreadyConfirmed && confirmationWasRequested && isExplicitAffirmativeMessage(customerMessage)) {
      context.decisions[confirmationKey] = 'confirmed';
    } else if (!alreadyConfirmed && confirmationWasRequested && isExplicitTransferCancellation(customerMessage)) {
      return {
        status: 'complete',
        response: 'Certo, a acao foi cancelada e nenhuma alteracao foi executada.',
        output: {
          confirmationRequired: true,
          confirmationDeclined: true,
          toolName: step.toolName,
        },
      };
    } else if (!alreadyConfirmed) {
      return {
        status: 'pause',
        response: step.confirmationPrompt?.trim()
          || `Antes de executar ${step.label.toLowerCase()}, preciso da sua confirmacao explicita. Posso prosseguir?`,
        output: {
          confirmationRequired: true,
          toolName: step.toolName,
        },
      };
    }
  }

  if (
    step.toolName === 'sgp_fetch_contact_panel_data' ||
    step.toolName === 'sgp_fetch_contracts'
  ) {
    const reusableResults = getAllToolResults(context).filter((result) => (
      result.toolName === step.toolName && result.status === 'success'
    ));
    if (reusableResults.length > 0) {
      return {
        status: 'continue',
        output: {
          reused: true,
          toolName: step.toolName,
        },
      };
    }
  }

  const payload: Record<string, unknown> = {};
  for (const [key, template] of Object.entries(step.toolPayloadTemplate || {})) {
    payload[key] = interpolate(template, context);
  }
  if (step.toolName === 'add_internal_note' && !String(payload.content || '').trim()) {
    payload.content = `Procedimento "${context.procedureName}": ${step.label}`;
  }

  const action: AgentToolAction = step.toolName.startsWith('mcp:')
    ? {
      type: 'mcp_call_tool',
      reason: `Procedure step: ${step.label}`,
      payload: {
        toolName: step.toolName,
        arguments: payload,
      },
    }
    : {
      type: step.toolName as any,
      reason: `Procedure step: ${step.label}`,
      payload,
    };

  return { status: 'wait_tool', action };
}

function stepAllowsProcedureDrivenClose(step: ProcedureStep): boolean {
  const text = [
    step.id,
    step.label,
    step.promptTemplate || '',
    step.responseTemplate || '',
    step.condition || '',
  ].join('\n')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  if (/\bquando\s+o\s+cliente\s+pedir\b|\bcliente\s+pedir\s+para\s+encerrar\b/.test(text)) {
    return false;
  }

  return (
    /\b(fim|final|finalizacao|conclusao|concluid|encerramento\s+automatico|apos\s+concluir|depois\s+de\s+concluir)\b/.test(text) &&
    /\b(atendimento|chat|conversa|fluxo|procedimento)\b/.test(text)
  );
}

function evaluateValidation(
  step: ProcedureStep,
  context: ProcedureExecutionContext,
): { passes: boolean; reason?: string } {
  const condition = step.condition || '';
  if (!condition.trim()) return { passes: true };

  const interpolated = interpolate(condition, context);
  if (/\{\{\w+\}\}/.test(interpolated)) {
    return { passes: false, reason: `Dados ausentes para validar: ${condition}` };
  }

  const normalized = normalizeText(condition);
  const identifier = context.collectedSlots.customer_identifier;
  if (/\b(cpf|cnpj|customer_identifier|identificador|documento)\b/.test(normalized)) {
    if (!identifier || !isValidCustomerIdentifier(identifier)) {
      return { passes: false, reason: 'CPF/CNPJ ausente ou invalido.' };
    }
  }

  const expectsToolData =
    /\b(tool|ferramenta|consulta|sgp|mcp|sistema|contrato|fatura|boleto|sinal|conexao|status|sucesso)\b/.test(normalized);
  if (expectsToolData) {
    if (hasFailedToolResult(context)) {
      return { passes: false, reason: 'A ferramenta retornou erro.' };
    }
    if (!hasSuccessfulToolResult(context)) {
      return { passes: false, reason: 'Resultado de ferramenta ausente.' };
    }
  }

  return { passes: true };
}

function executeValidateStep(
  step: ProcedureStep,
  context: ProcedureExecutionContext,
): StepResult {
  const validation = evaluateValidation(step, context);
  if (validation.passes) return { status: 'continue' };

  const onFail = step.onFail || 'skip';
  if (onFail === 'skip') return { status: 'continue' };
  return { status: 'error', error: validation.reason || `Validacao falhou: ${step.condition || step.label}` };
}

function coverageRank(value: ProcedureKnowledgeContext['coverage'] | null | undefined): number {
  if (value === 'high') return 3;
  if (value === 'medium') return 2;
  if (value === 'low') return 1;
  return 0;
}

function formatKnowledgeChunksForPrompt(context: ProcedureKnowledgeContext | null | undefined): string {
  const chunks = context?.chunks || [];
  if (chunks.length === 0) return '';
  return [
    'Contexto permitido da base de conhecimento:',
    ...chunks.slice(0, 5).map((chunk, index) => [
      `[${index + 1}] ${chunk.title} (${chunk.category}, score ${chunk.score})`,
      chunk.excerpt,
    ].join('\n')),
  ].join('\n\n');
}

async function executeRetrieveKnowledgeStep(
  step: ProcedureStep,
  customerMessage: string,
  context: ProcedureExecutionContext,
  knowledgeResolver?: ProcedureKnowledgeResolver,
): Promise<StepResult> {
  const requiredCoverage = step.requiredKnowledgeCoverage || 'medium';
  const query = step.knowledgeQueryTemplate
    ? interpolate(step.knowledgeQueryTemplate, context, { customerMessage })
    : customerMessage;

  if (!knowledgeResolver) {
    const knowledgeContext: ProcedureKnowledgeContext = {
      coverage: 'none',
      chunks: [],
      reason: 'knowledge_resolver_missing',
    };
    return {
      status: step.onLowKnowledge === 'continue' ? 'continue' : 'pause',
      response: step.onLowKnowledge === 'continue'
        ? null
        : 'Nao encontrei uma base suficiente para responder isso com seguranca agora. Pode me dar mais detalhes ou solicitar atendimento humano.',
      knowledgeContext,
      output: knowledgeContext,
    };
  }

  const resolvedKnowledgeContext = await knowledgeResolver({
    step,
    context,
    customerMessage,
    query,
    requiredCoverage,
  }) || { coverage: 'none' as const, chunks: [], reason: 'knowledge_empty' };
  const knowledgeContext: ProcedureKnowledgeContext = {
    ...resolvedKnowledgeContext,
    chunks: (resolvedKnowledgeContext.chunks || []).map((chunk) => ({
      ...chunk,
      coverage: chunk.coverage || resolvedKnowledgeContext.coverage,
    })),
  };
  const enoughCoverage = coverageRank(knowledgeContext.coverage) >= coverageRank(requiredCoverage);
  if (!enoughCoverage && step.onLowKnowledge !== 'continue') {
    return {
      status: step.onLowKnowledge === 'handoff' ? 'complete' : 'pause',
      response: 'Nao encontrei orientacao suficiente na base para responder isso com seguranca. Vou evitar inventar informacoes; posso coletar mais detalhes ou encaminhar para atendimento humano.',
      knowledgeContext,
      output: {
        ...knowledgeContext,
        lowCoverage: true,
        requiredCoverage,
      },
    };
  }

  return {
    status: 'continue',
    knowledgeContext,
    output: knowledgeContext,
  };
}

async function executeDecideStep(
  step: ProcedureStep,
  context: ProcedureExecutionContext,
  customerMessage: string,
  decisionResolver?: ProcedureDecisionResolver,
): Promise<StepResult> {
  const branches = step.branches || [];
  if (branches.length === 0) return { status: 'continue', decision: 'default' };

  const prompt = step.decisionPrompt
    ? interpolate(step.decisionPrompt, context)
    : `Escolha uma das opcoes: ${branches.map((branch) => branch.condition).join(', ')}`;

  let selectedBranch: ProcedureBranch | null = chooseBranchHeuristically(branches, context, customerMessage);
  if (decisionResolver) {
    const resolved = await decisionResolver({
      step,
      context,
      customerMessage,
      branches,
      prompt,
      toolResults: getAllToolResults(context),
    });
    selectedBranch ||= matchDecisionToBranch(branches, resolved);
  }

  selectedBranch ||= branches.length === 1 ? branches[0] : null;

  return {
    status: 'continue',
    decision: selectedBranch?.condition || 'default',
  };
}

async function executeRespondStep(
  step: ProcedureStep,
  context: ProcedureExecutionContext,
  customerMessage: string,
  responseResolver?: ProcedureResponseResolver,
  forceLlmRespond?: boolean,
): Promise<StepResult> {
  const templateResponse = step.responseTemplate
    ? interpolate(step.responseTemplate, context)
    : '';
  const knowledgePrompt = formatKnowledgeChunksForPrompt(context.knowledgeContext);
  const requiresGrounding = Boolean(step.requireGrounding);
  const isSubAgent = step.useLlm && step.visualNodeKind === 'sub_agent';
  const isQuestionMessage = step.visualNodeKind === 'message' && responseAsksForCustomerInput(templateResponse);
  const shouldReturnToMain = Boolean(isSubAgent && step.returnToMainPrompt && step.nextStepId);

  if (isQuestionMessage && step.nextStepId && customerAlreadyProvidedActionableDetails(customerMessage)) {
    return { status: 'continue', response: null };
  }

  if (isQuestionMessage) {
    return {
      status: 'pause',
      response: templateResponse || null,
      advanceToNextOnPause: Boolean(step.nextStepId),
    };
  }

  if (requiresGrounding && coverageRank(context.knowledgeContext?.coverage) < coverageRank(step.requiredKnowledgeCoverage || 'low')) {
    return {
      status: 'pause',
      response: 'Nao encontrei confirmacao suficiente na base para responder isso com seguranca. Posso coletar mais detalhes ou encaminhar para atendimento humano.',
      output: {
        groundingBlocked: true,
        knowledgeCoverage: context.knowledgeContext?.coverage || 'none',
      },
    };
  }

  if ((step.useLlm || forceLlmRespond) && responseResolver) {
    const resolved = await responseResolver({
      step,
      context,
      customerMessage,
      prompt: [
        templateResponse || step.label,
        requiresGrounding
          ? 'Use somente os fatos presentes no contexto da base e nos dados confirmados. Se nao houver suporte, diga que nao encontrou base suficiente.'
          : '',
        knowledgePrompt,
      ].filter(Boolean).join('\n\n'),
      toolResults: getAllToolResults(context),
    });
    return {
      status: isSubAgent ? 'pause' : 'continue',
      response: resolved || templateResponse || null,
      advanceToNextOnPause: shouldReturnToMain,
    };
  }

  return {
    status: isSubAgent ? 'pause' : 'continue',
    response: templateResponse || null,
    advanceToNextOnPause: shouldReturnToMain,
  };
}

function executeHandoffStep(
  step: ProcedureStep,
  context: ProcedureExecutionContext,
  availableTeams: Array<{ id: string; name: string }> = [],
): StepResult {
  const reason = step.handoffReason || 'Procedimento requer atendimento humano.';
  const normalizedReason = normalizeText(reason);
  const targetTeam = availableTeams.find((team) => (
    normalizeText(team.name).length >= 3 &&
    normalizedReason.includes(normalizeText(team.name))
  )) || availableTeams[0] || null;

  if (!targetTeam) {
    return {
      status: 'complete',
      response: 'Nao consegui concluir automaticamente. Sera necessario que a equipe responsavel continue a verificacao.',
      output: {
        skipped: true,
        reason: 'Handoff sem equipe de destino explicita.',
      },
    };
  }

  return {
      status: 'complete',
      response: interpolate(reason, context),
      action: {
        type: 'transfer_chat',
        reason: `Procedure handoff: ${step.label}`,
        payload: { teamId: targetTeam.id },
      },
      replaceResponse: true,
    };
}

export async function advanceProcedure(input: {
  graph: ProcedureGraph;
  context: ProcedureExecutionContext;
  customerMessage: string;
  availableTeams?: Array<{ id: string; name: string }>;
  toolResults?: AgentToolExecutionResult[];
  priorToolResults?: AgentToolExecutionResult[];
  decisionResolver?: ProcedureDecisionResolver;
  responseResolver?: ProcedureResponseResolver;
  knowledgeResolver?: ProcedureKnowledgeResolver;
  forceLlmRespond?: boolean;
}): Promise<ProcedureAdvanceResult> {
  const { graph, context, customerMessage } = input;
  const executedSteps: string[] = [];
  const actions: ProcedureAdvanceResult['actions'] = [];
  let responseText: string | null = null;
  let stepsExecuted = 0;
  let isResuming = context.status === 'waiting_input';

  if (input.toolResults?.length) {
    context.toolResults = context.toolResults || {};
    context.toolResults[context.currentStepId] = input.toolResults;
  }
  if (input.priorToolResults?.length) {
    context.toolResults = context.toolResults || {};
    context.toolResults.__recent = input.priorToolResults;
  }

  context.status = 'running';

  while (stepsExecuted < MAX_STEPS_PER_INVOCATION) {
    const currentStep = findStep(graph, context.currentStepId);
    if (!currentStep) {
      context.status = 'completed';
      context.completedAt = new Date().toISOString();
      break;
    }

    if (hasRepeatedStepWithoutProgress(context, currentStep)) {
      const now = new Date().toISOString();
      context.status = 'completed';
      context.completedAt = now;
      context.stepHistory.push({
        stepId: currentStep.id,
        stepLabel: currentStep.label,
        startedAt: now,
        completedAt: now,
        status: 'skipped',
        output: {
          loopBreaker: true,
          reason: 'A mesma etapa repetiu sem progresso suficiente.',
        },
      });
      await saveProcedureExecution(context);
      return {
        handled: true,
        response: 'Para evitar repetir a mesma etapa sem avancar, vou pausar este procedimento automatico e reavaliar seu pedido pelo caminho correto.',
        actions,
        status: 'completed',
        executedSteps,
        completionReason: 'Loop breaker acionado.',
      };
    }

    stepsExecuted++;
    executedSteps.push(currentStep.id);

    const stepRecord: StepExecutionRecord = {
      stepId: currentStep.id,
      stepLabel: currentStep.label,
      startedAt: new Date().toISOString(),
      status: 'success',
    };

    console.log(
      `[PROCEDURE_RUNTIME] chat=${context.chatId} procedure=${context.procedureName} ` +
      `step=${currentStep.id} type=${currentStep.type} label="${currentStep.label.slice(0, 60)}"`,
    );

    let result: StepResult;
    try {
      switch (currentStep.type) {
        case 'gather_data':
          result = await executeGatherDataStep(
            currentStep,
            customerMessage,
            context,
            isResuming,
            input.responseResolver,
            input.forceLlmRespond
          );
          break;
        case 'tool_call':
          result = executeToolCallStep(currentStep, context, customerMessage);
          break;
        case 'retrieve_knowledge':
          result = await executeRetrieveKnowledgeStep(
            currentStep,
            customerMessage,
            context,
            input.knowledgeResolver
          );
          break;
        case 'validate':
          result = executeValidateStep(currentStep, context);
          break;
        case 'decide':
          result = await executeDecideStep(currentStep, context, customerMessage, input.decisionResolver);
          break;
        case 'respond':
          result = await executeRespondStep(
            currentStep,
            context,
            customerMessage,
            input.responseResolver,
            input.forceLlmRespond
          );
          break;
        case 'handoff':
          result = executeHandoffStep(currentStep, context, input.availableTeams);
          break;
        default:
          result = { status: 'error', error: `Tipo de passo desconhecido: ${(currentStep as ProcedureStep).type}` };
      }
    } catch (error) {
      result = {
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      };
    }

    isResuming = false;

    if (result.slotCollected) {
      Object.assign(context.collectedSlots, result.slotCollected);
      stepRecord.output = {
        ...(typeof stepRecord.output === 'object' && stepRecord.output ? stepRecord.output as Record<string, unknown> : {}),
        slotCollected: result.slotCollected,
      };
    }
    if (result.decision) {
      context.decisions[currentStep.id] = result.decision;
      stepRecord.output = {
        ...(typeof stepRecord.output === 'object' && stepRecord.output ? stepRecord.output as Record<string, unknown> : {}),
        decision: result.decision,
      };
    }
    if (result.output) {
      stepRecord.output = result.output;
    }
    if (result.knowledgeContext) {
      context.knowledgeContext = result.knowledgeContext;
      context.toolResults = context.toolResults || {};
      context.toolResults.__knowledge_context = result.knowledgeContext;
      stepRecord.output = {
        ...(typeof stepRecord.output === 'object' && stepRecord.output ? stepRecord.output as Record<string, unknown> : {}),
        knowledgeContext: result.knowledgeContext,
      };
    }
    if (result.response) {
      responseText = result.replaceResponse
        ? result.response
        : responseText
        ? `${responseText}\n\n${result.response}`
        : result.response;
    }
    if (result.action) {
      actions.push({
        type: result.action.type,
        reason: result.action.reason || currentStep.label,
        payload: result.action.payload || {},
      });
      stepRecord.output = {
        ...(typeof stepRecord.output === 'object' && stepRecord.output ? stepRecord.output as Record<string, unknown> : {}),
        action: result.action.type,
      };
    }

    switch (result.status) {
      case 'pause': {
        stepRecord.status = 'waiting';
        context.status = 'waiting_input';
        context.stepHistory.push(stepRecord);
        if (result.advanceToNextOnPause) {
          const nextStep = findNextStep(graph, currentStep, context);
          if (nextStep) {
            context.currentStepId = nextStep.id;
          }
        }
        await saveProcedureExecution(context);

        return {
          handled: true,
          response: responseText,
          actions,
          status: 'waiting_input',
          executedSteps,
        };
      }

      case 'wait_tool': {
        stepRecord.status = 'waiting_tool';
        context.status = 'waiting_tool';
        context.stepHistory.push(stepRecord);
        await saveProcedureExecution(context);

        return {
          handled: true,
          response: responseText,
          actions,
          status: 'waiting_tool',
          executedSteps,
        };
      }

      case 'error': {
        stepRecord.status = 'error';
        stepRecord.error = result.error;
        stepRecord.completedAt = new Date().toISOString();
        context.stepHistory.push(stepRecord);

        const retries = context.retryCount[currentStep.id] || 0;
        const maxRetries = currentStep.maxRetries ?? 2;

        if (retries < maxRetries) {
          context.retryCount[currentStep.id] = retries + 1;
          context.status = 'running';
          await saveProcedureExecution(context);

          return {
            handled: true,
            response: responseText || 'Houve um problema ao processar. Vou tentar novamente.',
            actions,
            status: 'running',
            executedSteps,
          };
        }

        context.status = 'failed';
        context.completedAt = new Date().toISOString();
        await saveProcedureExecution(context);

        return {
          handled: true,
          response: responseText || 'Nao consegui completar o procedimento automaticamente. Vou encaminhar para a equipe.',
          actions: [
            ...actions,
            {
              type: 'add_internal_note',
              reason: `Procedimento "${context.procedureName}" falhou no passo "${currentStep.label}"`,
              payload: { content: `PRE falhou: ${result.error}` },
            },
          ],
          status: 'failed',
          executedSteps,
          completionReason: result.error,
        };
      }

      case 'complete': {
        stepRecord.completedAt = new Date().toISOString();
        context.stepHistory.push(stepRecord);
        context.status = 'completed';
        context.completedAt = new Date().toISOString();
        await saveProcedureExecution(context);

        return {
          handled: true,
          response: responseText,
          actions,
          status: 'completed',
          executedSteps,
          completionReason: 'Procedimento concluido.',
        };
      }

      case 'continue': {
        stepRecord.completedAt = new Date().toISOString();
        context.stepHistory.push(stepRecord);

        const nextStep = result.nextStepId
          ? findStep(graph, result.nextStepId)
          : findNextStep(graph, currentStep, context);
        if (nextStep) {
          context.currentStepId = nextStep.id;
          break;
        }

        context.status = 'completed';
        context.completedAt = new Date().toISOString();
        await saveProcedureExecution(context);

        return {
          handled: true,
          response: responseText,
          actions,
          status: 'completed',
          executedSteps,
          completionReason: 'Todos os passos concluidos.',
        };
      }
    }
  }

  await saveProcedureExecution(context);

  return {
    handled: true,
    response: responseText,
    actions,
    status: context.status,
    executedSteps,
  };
}
