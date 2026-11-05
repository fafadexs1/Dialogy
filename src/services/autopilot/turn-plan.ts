import type { AgentToolCatalogItem } from '@/services/agent-tools/catalog';
import { fingerprintAuditedToolOperation } from '@/services/agent-tools/action-fingerprint';
import type { AgentToolAction, AgentToolExecutionResult } from '@/services/agent-tools/types';
import type { AutopilotIntentResolution, AutopilotSlotName } from '@/services/autopilot/intent-types';
import type { SlotExtractionResult } from '@/services/autopilot/slots';
import { buildWifiChannelAnalysisResponse } from '@/services/autopilot/wifi-channel-analysis';
import { isConversationCloseRequest } from '@/services/autopilot/close-intent';

export type AutopilotCustomerNeed =
  | 'wifi_credentials_lookup'
  | 'wifi_credentials_change'
  | 'wifi_channel_diagnostics'
  | 'router_reboot'
  | 'order_status_lookup'
  | 'generic_external_lookup'
  | 'generic_external_action'
  | 'external_lookup'
  | 'none';

export type AutopilotTurnExpectedAction =
  | 'ask_slot'
  | 'call_required_tool'
  | 'respond_from_tool_result'
  | 'require_confirmation'
  | 'continue_llm';

export type AutopilotTurnPlan = {
  customerNeed: AutopilotCustomerNeed;
  expectedNextAction: AutopilotTurnExpectedAction;
  requiredToolNames: string[];
  forbiddenToolNames: string[];
  missingSlots: AutopilotSlotName[];
  missingInputFields: Array<{ name: string; label: string }>;
  preResponseActions: AgentToolAction[];
  confirmationAction: AgentToolAction | null;
  responseOverride: string | null;
  reasons: string[];
  metadata: Record<string, unknown>;
};

export function shouldPrioritizeAutopilotTurnPlan(plan: AutopilotTurnPlan): boolean {
  return plan.customerNeed !== 'none' && (
    plan.preResponseActions.length > 0 ||
    Boolean(plan.responseOverride) ||
    plan.requiredToolNames.length > 0 ||
    plan.missingSlots.length > 0 ||
    plan.missingInputFields.length > 0
  );
}

export function isTerminalAutopilotTurnPlan(plan: AutopilotTurnPlan): boolean {
  return Boolean(plan.responseOverride)
    && plan.preResponseActions.length === 0
    && plan.expectedNextAction !== 'call_required_tool'
    && plan.expectedNextAction !== 'respond_from_tool_result';
}

export function hasRequiredAutopilotTurnPlanFailure(
  plan: AutopilotTurnPlan,
  results: AgentToolExecutionResult[],
): boolean {
  const required = new Set(plan.requiredToolNames);
  const hasDiagnosticFallbackSuccess = plan.customerNeed === 'wifi_channel_diagnostics'
    && results.some((result) => (
      result.status === 'success'
      && /\b(scan_wifi_neighbors|get_wifi_scan_cached|wifi_scan|wifi_neighbors)\b/i.test(String(result.toolName))
    ));
  return results.some((result) => {
    const inputToolName = result.input.type === 'mcp_call_tool'
      ? String(result.input.payload?.toolName || result.toolName)
      : result.input.type;
    if (
      hasDiagnosticFallbackSuccess
      && /\b(scan_wifi_neighbors|get_wifi_scan_cached|wifi_scan|wifi_neighbors)\b/i.test(inputToolName)
    ) {
      return false;
    }
    return result.status !== 'success' && (
      required.has(String(result.toolName)) ||
      required.has(inputToolName)
    );
  });
}

export function hasSatisfiedAutopilotTurnPlan(
  plan: AutopilotTurnPlan,
  results: AgentToolExecutionResult[],
): boolean {
  if (plan.requiredToolNames.length === 0) return false;

  return plan.requiredToolNames.every((requiredToolName) => (
    results.some((result) => {
      if (result.status !== 'success') return false;
      const inputToolName = result.input.type === 'mcp_call_tool'
        ? String(result.input.payload?.toolName || result.toolName)
        : result.input.type;
      if (String(result.toolName) === requiredToolName || inputToolName === requiredToolName) {
        return true;
      }
      return (
        plan.customerNeed === 'wifi_channel_diagnostics'
        && /\b(scan_wifi_neighbors|get_wifi_scan_cached|wifi_scan|wifi_neighbors)\b/i.test(requiredToolName)
        && /\b(scan_wifi_neighbors|get_wifi_scan_cached|wifi_scan|wifi_neighbors)\b/i.test(inputToolName)
      );
    })
  ));
}

export function shouldBypassKnowledgeForOperationalTurn(input: {
  customerNeed: AutopilotCustomerNeed;
  enabledToolNames: string[];
  customerMessage?: string;
  chatHistory?: string | null;
  toolCatalog?: AgentToolCatalogItem[];
}): boolean {
  const names = input.enabledToolNames.map((name) => (
    normalizeText(name)
      .replace(/[_:-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  ));
  const has = (patterns: RegExp[]) => names.some((name) => patterns.some((pattern) => pattern.test(name)));

  if (input.customerNeed === 'wifi_credentials_lookup') {
    return has([/\bget wifi view\b/, /\bwifi view\b/, /\brefresh wifi summary\b/]);
  }
  if (input.customerNeed === 'wifi_channel_diagnostics') {
    return has([/\bscan wifi neighbors\b/, /\bget wifi scan cached\b/, /\blist connected devices\b/]);
  }
  if (input.customerNeed === 'wifi_credentials_change') {
    return has([/\bchange wifi credentials\b/, /\bqueue set parameters\b/]);
  }
  if (input.customerNeed === 'router_reboot') {
    return has([/\breboot router\b/, /\brestart router\b/]);
  }
  if (input.customerNeed === 'order_status_lookup') {
    return has([/\bget order status\b/, /\btrack order\b/, /\bget ticket status\b/, /\bget request status\b/]);
  }
  if (input.customerNeed === 'external_lookup') {
    return has([/\bsgp fetch contact panel data\b/, /\bsgp fetch contracts\b/]);
  }
  if (
    input.customerNeed === 'generic_external_lookup' &&
    input.customerMessage &&
    input.toolCatalog
  ) {
    return Boolean(findGenericExternalLookupTool({
      toolCatalog: input.toolCatalog,
      availableToolNames: new Set(input.enabledToolNames),
      customerMessage: input.customerMessage,
      chatHistory: input.chatHistory,
    }));
  }
  if (
    input.customerNeed === 'generic_external_action' &&
    input.customerMessage &&
    input.toolCatalog
  ) {
    return Boolean(findGenericExternalActionTool({
      toolCatalog: input.toolCatalog,
      availableToolNames: new Set(input.enabledToolNames),
      customerMessage: input.customerMessage,
      chatHistory: input.chatHistory,
    }));
  }
  return false;
}

export function isExplicitAutopilotToolRetryRequest(message: string): boolean {
  const normalized = message
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized || normalized.length > 220) return false;

  return (
    /\b(?:tente|tenta|tentem|testa|teste)(?:\s+isso)?\s+(?:de novo|novamente|outra vez|agora)\b/.test(normalized) ||
    /\b(?:pode|consegue|conseguem|vamos)\s+(?:tentar|testar)(?:\s+isso)?\s+(?:de novo|novamente|outra vez|agora)\b/.test(normalized) ||
    /\b(?:repita|repetir|refaca|refazer|reexecute|reexecutar)\s+(?:a\s+)?(?:consulta|acao|operacao|tentativa)\b/.test(normalized)
  );
}

type ContractCandidate = {
  id?: string | number | null;
  ip?: string | null;
  login?: string | null;
  mac?: string | null;
  serial?: string | null;
  connectionStatus?: string | null;
  statusLabel?: string | null;
  addressLabel?: string | null;
};

type WifiFields = {
  ssid?: string | null;
  username?: string | null;
  password?: string | null;
};

type WifiBand = '24' | '5g' | 'both';

type WifiCredentialSchemaField = {
  name: string;
  kind: 'ssid' | 'password';
  band: Exclude<WifiBand, 'both'> | null;
};

type WifiCredentialChangeInputPlan = {
  arguments: Record<string, unknown>;
  requestedSsid: boolean;
  requestedPassword: boolean;
  band: WifiBand;
  missingKinds: Array<'ssid' | 'password' | 'selection'>;
  unsupportedKinds: Array<'ssid' | 'password'>;
  validationError: string | null;
};

const WIFI_LOOKUP_TOOL_PATTERNS = [
  /\bget_wifi_view\b/i,
  /\brefresh_wifi_summary\b/i,
  /\bwifi_view\b/i,
  /\b(?:ssid|senha|password|credential|credencia|usuario|nome da rede)\b/i,
];

const WIFI_CHANGE_TOOL_PATTERNS = [
  /\bchange_wifi_credentials\b/i,
  /\b(update|set|change|alterar|trocar|mudar).*(wifi|ssid|password|senha|credential)\b/i,
];

const WIFI_DIAGNOSTIC_TOOL_PATTERNS = [
  /\b(scan_wifi_neighbors|get_wifi_scan_cached|wifi_scan|wifi_neighbors)\b/i,
  /\b(?:canal|channel|neighbor|vizinh|interferencia|sinal|diagnost)\b/i,
];

const ROUTER_REBOOT_TOOL_PATTERNS = [
  /\b(reboot_router|restart_router|reboot|reiniciar|reinicia)\b/i,
];

const ORDER_STATUS_TOOL_PATTERNS = [
  /\b(get_order_status|order_status|tracking|track_order|shipment_status|get_ticket_status|get_request_status)\b/i,
  /\b(status|rastre|tracking|pedido|order|protocolo|solicitacao|solicitacao|ticket|chamado|entrega|shipment)\b/i,
];

const GENERIC_EXTERNAL_ACTION_PATTERNS = [
  /\b(create|book|schedule|reserve|appointment|agenda|agendamento|agendar|marcar|reservar|contratar|comprar|pedido)\b/i,
  /\b(update|change|edit|reschedule|alterar|atualizar|trocar|mudar|remarcar)\b/i,
  /\b(cancel|delete|remove|terminate|cancelar|excluir|remover|encerrar)\b/i,
  /\b(refund|return|reverse|estornar|reembolsar|devolver|reembolso)\b/i,
  /\b(send|issue|generate|apply|submit|enviar|emitir|gerar|aplicar|solicitar)\b/i,
];

const DESTRUCTIVE_TOOL_PATTERNS = [
  /\b(create|update|delete|cancel|refund|charge|close|transfer|reboot|restart|change|alterar|trocar|cancelar|estornar|cobrar)\b/i,
];

function normalizeText(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function onlyDigits(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '');
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function actionToolName(action: AgentToolAction): string {
  return action.type === 'mcp_call_tool'
    ? String(action.payload?.toolName || '')
    : action.type;
}

function catalogSearchText(tool: AgentToolCatalogItem): string {
  return [
    tool.name,
    tool.description,
    tool.serverName,
    tool.serverId,
    JSON.stringify(tool.inputSchema || {}),
    JSON.stringify(tool.outputSchema || {}),
  ].filter(Boolean).join(' ');
}

function asksGenericExternalLookupText(text: string): boolean {
  return (
    /\b(catalogo|catalogo|cardapio|cardapio|produtos?|servicos?|servicos?|planos?|menu)\b/.test(text) ||
    /\b(preco|preco|valor|cotacao|cotacao|orcamento|orcamento|quanto custa|mensalidade)\b/.test(text) ||
    /\b(disponibilidade|disponivel|estoque|tem vaga|tem horario|agenda|agendar|marcar|remarcar|visita)\b/.test(text) ||
    /\bconsulta\s+(medica|tecnica|presencial|online|veterinaria|odontologica|disponivel|agendada)\b/.test(text) ||
    /\b(documento|contrato|comprovante|nota fiscal|declaracao|declaracao)\b/.test(text)
  );
}

function asksGenericExternalActionText(text: string): boolean {
  const asksHow = /\b(como|onde|qual(?: e| seria)?|quais|posso|e possivel|informacao|politica|regras?)\b.{0,36}\b(agendar|marcar|cancelar|alterar|trocar|devolver|reembolsar|contratar|comprar)\b/.test(text);
  if (asksHow) return false;

  return (
    /\b(quero|preciso|pode|favor|vamos|gostaria de|desejo)\b.{0,48}\b(agendar|marcar|reservar|remarcar|cancelar|alterar|atualizar|trocar|mudar|estornar|reembolsar|devolver|enviar|emitir|gerar|finalizar\s+(?:compra|pedido)|fechar\s+(?:compra|pedido)|criar\s+pedido|fazer\s+checkout)\b/.test(text) ||
    /\b(agende|marque|reserve|remarque|cancele|altere|atualize|troque|mude|estorne|reembolse|devolva|envie|emita|gere)\b/.test(text) ||
    /\b(finalize|feche|crie|registre)\b.{0,24}\b(compra|pedido|checkout)\b/.test(text)
  );
}

function isCommercialPurchaseFlowText(customerMessage: string, chatHistory?: string | null): boolean {
  const text = normalizeText(customerMessage);
  if (!text) return false;
  if (/\b(consultar|verificar|checar|buscar|status|pedido|protocolo|agendar|marcar|remarcar|cancelar|alterar|trocar|mudar|reembolsar|estornar|emitir|gerar|enviar|reiniciar|reboot|senha|ssid|wifi|wi fi)\b/.test(text)) {
    return false;
  }

  const context = normalizeText([chatHistory || '', customerMessage].join('\n'));
  const hasCommercialContext = /\b(planos?|pacote|internet|fibra|mega|contratar|assinar|comprar|adquirir|mensalidade|instalacao)\b/.test(context);
  const explicitInterest = (
    /\b(quero|queria|gostaria|tenho interesse|interesse|desejo|preciso|vou|vamos|podemos|pode)\b.{0,80}\b(contratar|assinar|comprar|adquirir|fechar|seguir|internet|fibra|plano|pacote|mega|servico)\b/.test(text) ||
    /\b(contratar|assinar|comprar|adquirir)\b/.test(text)
  );
  const selectedCommercialOption = hasCommercialContext && (
    /\b(?:esse|este|essa|esta|o)\b.{0,48}\b(?:mesmo|perfeito|bom|serve|pra mim|para mim|pode ser)\b/.test(text) ||
    (/\b\d{2,4}\s*mega\b/.test(text) && /\b(esse|este|quero|perfeito|bom|serve|fechar|seguir|pode ser)\b/.test(text))
  );

  return explicitInterest || selectedCommercialOption;
}

function inferNeedFromText(textValue: string): AutopilotCustomerNeed {
  const text = normalizeText(textValue);
  const mentionsWifi = /\b(wifi|wi fi|wi-fi|ssid|roteador|router|rede|internet)\b/.test(text);
  const asksCredentials = /\b(usuario|login|senha|password|credencia|ssid|nome da rede|esqueci|acesso)\b/.test(text);
  const asksChange = /\b(trocar|mudar|alterar|atualizar|change|update|nova senha|novo nome|novo ssid)\b/.test(text);
  const asksDiagnostic = /\b(lento|travando|oscilando|instavel|canais?|channels?|interferencia|redes ao redor|redes proximas|vizinh|sinal|diagnost)\b/.test(text);
  const asksReboot = /\b(reiniciar|reinicia|reboot|restart|resetar|desligar e ligar)\b/.test(text);
  const asksOrderStatus = (
    /\b(status|rastre|rastrear|acompanhar|andamento|previsao|previsao de entrega|onde esta|cad[eê])\b/.test(text) &&
    /\b(pedido|order|compra|entrega|protocolo|solicitacao|solicitação|ticket|chamado)\b/.test(text)
  ) || /\b(?:pedido|protocolo|solicitacao|solicitação|ticket|chamado)\b\s*#?\s*[a-z0-9-]{4,}\b/i.test(text);

  if (mentionsWifi && asksChange) return 'wifi_credentials_change';
  if (mentionsWifi && asksCredentials) return 'wifi_credentials_lookup';
  if (mentionsWifi && asksDiagnostic) return 'wifi_channel_diagnostics';
  if (asksReboot) return 'router_reboot';
  if (asksGenericExternalActionText(text)) return 'generic_external_action';
  if (asksOrderStatus) return 'order_status_lookup';
  if (asksGenericExternalLookupText(text)) return 'generic_external_lookup';
  if (
    /\b(consultar|verificar|checar|sistema|cadastro|contrato|fatura|boleto|pix|segunda via|2a via|pagamento|status|protocolo)\b/.test(text) ||
    /\b(sem acesso|sem internet|internet caiu|nao conecta|nao funciona|conexao caiu|financeiro|mensalidade|vencimento)\b/.test(text)
  ) {
    return 'external_lookup';
  }
  return 'none';
}

function isLikelyContinuationMessage(customerMessage: string): boolean {
  const text = normalizeText(customerMessage);
  if (!text) return false;
  const plainText = text.replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();
  if (
    /^(?:oi+e?|ola|bom dia|boa tarde|boa noite|hey|fala ai(?: galera)?|salve)(?: tudo bem)?$/.test(plainText) ||
    /^(?:obrigad[oa]|muito obrigad[oa]|valeu|agradeco|grato|grata)$/.test(plainText)
  ) {
    return false;
  }
  const digits = onlyDigits(text);
  if (digits.length === 11 || digits.length === 14) return true;
  if (/\b(cpf|cnpj|documento|titular)\b/.test(text) && digits.length >= 6) return true;
  if (/^(sim|ok|pode|isso|esse|este|manda|segue|claro|confirmo)\b/.test(text) && text.length <= 80) return true;
  if (/\b[a-z][a-z0-9_-]{1,48}\s*[:=]\s*\S+/i.test(customerMessage) && customerMessage.length <= 500) return true;
  return text.length <= 30 && !/\b(wifi|wi fi|wi-fi|boleto|fatura|plano|cancel|troca|senha|canal|reboot)\b/.test(text);
}

export function inferAutopilotCustomerNeed(customerMessage: string, chatHistory?: string | null): AutopilotCustomerNeed {
  const currentNeed = inferNeedFromText(customerMessage);
  if (currentNeed !== 'none' || !chatHistory || !isLikelyContinuationMessage(customerMessage)) {
    return currentNeed;
  }

  const recentHistory = chatHistory
    .split('\n')
    .slice(-12)
    .join('\n');
  const historicalNeed = inferNeedFromText(recentHistory);
  return historicalNeed === 'none' ? currentNeed : historicalNeed;
}

function isToolAvailable(toolName: string, names: Set<string>): boolean {
  return names.has(toolName);
}

function findToolByPatterns(input: {
  toolCatalog: AgentToolCatalogItem[];
  availableToolNames: Set<string>;
  include: RegExp[];
  exclude?: RegExp[];
}): AgentToolCatalogItem | null {
  const candidates = input.toolCatalog
    .filter((tool) => isToolAvailable(String(tool.name), input.availableToolNames))
    .map((tool) => ({
      tool,
      text: catalogSearchText(tool),
    }))
    .filter(({ text }) => input.include.some((pattern) => pattern.test(text)))
    .filter(({ text }) => !(input.exclude || []).some((pattern) => pattern.test(text)))
    .map(({ tool, text }) => {
      const name = String(tool.name);
      let score = 0;
      if (name.startsWith('mcp:')) score += 4;
      if (/\bget_wifi_view\b/i.test(name)) score += 10;
      if (/\brefresh_wifi_summary\b/i.test(name)) score += 8;
      if (/\bscan_wifi_neighbors|get_wifi_scan_cached\b/i.test(name)) score += 8;
      if (tool.sideEffect === 'none') score += 3;
      if (tool.riskLevel === 'low') score += 2;
      if (/\b(read|consulta|visualiza|view|summary|scan)\b/i.test(text)) score += 1;
      return { tool, score };
    })
    .sort((left, right) => right.score - left.score);

  return candidates[0]?.tool || null;
}

function isReadOnlyExternalTool(tool: AgentToolCatalogItem): boolean {
  return (
    tool.sideEffect === 'none' &&
    !tool.requiresHumanApproval &&
    (tool.source === 'mcp' || tool.class === 'read_only' || tool.class === 'retrieval')
  );
}

function keywordOverlapScore(leftText: string, rightText: string): number {
  const ignored = new Set(['para', 'como', 'quando', 'onde', 'qual', 'quais', 'quero', 'preciso', 'pode', 'cliente', 'sistema', 'dados']);
  const tokens = [...new Set(rightText.match(/[a-z0-9_]{4,}/g) || [])].filter((token) => !ignored.has(token));
  return Math.min(6, tokens.filter((token) => leftText.includes(token)).length);
}

type GenericLookupCategory = 'catalog' | 'price' | 'availability' | 'schedule' | 'document';

function genericLookupCategories(textValue: string): Set<GenericLookupCategory> {
  const text = normalizeText(textValue).replace(/[_-]+/g, ' ');
  const categories = new Set<GenericLookupCategory>();
  if (/\b(catalogs?|catalogos?|products?|produtos?|services?|servicos?|plans?|planos?|menus?|list products)\b/.test(text)) categories.add('catalog');
  if (/\b(prices?|pricing|precos?|valores?|quotes?|cotacoes?|orcamentos?|mensalidades?)\b/.test(text)) categories.add('price');
  if (/\b(availability|available|disponibilidade|disponiveis?|stocks?|estoques?|slots?|vagas?)\b/.test(text)) categories.add('availability');
  if (/\b(schedules?|agendar|agenda|calendar|calendars?|appointments?|consultas?|visitas?|horarios?)\b/.test(text)) categories.add('schedule');
  if (/\b(documents?|documentos?|contracts?|contratos?|invoices?|comprovantes?|notas? fiscais?|declaracoes?)\b/.test(text)) categories.add('document');
  return categories;
}

function genericLookupToolScore(tool: AgentToolCatalogItem, requestText: string): number {
  if (!isReadOnlyExternalTool(tool)) return 0;
  if (tool.name === 'sgp_fetch_contact_panel_data' || tool.name === 'sgp_fetch_contracts') return 0;
  const text = normalizeText(catalogSearchText(tool));
  if (DESTRUCTIVE_TOOL_PATTERNS.some((pattern) => pattern.test(text))) return 0;

  const requestCategories = genericLookupCategories(requestText);
  const toolCategories = genericLookupCategories(text);
  const matchingCategories = [...requestCategories].filter((category) => toolCategories.has(category));
  if (matchingCategories.length === 0) return 0;

  let score = 8 + matchingCategories.length * 6;
  if (tool.name.startsWith('mcp:')) score += 3;
  score += keywordOverlapScore(text, requestText);
  return score;
}

function findGenericExternalLookupTool(input: {
  toolCatalog: AgentToolCatalogItem[];
  availableToolNames: Set<string>;
  customerMessage: string;
  chatHistory?: string | null;
}): AgentToolCatalogItem | null {
  const requestText = normalizeText([
    input.chatHistory || '',
    input.customerMessage,
  ].join('\n'));
  const candidates = input.toolCatalog
    .filter((tool) => isToolAvailable(String(tool.name), input.availableToolNames))
    .map((tool) => ({ tool, score: genericLookupToolScore(tool, requestText) }))
    .filter((candidate) => candidate.score >= 5)
    .sort((left, right) => right.score - left.score || String(left.tool.name).localeCompare(String(right.tool.name)));
  return candidates[0]?.tool || null;
}

type GenericActionCategory =
  | 'schedule'
  | 'cancel'
  | 'refund'
  | 'change'
  | 'purchase'
  | 'document'
  | 'support';

function genericActionCategories(textValue: string): Set<GenericActionCategory> {
  const text = normalizeText(textValue).replace(/[_-]+/g, ' ');
  const categories = new Set<GenericActionCategory>();
  if (/\b(book|schedule|reserve|appointment|agendar|marcar|reservar|remarcar|agenda)\b/.test(text)) categories.add('schedule');
  if (/\b(cancel|delete|remove|terminate|cancelar|excluir|remover|encerrar)\b/.test(text)) categories.add('cancel');
  if (/\b(refund|return|reverse|estornar|reembolsar|devolver|reembolso)\b/.test(text)) categories.add('refund');
  if (/\b(update|change|edit|alterar|atualizar|trocar|mudar)\b/.test(text)) categories.add('change');
  if (/\b(create_order|place_order|purchase|buy|checkout|comprar|contratar|pedido)\b/.test(text)) categories.add('purchase');
  if (/\b(send|issue|generate|document|invoice|receipt|enviar|emitir|gerar|documento|comprovante)\b/.test(text)) categories.add('document');
  if (/\b(reboot|restart|reset|open_ticket|reiniciar|resetar|chamado)\b/.test(text)) categories.add('support');
  return categories;
}

function genericActionIntentCategory(intent?: AutopilotIntentResolution['intent'] | null): GenericActionCategory | null {
  if (intent === 'scheduling_request') return 'schedule';
  if (intent === 'cancellation_request') return 'cancel';
  if (intent === 'return_or_refund') return 'refund';
  if (intent === 'change_request') return 'change';
  if (intent === 'purchase_inquiry') return 'purchase';
  if (intent === 'document_request') return 'document';
  if (intent === 'support_request' || intent === 'troubleshooting') return 'support';
  return null;
}

function genericActionToolScore(input: {
  tool: AgentToolCatalogItem;
  requestText: string;
  intent?: AutopilotIntentResolution['intent'] | null;
}): number {
  const { tool, requestText } = input;
  if (tool.source !== 'mcp' || tool.sideEffect === 'none') return 0;
  const toolText = normalizeText(catalogSearchText(tool));
  const semanticToolText = toolText.replace(/[_-]+/g, ' ');
  if (!GENERIC_EXTERNAL_ACTION_PATTERNS.some((pattern) => pattern.test(semanticToolText))) return 0;

  const requestCategories = genericActionCategories(requestText);
  const intentCategory = genericActionIntentCategory(input.intent);
  if (intentCategory) requestCategories.add(intentCategory);
  const toolCategories = genericActionCategories(toolText);
  const categoryMatches = [...requestCategories].filter((category) => toolCategories.has(category));
  if (categoryMatches.length === 0) return 0;

  let score = 8 + categoryMatches.length * 6;
  score += keywordOverlapScore(toolText, requestText);
  if (tool.name.startsWith('mcp:')) score += 3;
  if (tool.inputSchema && Object.keys(getSchemaProperties(tool)).length > 0) score += 2;
  if (tool.idempotent) score += 1;
  if (tool.riskLevel === 'high' || tool.sideEffect === 'high') score -= 1;
  return score;
}

function findGenericExternalActionTool(input: {
  toolCatalog: AgentToolCatalogItem[];
  availableToolNames: Set<string>;
  customerMessage: string;
  chatHistory?: string | null;
  intent?: AutopilotIntentResolution['intent'] | null;
}): AgentToolCatalogItem | null {
  const requestText = normalizeText(
    input.chatHistory && isLikelyContinuationMessage(input.customerMessage)
      ? `${input.chatHistory}\n${input.customerMessage}`
      : input.customerMessage,
  );
  const candidates = input.toolCatalog
    .filter((tool) => isToolAvailable(String(tool.name), input.availableToolNames))
    .map((tool) => ({
      tool,
      score: genericActionToolScore({
        tool,
        requestText,
        intent: input.intent,
      }),
    }))
    .filter((candidate) => candidate.score >= 12)
    .sort((left, right) => right.score - left.score || String(left.tool.name).localeCompare(String(right.tool.name)));
  return candidates[0]?.tool || null;
}

function latestToolResult(results: AgentToolExecutionResult[], toolName: string): AgentToolExecutionResult | null {
  for (let index = results.length - 1; index >= 0; index -= 1) {
    const result = results[index];
    if (result.toolName === toolName || actionToolName(result.input) === toolName) return result;
  }
  return null;
}

function comparableToolValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(comparableToolValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, nested]) => nested !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, comparableToolValue(nested)]),
    );
  }
  return typeof value === 'string' ? value.trim().toLowerCase() : value;
}

function toolActionArguments(action: AgentToolAction): Record<string, unknown> {
  if (action.type === 'mcp_call_tool') {
    const args = action.payload?.arguments;
    return args && typeof args === 'object' && !Array.isArray(args)
      ? args as Record<string, unknown>
      : {};
  }
  const payload = action.payload;
  return payload && typeof payload === 'object' && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : {};
}

function toolResultMatchesArguments(
  result: AgentToolExecutionResult,
  expectedArguments: Record<string, unknown>,
): boolean {
  const actualArguments = toolActionArguments(result.input);
  return JSON.stringify(comparableToolValue(actualArguments))
    === JSON.stringify(comparableToolValue(expectedArguments));
}

function latestToolResultForArguments(
  results: AgentToolExecutionResult[],
  toolName: string,
  expectedArguments?: Record<string, unknown>,
): AgentToolExecutionResult | null {
  for (let index = results.length - 1; index >= 0; index -= 1) {
    const result = results[index];
    if (result.toolName !== toolName && actionToolName(result.input) !== toolName) continue;
    if (expectedArguments && !toolResultMatchesArguments(result, expectedArguments)) continue;
    return result;
  }
  return null;
}

function latestToolArguments(
  results: AgentToolExecutionResult[],
  toolName: string,
): Record<string, unknown> | null {
  const latest = latestToolResult(results, toolName);
  return latest ? toolActionArguments(latest.input) : null;
}

function hasSuccessfulTool(
  results: AgentToolExecutionResult[],
  toolName: string,
  expectedArguments?: Record<string, unknown>,
): boolean {
  return latestToolResultForArguments(results, toolName, expectedArguments)?.status === 'success';
}

function hasFailedTool(
  results: AgentToolExecutionResult[],
  toolName: string,
  expectedArguments?: Record<string, unknown>,
): boolean {
  const latest = latestToolResultForArguments(results, toolName, expectedArguments);
  return Boolean(latest && latest.status !== 'success');
}

function latestFailedRetryContext(input: {
  recentToolResults: AgentToolExecutionResult[];
  executableNames: Set<string>;
  toolCatalog: AgentToolCatalogItem[];
}): { tool: AgentToolCatalogItem; result: AgentToolExecutionResult } | null {
  for (let index = input.recentToolResults.length - 1; index >= 0; index -= 1) {
    const result = input.recentToolResults[index];
    if (result.status !== 'error') continue;
    const toolName = actionToolName(result.input) || String(result.toolName);
    if (!input.executableNames.has(toolName)) continue;
    const tool = input.toolCatalog.find((candidate) => String(candidate.name) === toolName);
    if (tool) return { tool, result };
  }
  return null;
}

function inferRetryCustomerNeed(tool: AgentToolCatalogItem | null): AutopilotCustomerNeed {
  if (!tool) return 'none';
  const toolName = String(tool.name);
  const text = catalogSearchText(tool);
  if (toolName === 'sgp_fetch_contact_panel_data' || toolName === 'sgp_fetch_contracts') {
    return 'external_lookup';
  }
  if (WIFI_CHANGE_TOOL_PATTERNS.some((pattern) => pattern.test(text))) {
    return 'wifi_credentials_change';
  }
  if (ROUTER_REBOOT_TOOL_PATTERNS.some((pattern) => pattern.test(text))) {
    return 'router_reboot';
  }
  if (WIFI_DIAGNOSTIC_TOOL_PATTERNS.some((pattern) => pattern.test(text))) {
    return 'wifi_channel_diagnostics';
  }
  if (WIFI_LOOKUP_TOOL_PATTERNS.some((pattern) => pattern.test(text))) {
    return 'wifi_credentials_lookup';
  }
  if (ORDER_STATUS_TOOL_PATTERNS.some((pattern) => pattern.test(text))) {
    return 'order_status_lookup';
  }
  if (tool.source === 'mcp' && tool.sideEffect !== 'none') {
    return 'generic_external_action';
  }
  if (tool.source === 'mcp' || tool.class === 'read_only' || tool.class === 'retrieval') {
    return 'generic_external_lookup';
  }
  return 'none';
}

function buildRecentFailureResponse(toolName: string): string {
  if (toolName === 'sgp_fetch_contact_panel_data' || toolName === 'sgp_fetch_contracts') {
    return 'Nao consegui concluir a consulta no sistema agora. Para evitar te passar uma informacao errada, sera necessario verificar manualmente.';
  }
  if (toolName.startsWith('mcp:')) {
    return 'Nao consegui concluir a consulta tecnica automaticamente agora. Para evitar te passar uma informacao errada, sera necessario verificar manualmente.';
  }
  return 'Nao consegui concluir a consulta automatica agora. Sera necessario verificar manualmente.';
}

function labelSlot(slot: AutopilotSlotName): string {
  const labels: Partial<Record<AutopilotSlotName, string>> = {
    customer_identifier: 'CPF/CNPJ ou identificador cadastrado',
    date: 'data',
    time: 'horario',
    location: 'localidade',
    address: 'endereco',
    name: 'nome',
    phone: 'telefone',
    email: 'e-mail',
    product_or_service_preference: 'produto ou servico desejado',
    order_or_request_id: 'numero do pedido, protocolo ou solicitacao',
    invoice_or_payment_id: 'numero da fatura ou cobranca',
    quantity: 'quantidade',
  };
  return labels[slot] || slot;
}

function buildMissingSlotsResponse(slots: AutopilotSlotName[]): string {
  const labels = unique(slots).map((slot) => labelSlot(slot as AutopilotSlotName));
  if (labels.length === 0) return 'Para consultar corretamente, me informe os dados que faltam.';
  if (labels.length === 1) return `Para consultar corretamente, me informe ${labels[0]}.`;
  return `Para consultar corretamente, me informe ${labels.slice(0, -1).join(', ')} e ${labels[labels.length - 1]}.`;
}

function outputCustomerIdentifier(output: unknown): string {
  const record = output && typeof output === 'object' ? output as Record<string, unknown> : {};
  return onlyDigits(
    record.cpfCnpj ||
    record.cpf_cnpj ||
    record.customerIdentifier ||
    record.document ||
    record.documento ||
    ''
  );
}

function inputCustomerIdentifier(result: AgentToolExecutionResult): string {
  if (result.input.type !== 'sgp_fetch_contact_panel_data') return '';
  return onlyDigits(result.input.payload?.customerIdentifier);
}

function inputOperationFingerprint(result: AgentToolExecutionResult): string {
  return String(
    (result.input as AgentToolAction & { operationFingerprint?: string }).operationFingerprint || '',
  );
}

function latestSgpPanelResult(results: AgentToolExecutionResult[], customerIdentifier?: string | null): AgentToolExecutionResult | null {
  const expectedIdentifier = onlyDigits(customerIdentifier);
  const expectedFingerprint = expectedIdentifier
    ? fingerprintAuditedToolOperation({
        type: 'sgp_fetch_contact_panel_data',
        payload: { customerIdentifier: expectedIdentifier },
      })
    : '';
  for (let index = results.length - 1; index >= 0; index -= 1) {
    const result = results[index];
    const outputIdentifier = outputCustomerIdentifier(result.output);
    const requestedIdentifier = inputCustomerIdentifier(result);
    const operationFingerprint = inputOperationFingerprint(result);
    if (
      result.toolName === 'sgp_fetch_contact_panel_data' &&
      result.status === 'success' &&
      result.output &&
      (
        !expectedIdentifier
        || outputIdentifier === expectedIdentifier
        || requestedIdentifier === expectedIdentifier
        || operationFingerprint === expectedFingerprint
      )
    ) {
      return result;
    }
  }
  return null;
}

function contractsFromSgpResult(result: AgentToolExecutionResult | null): ContractCandidate[] {
  const contracts = (result?.output as any)?.contracts;
  return Array.isArray(contracts) ? contracts : [];
}

function requestedContractId(customerMessage: string): string | null {
  const matches = [...customerMessage.matchAll(/\bcontrato\b\D{0,20}(\d+)\b/gi)];
  return matches.at(-1)?.[1] || null;
}

function requestedContractIsMissing(
  results: AgentToolExecutionResult[],
  customerMessage: string,
  customerIdentifier?: string | null,
): boolean {
  const requested = requestedContractId(customerMessage);
  if (!requested) return false;
  const contracts = contractsFromSgpResult(latestSgpPanelResult(results, customerIdentifier));
  return !contracts.some((contract) => String(contract.id || '').trim() === requested);
}

function selectContractWithIp(
  results: AgentToolExecutionResult[],
  customerMessage: string,
  customerIdentifier?: string | null
): ContractCandidate | null {
  const contracts = contractsFromSgpResult(latestSgpPanelResult(results, customerIdentifier));
  if (contracts.length === 0) return null;

  const requestedContract = requestedContractId(customerMessage);
  if (requestedContract) {
    const focused = contracts.find((contract) => String(contract.id || '').trim() === requestedContract && contract.ip);
    return focused || null;
  }

  return contracts.find((contract) => contract.ip && /online/i.test(String(contract.connectionStatus || contract.statusLabel || ''))) ||
    contracts.find((contract) => contract.ip) ||
    null;
}

function getSchemaProperties(tool: AgentToolCatalogItem | null): Record<string, unknown> {
  const schema = tool?.inputSchema as any;
  const props = schema?.properties;
  return props && typeof props === 'object' && !Array.isArray(props) ? props : {};
}

function buildMcpArgumentsForContract(tool: AgentToolCatalogItem | null, contract: ContractCandidate): Record<string, unknown> {
  const ip = String(contract.ip || '').trim();
  const login = String(contract.login || '').trim();
  const mac = String(contract.mac || '').trim();
  const serial = String(contract.serial || '').trim();
  const contractId = String(contract.id || '').trim();
  const props = getSchemaProperties(tool);
  const propNames = Object.keys(props);
  if (propNames.length === 0) {
    return ip ? { client_ip: ip } : {};
  }

  const args: Record<string, unknown> = {};
  for (const propName of propNames) {
    const normalized = normalizeText(propName);
    if (ip && /\b(client_ip|clientip|ip|ipv4|host|router_ip|routerip|ip_cliente)\b/.test(normalized)) {
      args[propName] = ip;
      continue;
    }
    if (contractId && /\b(contract_id|contractid|contrato|id_contrato)\b/.test(normalized)) {
      args[propName] = contractId;
      continue;
    }
    if (login && /\b(client_login|login|username|pppoe_login|user)\b/.test(normalized)) {
      args[propName] = login;
      continue;
    }
    if (mac && /\b(client_mac|mac|mac_address|macaddress)\b/.test(normalized)) {
      args[propName] = mac;
      continue;
    }
    if (serial && /\b(device_id|serial|serial_number|serialnumber)\b/.test(normalized)) {
      args[propName] = serial;
    }
  }

  if (Object.keys(args).length === 0 && ip) args.client_ip = ip;
  if (/\bmcp:[^:]+:(?:get_wifi_view|get_router|find_router_by_ip|scan_wifi_neighbors|get_wifi_scan_cached)\b/i.test(String(tool?.name || ''))) {
    if (login && !args.client_login) args.client_login = login;
    if (mac && !args.client_mac) args.client_mac = mac;
    if (serial && !args.device_id) args.device_id = serial;
  }
  return args;
}

function recentCustomerRequestContext(customerMessage: string, chatHistory?: string | null): string {
  const historyLines = String(chatHistory || '').split('\n').slice(-20);
  const customerLines = historyLines
    .filter((line) => /^\s*(?:cliente|customer|usuario|user)\s*:/i.test(line))
    .map((line) => line.replace(/^\s*[^:]+:\s*/, ''));
  const relevantHistory = customerLines.length > 0 ? customerLines : historyLines.slice(-8);
  return [...relevantHistory, customerMessage].filter(Boolean).join('\n');
}

function classifyWifiCredentialSchemaField(
  tool: AgentToolCatalogItem | null,
  propName: string,
): WifiCredentialSchemaField | null {
  const property = getSchemaProperties(tool)[propName] as Record<string, unknown> | undefined;
  const normalizedName = normalizeText(propName).replace(/[-\s.]+/g, '_');
  const description = normalizeText([
    property?.title,
    property?.description,
  ].filter(Boolean).join(' '));
  const combined = `${normalizedName} ${description}`;
  const isAdminCredential = (
    /\b(interface|admin|administrador|management|gerencia|login)\b/.test(description)
    && !/\b(wifi|wi fi|ssid|rede 2|rede 5)\b/.test(description)
  );

  let kind: WifiCredentialSchemaField['kind'] | null = null;
  if (
    /(?:^|_)ssid(?:_|$)/.test(normalizedName)
    || /\bnovo ssid\b|\bnome (?:da )?rede\b/.test(description)
  ) {
    kind = 'ssid';
  } else if (
    !isAdminCredential
    && (
      /(?:^|_)(?:wifi_)?(?:password|passphrase|psk)(?:_|$)/.test(normalizedName)
      || /\bnova senha\b.*\b(?:wifi|rede)\b|\bsenha\b.*\brede (?:2|5)\b/.test(description)
    )
    && normalizedName !== 'password'
  ) {
    kind = 'password';
  }
  if (!kind) return null;

  const band: WifiCredentialSchemaField['band'] = (
    /(?:^|_)(?:24|2_4|2g)(?:_|$)/.test(normalizedName)
    || /\b2[.,]4\s*(?:g|ghz)?\b|\b2g\b/.test(description)
  )
    ? '24'
    : (
      /(?:^|_)(?:5g|5)(?:_|$)/.test(normalizedName)
      || /\b5\s*(?:g|ghz)\b/.test(description)
    )
      ? '5g'
      : null;
  return { name: propName, kind, band };
}

function isAdministrativeCredentialSchemaProperty(
  tool: AgentToolCatalogItem | null,
  propName: string,
): boolean {
  const property = getSchemaProperties(tool)[propName] as Record<string, unknown> | undefined;
  const normalizedName = normalizeText(propName).replace(/[-\s.]+/g, '_');
  const description = normalizeText([
    property?.title,
    property?.description,
  ].filter(Boolean).join(' '));
  return (
    ['username', 'password', 'admin_username', 'admin_password', 'router_username', 'router_password'].includes(normalizedName)
    || (
      /\b(interface|admin|administrador|management|gerencia|login)\b/.test(description)
      && !/\b(wifi|wi fi|ssid|rede 2|rede 5)\b/.test(description)
    )
  );
}

function detectWifiBand(textValue: string): WifiBand {
  const text = normalizeText(textValue);
  const has24 = /\b2[.,]4\s*(?:g|ghz)?\b|\b2g\b|_(?:24|2_4|2g)(?:_|$)/.test(text);
  const has5g = /\b5\s*(?:g|ghz)\b|_(?:5g|5)(?:_|$)/.test(text);
  if (has24 && !has5g) return '24';
  if (has5g && !has24) return '5g';
  return 'both';
}

function extractLabeledWifiChangeValue(
  customerMessage: string,
  kind: 'ssid' | 'password',
): string | null {
  const labels = kind === 'password'
    ? [
      'nova\\s+senha(?:\\s+(?:do|da)\\s+(?:wi-?fi|rede))?',
      'senha\\s+nova',
      'senha\\s+(?:do|da)\\s+(?:wi-?fi|rede)',
      'wifi\\s+password',
      'new\\s+password',
    ]
    : [
      'novo\\s+(?:ssid|nome\\s+da\\s+rede|nome\\s+do\\s+wi-?fi)',
      'ssid\\s+novo',
      'nome\\s+da\\s+rede',
      'nome\\s+do\\s+wi-?fi',
      'new\\s+ssid',
    ];
  const match = customerMessage.match(
    new RegExp(`(?:^|[;\\n,])\\s*(?:${labels.join('|')})\\s*[:=]\\s*([^;\\n,]+)`, 'i'),
  );
  return match?.[1]?.trim().replace(/^["']|["']$/g, '') || null;
}

function selectWifiCredentialFields(
  fields: WifiCredentialSchemaField[],
  kind: WifiCredentialSchemaField['kind'],
  band: WifiBand,
): WifiCredentialSchemaField[] {
  const matchingKind = fields.filter((field) => field.kind === kind);
  const generic = matchingKind.filter((field) => field.band == null);
  if (band === 'both') {
    return generic.length > 0 ? generic : matchingKind;
  }
  const specific = matchingKind.filter((field) => field.band === band);
  return specific.length > 0 ? specific : generic;
}

function validateWifiCredentialChangeValue(kind: 'ssid' | 'password', value: string): string | null {
  if (kind === 'password') {
    const validLength = value.length >= 8 && value.length <= 63;
    const validHexPsk = value.length === 64 && /^[a-f0-9]+$/i.test(value);
    return validLength || validHexPsk
      ? null
      : 'A nova senha do Wi-Fi precisa ter entre 8 e 63 caracteres, ou ser uma chave hexadecimal de 64 caracteres.';
  }
  const byteLength = new TextEncoder().encode(value).length;
  return byteLength >= 1 && byteLength <= 32
    ? null
    : 'O novo nome da rede precisa ter entre 1 e 32 bytes.';
}

function buildWifiCredentialChangeInputPlan(input: {
  tool: AgentToolCatalogItem | null;
  customerMessage: string;
  chatHistory?: string | null;
}): WifiCredentialChangeInputPlan {
  const fields = Object.keys(getSchemaProperties(input.tool))
    .map((propName) => classifyWifiCredentialSchemaField(input.tool, propName))
    .filter((field): field is WifiCredentialSchemaField => Boolean(field));
  const requestContext = recentCustomerRequestContext(input.customerMessage, input.chatHistory);
  const normalizedContext = normalizeText(requestContext);
  const directValues = new Map<string, string>();
  for (const field of fields) {
    const directValue = extractNamedSchemaArgument({
      tool: input.tool,
      propName: field.name,
      customerMessage: input.customerMessage,
    });
    if (typeof directValue === 'string' && directValue.trim()) {
      directValues.set(field.name, directValue.trim());
    }
  }

  const directPasswordFields = fields.filter((field) => (
    field.kind === 'password' && directValues.has(field.name)
  ));
  const directSsidFields = fields.filter((field) => (
    field.kind === 'ssid' && directValues.has(field.name)
  ));
  const requestedPassword = (
    directPasswordFields.length > 0
    || /\b(senha|password|passphrase|psk)\b/.test(normalizedContext)
  );
  const requestedSsid = (
    directSsidFields.length > 0
    || /\b(ssid|nome da rede|nome do wifi|nome do wi fi)\b/.test(normalizedContext)
  );
  const directBands = [...directPasswordFields, ...directSsidFields]
    .map((field) => field.band)
    .filter((band): band is Exclude<WifiBand, 'both'> => Boolean(band));
  const band = directBands.length === 1
    ? directBands[0]
    : detectWifiBand(requestContext);
  const genericPassword = extractLabeledWifiChangeValue(input.customerMessage, 'password');
  const genericSsid = extractLabeledWifiChangeValue(input.customerMessage, 'ssid');
  const argumentsValue: Record<string, unknown> = {};
  const missingKinds: WifiCredentialChangeInputPlan['missingKinds'] = [];
  const unsupportedKinds: WifiCredentialChangeInputPlan['unsupportedKinds'] = [];
  let validationError: string | null = null;

  const applyKind = (kind: 'ssid' | 'password', requested: boolean, genericValue: string | null) => {
    if (!requested) return;
    const selectedFields = selectWifiCredentialFields(fields, kind, band);
    if (selectedFields.length === 0) {
      unsupportedKinds.push(kind);
      return;
    }
    let supplied = false;
    for (const field of selectedFields) {
      const value = directValues.get(field.name) || genericValue;
      if (!value) continue;
      supplied = true;
      validationError ||= validateWifiCredentialChangeValue(kind, value);
      argumentsValue[field.name] = value;
    }
    if (!supplied) missingKinds.push(kind);
  };

  applyKind('ssid', requestedSsid, genericSsid);
  applyKind('password', requestedPassword, genericPassword);
  if (!requestedSsid && !requestedPassword) missingKinds.push('selection');

  return {
    arguments: argumentsValue,
    requestedSsid,
    requestedPassword,
    band,
    missingKinds,
    unsupportedKinds,
    validationError,
  };
}

function buildMcpArgumentsFromOrderId(tool: AgentToolCatalogItem | null, orderId: string): Record<string, unknown> {
  const cleanOrderId = orderId.trim();
  const props = getSchemaProperties(tool);
  const propNames = Object.keys(props);
  if (propNames.length === 0) {
    return { order_or_request_id: cleanOrderId };
  }

  const args: Record<string, unknown> = {};
  for (const propName of propNames) {
    const normalized = normalizeText(propName);
    if (/\b(order_id|orderid|pedido|numero_pedido|request_id|requestid|solicitacao|protocolo|protocol|ticket_id|ticketid|chamado|tracking_code|trackingcode|codigo_rastreio)\b/.test(normalized)) {
      args[propName] = cleanOrderId;
    }
  }

  if (Object.keys(args).length === 0) args.order_or_request_id = cleanOrderId;
  return args;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function schemaPropertyLabel(tool: AgentToolCatalogItem | null, propName: string): string {
  const property = getSchemaProperties(tool)[propName] as Record<string, unknown> | undefined;
  const label = String(property?.title || property?.description || '').trim().replace(/\s+/g, ' ');
  return label ? label.slice(0, 160) : propName.replace(/[_-]+/g, ' ');
}

function coerceSchemaArgumentValue(tool: AgentToolCatalogItem | null, propName: string, rawValue: string): unknown {
  const property = getSchemaProperties(tool)[propName] as Record<string, unknown> | undefined;
  const value = rawValue.trim().replace(/^["']|["']$/g, '');
  const type = Array.isArray(property?.type) ? property?.type[0] : property?.type;
  if (type === 'integer') {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : value;
  }
  if (type === 'number') {
    const parsed = Number(value.replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : value;
  }
  if (type === 'boolean') {
    if (/^(true|sim|yes|1)$/i.test(value)) return true;
    if (/^(false|nao|não|no|0)$/i.test(value)) return false;
  }
  if (type === 'array') {
    return value.split(/\s*[,|]\s*/).filter(Boolean);
  }
  return value;
}

function extractNamedSchemaArgument(input: {
  tool: AgentToolCatalogItem | null;
  propName: string;
  customerMessage: string;
}): unknown {
  const property = getSchemaProperties(input.tool)[input.propName] as Record<string, unknown> | undefined;
  const aliases = unique([
    input.propName,
    input.propName.replace(/[_-]+/g, ' '),
    typeof property?.title === 'string' ? property.title : '',
  ]).filter((alias) => alias.length >= 2);
  for (const alias of aliases) {
    const match = input.customerMessage.match(
      new RegExp(`(?:^|[;\\n,])\\s*${escapeRegExp(alias)}\\s*[:=]\\s*([^;\\n,]+)`, 'i'),
    );
    if (match?.[1]) {
      return coerceSchemaArgumentValue(input.tool, input.propName, match[1]);
    }
  }
  return undefined;
}

function buildGenericMcpArguments(input: {
  tool: AgentToolCatalogItem | null;
  slotExtraction: SlotExtractionResult;
  customerMessage: string;
  chatHistory?: string | null;
}): Record<string, unknown> {
  const props = getSchemaProperties(input.tool);
  const propNames = Object.keys(props);
  const slots = input.slotExtraction.slots;
  const args: Record<string, unknown> = {};
  const message = input.customerMessage.trim();

  const addRequiredSlotFallbacks = () => {
    for (const slotName of input.tool?.requiredSlots || []) {
      if (slots[slotName] && args[slotName] == null) args[slotName] = slots[slotName];
    }
  };

  if (propNames.length === 0) {
    addRequiredSlotFallbacks();
    return args;
  }

  for (const propName of propNames) {
    const normalized = normalizeText(propName);
    const namedValue = extractNamedSchemaArgument({
      tool: input.tool,
      propName,
      customerMessage: input.customerMessage,
    });
    if (namedValue !== undefined) {
      args[propName] = namedValue;
      continue;
    }
    if (slots.customer_identifier && /\b(customer_identifier|customer|cpf|cnpj|document|documento|client_id|cliente)\b/.test(normalized)) {
      args[propName] = slots.customer_identifier;
      continue;
    }
    if (slots.order_or_request_id && /\b(order_id|order|pedido|request_id|protocolo|ticket|chamado|tracking)\b/.test(normalized)) {
      args[propName] = slots.order_or_request_id;
      continue;
    }
    if (slots.invoice_or_payment_id && /\b(invoice|fatura|boleto|payment|pagamento|charge|cobranca)\b/.test(normalized)) {
      args[propName] = slots.invoice_or_payment_id;
      continue;
    }
    if (slots.product_or_service_preference && /\b(product|produto|service|servico|plan|plano|item|catalog|catalogo|query|search|term)\b/.test(normalized)) {
      args[propName] = slots.product_or_service_preference;
      continue;
    }
    if (slots.date && /\b(date|data|day|dia|appointment_date|schedule_date)\b/.test(normalized)) {
      args[propName] = slots.date;
      continue;
    }
    if (slots.time && /\b(time|hora|horario|period|periodo|slot_time)\b/.test(normalized)) {
      args[propName] = slots.time;
      continue;
    }
    if (slots.location && /\b(location|local|cidade|city|area|region|regiao)\b/.test(normalized)) {
      args[propName] = slots.location;
      continue;
    }
    if (slots.address && /\b(address|endereco|endereco|cep|street|rua)\b/.test(normalized)) {
      args[propName] = slots.address;
      continue;
    }
    if (slots.name && /\b(name|nome|customer_name|client_name|patient_name)\b/.test(normalized)) {
      args[propName] = slots.name;
      continue;
    }
    if (slots.phone && /\b(phone|telefone|celular|mobile|whatsapp)\b/.test(normalized)) {
      args[propName] = slots.phone;
      continue;
    }
    if (slots.email && /\b(email|e_mail|mail)\b/.test(normalized)) {
      args[propName] = slots.email;
      continue;
    }
    if (slots.quantity && /\b(quantity|quantidade|qty|pessoas|vagas|itens)\b/.test(normalized)) {
      args[propName] = slots.quantity;
      continue;
    }
    if (message && /\b(query|search|term|text|message|pergunta|consulta|prompt)\b/.test(normalized)) {
      args[propName] = message.slice(0, 500);
    }
  }

  addRequiredSlotFallbacks();
  const required = Array.isArray((input.tool?.inputSchema as any)?.required)
    ? (input.tool?.inputSchema as any).required.map(String)
    : [];
  const unresolvedRequired = required.filter((propName: string) => (
    args[propName] == null || String(args[propName]).trim() === ''
  ));
  if (
    unresolvedRequired.length === 1 &&
    input.chatHistory &&
    isLikelyContinuationMessage(input.customerMessage) &&
    !asksGenericExternalActionText(normalizeText(input.customerMessage)) &&
    !asksGenericExternalLookupText(normalizeText(input.customerMessage))
  ) {
    const propName = unresolvedRequired[0];
    const label = schemaPropertyLabel(input.tool, propName);
    const normalizedHistory = normalizeText(input.chatHistory);
    if (
      normalizedHistory.includes(normalizeText(propName)) ||
      normalizedHistory.includes(normalizeText(label))
    ) {
      args[propName] = coerceSchemaArgumentValue(input.tool, propName, input.customerMessage);
    }
  }
  return args;
}

function schemaPropertySlot(propName: string): AutopilotSlotName | null {
  const normalized = normalizeText(propName);
  if (/\b(date|data|day|dia)\b/.test(normalized)) return 'date';
  if (/\b(time|hora|horario|period)\b/.test(normalized)) return 'time';
  if (/\b(location|local|cidade|city|area|region)\b/.test(normalized)) return 'location';
  if (/\b(address|endereco|cep|street|rua)\b/.test(normalized)) return 'address';
  if (/\b(name|nome|customer_name|client_name|patient_name)\b/.test(normalized)) return 'name';
  if (/\b(phone|telefone|celular|mobile|whatsapp)\b/.test(normalized)) return 'phone';
  if (/\b(email|e_mail|mail)\b/.test(normalized)) return 'email';
  if (/\b(product|produto|service|servico|plan|plano|item|catalog|query|search|term)\b/.test(normalized)) return 'product_or_service_preference';
  if (/\b(order|pedido|request|protocolo|ticket|chamado)\b/.test(normalized)) return 'order_or_request_id';
  if (/\b(customer|cpf|cnpj|document|documento|client)\b/.test(normalized)) return 'customer_identifier';
  if (/\b(quantity|quantidade|qty|pessoas|vagas|itens)\b/.test(normalized)) return 'quantity';
  return null;
}

function genericMissingSlotsForRequiredSchema(input: {
  tool: AgentToolCatalogItem | null;
  args: Record<string, unknown>;
}): AutopilotSlotName[] {
  const schema = input.tool?.inputSchema as any;
  const required = unique([
    ...(Array.isArray(schema?.required) ? schema.required.map(String) : []),
    ...((input.tool?.requiredSlots || []).map(String)),
  ]);
  const missing: AutopilotSlotName[] = [];
  for (const propName of required) {
    if (input.args[propName] != null && String(input.args[propName]).trim()) continue;
    const slot = schemaPropertySlot(propName);
    if (slot) missing.push(slot);
  }
  return unique(missing) as AutopilotSlotName[];
}

function genericMissingInputFieldsForRequiredSchema(input: {
  tool: AgentToolCatalogItem | null;
  args: Record<string, unknown>;
}): Array<{ name: string; label: string }> {
  const schema = input.tool?.inputSchema as any;
  const required = Array.isArray(schema?.required) ? schema.required.map(String) : [];
  return required
    .filter((propName: string) => (
      (input.args[propName] == null || String(input.args[propName]).trim() === '') &&
      schemaPropertySlot(propName) == null
    ))
    .map((propName: string) => ({
      name: propName,
      label: schemaPropertyLabel(input.tool, propName),
    }));
}

function buildMissingInputFieldsResponse(fields: Array<{ name: string; label: string }>): string {
  const instructions = fields.map((field) => `${field.name}: ${field.label}`);
  return `Para continuar com seguranca, informe ${instructions.join('; ')}. Responda no formato "campo: valor".`;
}

function buildMcpAction(input: {
  tool: AgentToolCatalogItem;
  contract: ContractCandidate;
  reason: string;
}): AgentToolAction {
  return {
    type: 'mcp_call_tool',
    reason: input.reason,
    payload: {
      toolName: String(input.tool.name),
      arguments: buildMcpArgumentsForContract(input.tool, input.contract),
    },
  };
}

function buildWifiCredentialChangeAction(input: {
  tool: AgentToolCatalogItem;
  contract: ContractCandidate;
  credentialArguments: Record<string, unknown>;
}): AgentToolAction {
  const contractArguments = buildMcpArgumentsForContract(input.tool, input.contract);
  for (const propName of Object.keys(contractArguments)) {
    if (isAdministrativeCredentialSchemaProperty(input.tool, propName)) {
      delete contractArguments[propName];
    }
  }
  return {
    type: 'mcp_call_tool',
    reason: `Alterar somente os dados de Wi-Fi solicitados no contrato ${input.contract.id || 'validado'}, apos confirmacao explicita.`,
    payload: {
      toolName: String(input.tool.name),
      arguments: {
        ...contractArguments,
        ...input.credentialArguments,
      },
    },
  };
}

function wifiBandLabel(band: WifiBand): string {
  if (band === '24') return 'na rede 2,4 GHz';
  if (band === '5g') return 'na rede 5 GHz';
  return 'nas redes 2,4 GHz e 5 GHz';
}

function buildWifiCredentialChangeMissingResponse(
  plan: WifiCredentialChangeInputPlan,
): string {
  const safetySuffix = 'Nenhuma alteracao sera feita antes de eu pedir e receber sua confirmacao explicita.';
  if (plan.validationError) return `${plan.validationError} ${safetySuffix}`;
  if (plan.missingKinds.includes('selection')) {
    return `Validei o contrato. Voce quer alterar o nome da rede, a senha do Wi-Fi ou ambos? ${safetySuffix}`;
  }
  if (plan.missingKinds.length === 1 && plan.missingKinds[0] === 'password') {
    return `Validei o contrato. Informe apenas a nova senha do Wi-Fi no formato "nova senha: valor". ${safetySuffix}`;
  }
  if (plan.missingKinds.length === 1 && plan.missingKinds[0] === 'ssid') {
    return `Validei o contrato. Informe apenas o novo nome da rede no formato "novo SSID: valor". ${safetySuffix}`;
  }
  return `Validei o contrato. Informe o novo nome da rede no formato "novo SSID: valor" e a nova senha no formato "nova senha: valor". ${safetySuffix}`;
}

function buildWifiCredentialChangeConfirmationResponse(
  plan: WifiCredentialChangeInputPlan,
): string {
  const requested = plan.requestedSsid && plan.requestedPassword
    ? 'do nome e da senha do Wi-Fi'
    : plan.requestedSsid
      ? 'do nome da rede Wi-Fi'
      : 'da senha do Wi-Fi';
  return `Preparei a alteracao ${requested} ${wifiBandLabel(plan.band)}. Nenhuma mudanca foi aplicada. Confirme explicitamente para eu executar ou responda "cancelar" para desistir.`;
}

function buildMcpOrderStatusAction(input: {
  tool: AgentToolCatalogItem;
  orderId: string;
  reason: string;
}): AgentToolAction {
  return {
    type: 'mcp_call_tool',
    reason: input.reason,
    payload: {
      toolName: String(input.tool.name),
      arguments: buildMcpArgumentsFromOrderId(input.tool, input.orderId),
    },
  };
}

function buildGenericMcpLookupAction(input: {
  tool: AgentToolCatalogItem;
  slotExtraction: SlotExtractionResult;
  customerMessage: string;
  chatHistory?: string | null;
  arguments?: Record<string, unknown> | null;
  reason: string;
}): AgentToolAction {
  return {
    type: 'mcp_call_tool',
    reason: input.reason,
    payload: {
      toolName: String(input.tool.name),
      arguments: input.arguments || buildGenericMcpArguments({
        tool: input.tool,
        slotExtraction: input.slotExtraction,
        customerMessage: input.customerMessage,
        chatHistory: input.chatHistory,
      }),
    },
  };
}

function buildGenericExternalLookupAction(input: {
  tool: AgentToolCatalogItem;
  slotExtraction: SlotExtractionResult;
  customerMessage: string;
  chatHistory?: string | null;
  arguments?: Record<string, unknown> | null;
  reason: string;
}): AgentToolAction {
  if (input.tool.name === 'sgp_fetch_contact_panel_data') {
    return {
      type: 'sgp_fetch_contact_panel_data',
      reason: input.reason,
      payload: {
        customerIdentifier: input.slotExtraction.slots.customer_identifier || null,
      },
    };
  }
  if (input.tool.name === 'sgp_fetch_contracts') {
    return { type: 'sgp_fetch_contracts', reason: input.reason, payload: {} };
  }
  return buildGenericMcpLookupAction(input);
}

function buildGenericExternalAction(input: {
  tool: AgentToolCatalogItem;
  slotExtraction: SlotExtractionResult;
  customerMessage: string;
  chatHistory?: string | null;
  arguments?: Record<string, unknown> | null;
  reason: string;
}): AgentToolAction {
  return {
    type: 'mcp_call_tool',
    reason: input.reason,
    payload: {
      toolName: String(input.tool.name),
      arguments: input.arguments || buildGenericMcpArguments({
        tool: input.tool,
        slotExtraction: input.slotExtraction,
        customerMessage: input.customerMessage,
        chatHistory: input.chatHistory,
      }),
    },
  };
}

function friendlyToolOperation(tool: AgentToolCatalogItem): string {
  const description = String(tool.description || '').trim().replace(/\s+/g, ' ');
  if (description) return description.replace(/[.!?].*$/, '').slice(0, 180);
  const unqualifiedName = String(tool.name).split(':').pop() || 'a acao solicitada';
  return unqualifiedName.replace(/[_-]+/g, ' ');
}

function buildGenericActionConfirmationPrompt(tool: AgentToolCatalogItem, args: Record<string, unknown>): string {
  const safeDetails = Object.entries(args)
    .filter(([key, value]) => (
      value != null &&
      String(value).trim() &&
      !/\b(password|senha|secret|token|credential|credencial)\b/i.test(key)
    ))
    .slice(0, 4)
    .map(([key, value]) => `${key.replace(/[_-]+/g, ' ')}: ${String(value).slice(0, 120)}`);
  const details = safeDetails.length > 0 ? ` Dados: ${safeDetails.join('; ')}.` : '';
  return `Antes de executar a acao "${friendlyToolOperation(tool)}", preciso da sua confirmacao explicita.${details} Responda "confirmo" para prosseguir ou "cancelar" para desistir.`;
}

function extractTextItems(output: any): string {
  if (!output) return '';
  const content = output.content;
  if (!Array.isArray(content)) return '';
  return content
    .map((item: any) => {
      if (typeof item === 'string') return item;
      if (item?.type === 'text' && typeof item.text === 'string') return item.text;
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function extractStructuredMcpTextItems(output: any): {
  parsed: unknown[];
  plainText: string;
} {
  if (!output || !Array.isArray(output.content)) {
    return { parsed: [], plainText: '' };
  }

  const parsed: unknown[] = [];
  const plainText: string[] = [];
  for (const item of output.content) {
    const text = typeof item === 'string'
      ? item
      : item?.type === 'text' && typeof item.text === 'string'
        ? item.text
        : '';
    if (!text.trim()) continue;
    try {
      parsed.push(JSON.parse(text));
    } catch {
      plainText.push(text);
    }
  }
  return { parsed, plainText: plainText.join('\n') };
}

function collectWifiFields(value: unknown, fields: WifiFields = {}): WifiFields {
  if (!value || typeof value !== 'object') return fields;
  if (Array.isArray(value)) {
    for (const item of value) collectWifiFields(item, fields);
    return fields;
  }

  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const normalizedKey = normalizeText(key);
    if (typeof raw === 'string' || typeof raw === 'number') {
      const text = String(raw).trim();
      if (!text) continue;
      if (!fields.ssid && /\b(ssid|network_name|wifi_name|nome_rede|nome da rede|rede)\b/.test(normalizedKey)) {
        fields.ssid = text;
      } else if (!fields.username && /\b(usuario|user|username|login)\b/.test(normalizedKey)) {
        fields.username = text;
      } else if (!fields.password && /\b(password|senha|passphrase|psk|wifi_password)\b/.test(normalizedKey)) {
        fields.password = text;
      }
    } else if (raw && typeof raw === 'object') {
      collectWifiFields(raw, fields);
    }
  }
  return fields;
}

function extractWifiFieldsFromText(text: string): WifiFields {
  const fields: WifiFields = {};
  const ssid = text.match(/\b(?:ssid|rede|nome da rede)\b\s*[:=-]\s*([^\n;]+)/i)?.[1];
  const username = text.match(/\b(?:usuario|user|username|login)\b\s*[:=-]\s*([^\n;]+)/i)?.[1];
  const password = text.match(/\b(?:senha|password|passphrase|psk)\b\s*[:=-]\s*([^\n;]+)/i)?.[1];
  if (ssid) fields.ssid = ssid.trim();
  if (username) fields.username = username.trim();
  if (password) fields.password = password.trim();
  return fields;
}

function findSuccessfulMcpResult(results: AgentToolExecutionResult[], toolNamePattern: RegExp): AgentToolExecutionResult | null {
  for (let index = results.length - 1; index >= 0; index -= 1) {
    const result = results[index];
    if (
      result.status === 'success' &&
      result.toolName.startsWith('mcp:') &&
      toolNamePattern.test(String(result.toolName))
    ) {
      return result;
    }
  }
  return null;
}

function findSuccessfulMcpResultByToolName(results: AgentToolExecutionResult[], toolName: string): AgentToolExecutionResult | null {
  for (let index = results.length - 1; index >= 0; index -= 1) {
    const result = results[index];
    if (result.status === 'success' && result.toolName === toolName) return result;
  }
  return null;
}

function latestSuccessfulSgpPanelFromResults(results: AgentToolExecutionResult[]): AgentToolExecutionResult | null {
  for (let index = results.length - 1; index >= 0; index -= 1) {
    const result = results[index];
    if (
      result.toolName === 'sgp_fetch_contact_panel_data' &&
      result.status === 'success' &&
      result.output
    ) {
      return result;
    }
  }
  return null;
}

function buildOperationalSgpResponse(result: AgentToolExecutionResult): string | null {
  const output = result.output as any;
  if (!output || typeof output !== 'object') return null;

  const lines: string[] = ['Consultei os dados operacionais do cadastro.'];
  if (output.customerName) lines.push(`Cliente: ${String(output.customerName).trim()}`);

  const contracts = Array.isArray(output.contracts) ? output.contracts : [];
  if (contracts.length > 0) {
    lines.push(`Contratos encontrados: ${contracts.length}.`);
    for (const contract of contracts.slice(0, 3)) {
      const details = [
        contract?.id ? `contrato ${contract.id}` : null,
        contract?.statusLabel || contract?.connectionStatus || null,
        contract?.planDescription || null,
      ].filter(Boolean).join(' - ');
      if (details) lines.push(details);
    }
  }

  const invoiceGroups = Array.isArray(output.invoiceGroups) ? output.invoiceGroups : [];
  for (const group of invoiceGroups.slice(0, 3)) {
    const rawSummary = group?.summary;
    const rawTitle = group?.title;
    const summary = typeof rawSummary === 'string' || typeof rawSummary === 'number'
      ? String(rawSummary).trim()
      : typeof rawTitle === 'string' || typeof rawTitle === 'number'
        ? String(rawTitle).trim()
        : '';
    if (summary && summary !== '[object Object]') lines.push(summary);
  }

  const invoices = Array.isArray(output.invoices) ? output.invoices : [];
  const openInvoices = invoices.filter((invoice: any) => (
    invoice && invoice.isPaid !== true && invoice.isCancelled !== true
  ));
  if (openInvoices.length > 0) {
    lines.push(`Faturas em aberto: ${openInvoices.length}.`);
    for (const invoice of openInvoices.slice(0, 3)) {
      const details = [
        invoice?.id ? `fatura ${invoice.id}` : null,
        invoice?.dueDate ? `vencimento ${invoice.dueDate}` : null,
        invoice?.amountFormatted || invoice?.amount ? `valor ${invoice.amountFormatted || invoice.amount}` : null,
      ].filter(Boolean).join(' - ');
      if (details) lines.push(details);
    }
  }

  return lines.length > 1 ? lines.join('\n') : null;
}

function findFieldDeep(value: unknown, patterns: RegExp[]): string | null {
  if (!value || typeof value !== 'object') return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findFieldDeep(item, patterns);
      if (found) return found;
    }
    return null;
  }

  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const normalizedKey = normalizeText(key);
    if (patterns.some((pattern) => pattern.test(normalizedKey)) && (typeof raw === 'string' || typeof raw === 'number')) {
      const text = String(raw).trim();
      if (text) return text;
    }
    if (raw && typeof raw === 'object') {
      const found = findFieldDeep(raw, patterns);
      if (found) return found;
    }
  }
  return null;
}

function buildGenericMcpStatusResponse(result: AgentToolExecutionResult): string | null {
  const output = result.output as any;
  const structured = output?.structuredContent || output;
  if (structured && typeof structured === 'object') {
    const orderId = findFieldDeep(structured, [/\b(order_id|orderid|pedido|numero_pedido|request_id|protocolo|ticket_id|chamado)\b/]);
    const status = findFieldDeep(structured, [/\b(status|situacao|andamento|state|stage)\b/]);
    const tracking = findFieldDeep(structured, [/\b(tracking|rastreio|codigo_rastreio|tracking_code)\b/]);
    const estimate = findFieldDeep(structured, [/\b(estimated|estimate|previsao|delivery_date|entrega|prazo)\b/]);
    const updatedAt = findFieldDeep(structured, [/\b(updated_at|atualizado|ultima_atualizacao|last_update)\b/]);

    const lines = ['Consultei o status solicitado.'];
    if (orderId) lines.push(`Pedido/protocolo: ${orderId}`);
    if (status) lines.push(`Status: ${status}`);
    if (tracking) lines.push(`Rastreamento: ${tracking}`);
    if (estimate) lines.push(`Previsao: ${estimate}`);
    if (updatedAt) lines.push(`Atualizado em: ${updatedAt}`);
    if (lines.length > 1) return lines.join('\n');
  }

  const text = extractTextItems(output).trim();
  return text ? text.slice(0, 1800) : null;
}

function formatGenericValue(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    const text = String(value).trim();
    return text || null;
  }
  return null;
}

function findFirstGenericArray(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return null;

  const preferredKeys = [
    'items',
    'products',
    'produtos',
    'services',
    'servicos',
    'plans',
    'planos',
    'results',
    'resultados',
    'availability',
    'disponibilidade',
    'slots',
    'horarios',
    'documents',
    'documentos',
  ];
  const record = value as Record<string, unknown>;
  for (const key of preferredKeys) {
    if (Array.isArray(record[key])) return record[key] as unknown[];
  }
  for (const raw of Object.values(record)) {
    if (Array.isArray(raw)) return raw;
  }
  return null;
}

function formatGenericRecord(value: unknown): string | null {
  const primitive = formatGenericValue(value);
  if (primitive) return primitive;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const record = value as Record<string, unknown>;
  const preferredKeys = [
    'name',
    'nome',
    'title',
    'titulo',
    'description',
    'descricao',
    'plan',
    'plano',
    'service',
    'servico',
    'product',
    'produto',
    'id',
    'code',
    'codigo',
    'reference',
    'referencia',
    'protocol',
    'protocolo',
    'order_id',
    'package_code',
    'status',
    'price',
    'preco',
    'valor',
    'amountFormatted',
    'availability',
    'disponibilidade',
    'available',
    'disponivel',
    'stock',
    'estoque',
    'date',
    'data',
    'time',
    'hora',
    'horario',
  ];
  const parts: string[] = [];
  for (const key of preferredKeys) {
    const text = formatGenericValue(record[key]);
    if (text && !parts.includes(text)) parts.push(text);
    if (parts.length >= 5) break;
  }

  if (parts.length === 0) {
    for (const [key, raw] of Object.entries(record)) {
      const text = formatGenericValue(raw);
      if (!text) continue;
      parts.push(`${key}: ${text}`);
      if (parts.length >= 4) break;
    }
  }
  return parts.length > 0 ? parts.join(' - ') : null;
}

function buildGenericMcpLookupResponse(result: AgentToolExecutionResult): string | null {
  const output = result.output as any;
  const structured = output?.structuredContent || output;
  if (structured && typeof structured === 'object') {
    const lines = ['Consultei as informacoes solicitadas.'];
    const list = findFirstGenericArray(structured);
    if (list) {
      for (const item of list.slice(0, 6)) {
        const line = formatGenericRecord(item);
        if (line) lines.push(line);
      }
      if (lines.length > 1) return lines.join('\n');
    }

    const recordLine = formatGenericRecord(structured);
    if (recordLine) lines.push(recordLine);
    if (lines.length > 1) return lines.join('\n');
  }

  const text = extractTextItems(output).trim();
  return text ? text.slice(0, 1800) : null;
}

function shouldUseSgpOperationalLookup(input: {
  customerNeed: AutopilotCustomerNeed;
  intent?: AutopilotIntentResolution['intent'] | null;
  enabledNames: Set<string>;
}): boolean {
  if (!input.enabledNames.has('sgp_fetch_contact_panel_data')) return false;
  if (input.customerNeed === 'external_lookup') return true;
  if (input.customerNeed !== 'none') return false;
  return [
    'billing_or_payment',
    'support_request',
    'troubleshooting',
    'document_request',
  ].includes(String(input.intent || ''));
}

export function buildAutopilotTurnPlan(input: {
  customerMessage: string;
  chatHistory?: string | null;
  intentResolution?: AutopilotIntentResolution | null;
  slotExtraction: SlotExtractionResult;
  enabledToolNames: string[];
  allowedToolNames?: string[] | null;
  toolCatalog: AgentToolCatalogItem[];
  recentToolResults?: AgentToolExecutionResult[] | null;
}): AutopilotTurnPlan {
  const enabledNames = new Set(input.enabledToolNames);
  const allowedNames = new Set(input.allowedToolNames?.length ? input.allowedToolNames : input.enabledToolNames);
  const executableNames = new Set([...enabledNames, ...allowedNames].filter((name) => enabledNames.has(name)));
  const recentToolResults = input.recentToolResults || [];
  const explicitRetryRequested = isExplicitAutopilotToolRetryRequest(input.customerMessage);
  const retryContext = explicitRetryRequested
    ? latestFailedRetryContext({
        recentToolResults,
        executableNames,
        toolCatalog: input.toolCatalog,
      })
    : null;
  const retryTool = retryContext?.tool || null;
  const retryArguments = retryContext?.result.input.type === 'mcp_call_tool'
    && retryContext.result.input.payload?.arguments
    && typeof retryContext.result.input.payload.arguments === 'object'
      ? retryContext.result.input.payload.arguments as Record<string, unknown>
      : null;
  let customerNeed = inferAutopilotCustomerNeed(input.customerMessage, input.chatHistory);

  if (customerNeed === 'wifi_credentials_lookup') {
    const hasRequiredWifiLookupTools = enabledNames.has('sgp_fetch_contact_panel_data') &&
      input.toolCatalog.some(t => enabledNames.has(t.name) && /get_wifi_view|refresh_wifi_summary/i.test(t.name));
    if (!hasRequiredWifiLookupTools) {
      customerNeed = 'none';
    }
  } else if (customerNeed === 'wifi_channel_diagnostics') {
    const hasRequiredWifiDiagTools = enabledNames.has('sgp_fetch_contact_panel_data') &&
      input.toolCatalog.some(t => enabledNames.has(t.name) && /scan_wifi_neighbors|get_wifi_scan_cached/i.test(t.name));
    if (!hasRequiredWifiDiagTools) {
      customerNeed = 'none';
    }
  } else if (customerNeed === 'wifi_credentials_change') {
    const hasChangeTool = input.toolCatalog.some(t => enabledNames.has(t.name) && /change_wifi_credentials/i.test(t.name));
    if (!hasChangeTool) {
      customerNeed = 'none';
    }
  } else if (customerNeed === 'router_reboot') {
    const hasRebootTool = input.toolCatalog.some(t => enabledNames.has(t.name) && /reboot_router|reboot/i.test(t.name));
    if (!hasRebootTool) {
      customerNeed = 'none';
    }
  }

  const explicitConversationClose = isConversationCloseRequest(input.customerMessage);
  if (explicitConversationClose) {
    customerNeed = 'none';
  }
  if (customerNeed === 'none' && retryTool) {
    customerNeed = inferRetryCustomerNeed(retryTool);
  }
  const reasons: string[] = explicitConversationClose
    ? ['explicit_conversation_close_delegated_to_workflow']
    : [];
  if (
    (input.intentResolution?.intent === 'purchase_inquiry' || isCommercialPurchaseFlowText(input.customerMessage, input.chatHistory)) &&
    (customerNeed === 'generic_external_action' || customerNeed === 'generic_external_lookup')
  ) {
    customerNeed = 'none';
    reasons.push('purchase_inquiry_uses_commercial_flow_without_generic_mcp_action');
  }
  const requiredToolNames: string[] = [];
  const forbiddenToolNames: string[] = [];
  let expectedNextAction: AutopilotTurnExpectedAction = 'continue_llm';
  let responseOverride: string | null = null;
  let preResponseActions: AgentToolAction[] = [];
  let confirmationAction: AgentToolAction | null = null;
  let missingSlots: AutopilotSlotName[] = [];
  let missingInputFields: Array<{ name: string; label: string }> = [];
  let genericExternalActionArguments: Record<string, unknown> = {};

  const wifiLookupTool = findToolByPatterns({
    toolCatalog: input.toolCatalog,
    availableToolNames: executableNames,
    include: WIFI_LOOKUP_TOOL_PATTERNS,
    exclude: WIFI_CHANGE_TOOL_PATTERNS,
  });
  const wifiDiagnosticTool = findToolByPatterns({
    toolCatalog: input.toolCatalog,
    availableToolNames: executableNames,
    include: WIFI_DIAGNOSTIC_TOOL_PATTERNS,
    exclude: WIFI_CHANGE_TOOL_PATTERNS,
  });
  const routerRebootTool = findToolByPatterns({
    toolCatalog: input.toolCatalog,
    availableToolNames: executableNames,
    include: ROUTER_REBOOT_TOOL_PATTERNS,
    exclude: WIFI_CHANGE_TOOL_PATTERNS,
  });
  const wifiChangeTool = findToolByPatterns({
    toolCatalog: input.toolCatalog,
    availableToolNames: executableNames,
    include: WIFI_CHANGE_TOOL_PATTERNS,
  });
  const orderStatusTool = findToolByPatterns({
    toolCatalog: input.toolCatalog,
    availableToolNames: executableNames,
    include: ORDER_STATUS_TOOL_PATTERNS,
    exclude: DESTRUCTIVE_TOOL_PATTERNS,
  });
  const genericExternalLookupTool = (
    retryTool &&
    customerNeed === 'generic_external_lookup' &&
    isReadOnlyExternalTool(retryTool)
  ) ? retryTool : findGenericExternalLookupTool({
    toolCatalog: input.toolCatalog,
    availableToolNames: executableNames,
    customerMessage: input.customerMessage,
    chatHistory: input.chatHistory,
  });
  const genericExternalActionTool = (
    retryTool &&
    customerNeed === 'generic_external_action' &&
    retryTool.source === 'mcp' &&
    retryTool.sideEffect !== 'none'
  ) ? retryTool : findGenericExternalActionTool({
    toolCatalog: input.toolCatalog,
    availableToolNames: executableNames,
    customerMessage: input.customerMessage,
    chatHistory: input.chatHistory,
    intent: input.intentResolution?.intent,
  });
  const customerIdentifier = input.slotExtraction.slots.customer_identifier || null;
  const orderOrRequestId = input.slotExtraction.slots.order_or_request_id || null;
  const orderStatusAction = orderStatusTool && orderOrRequestId
    ? buildMcpOrderStatusAction({
        tool: orderStatusTool,
        orderId: orderOrRequestId,
        reason: `Consultar status do pedido/protocolo ${orderOrRequestId} usando a ferramenta MCP real.`,
      })
    : null;
  const requiresSgpOperationalLookup = shouldUseSgpOperationalLookup({
    customerNeed,
    intent: input.intentResolution?.intent,
    enabledNames,
  });

  if (requiresSgpOperationalLookup) {
    requiredToolNames.push('sgp_fetch_contact_panel_data');
    if (!customerIdentifier) {
      expectedNextAction = 'ask_slot';
      missingSlots = ['customer_identifier'];
      responseOverride = 'Para consultar com seguranca, me informe o CPF/CNPJ do titular ou identificador cadastrado.';
      reasons.push('operational_lookup_requires_customer_identifier');
    } else if (
      !latestSgpPanelResult(recentToolResults, customerIdentifier) &&
      hasFailedTool(recentToolResults, 'sgp_fetch_contact_panel_data') &&
      !explicitRetryRequested
    ) {
      expectedNextAction = 'continue_llm';
      responseOverride = buildRecentFailureResponse('sgp_fetch_contact_panel_data');
      reasons.push('operational_lookup_recent_sgp_failure');
    } else if (!latestSgpPanelResult(recentToolResults, customerIdentifier)) {
      expectedNextAction = 'call_required_tool';
      preResponseActions = [{
        type: 'sgp_fetch_contact_panel_data',
        reason: 'Validar cliente e consultar dados operacionais antes de responder.',
        payload: { customerIdentifier },
      }];
      reasons.push('operational_lookup_requires_sgp_validation');
    } else {
      expectedNextAction = 'respond_from_tool_result';
      reasons.push('operational_lookup_available_in_recent_tool_memory');
    }
  }

  if (customerNeed === 'order_status_lookup') {
    if (orderStatusTool) requiredToolNames.push(String(orderStatusTool.name));

    if (!orderOrRequestId) {
      expectedNextAction = 'ask_slot';
      missingSlots = ['order_or_request_id'];
      responseOverride = 'Para consultar o status, me informe o numero do pedido, protocolo ou solicitacao.';
      reasons.push('order_status_requires_order_or_request_id');
    } else if (!orderStatusTool) {
      expectedNextAction = 'continue_llm';
      responseOverride = 'Consigo ajudar com status, mas nao encontrei uma ferramenta MCP habilitada para consultar esse pedido/protocolo automaticamente. Vou precisar verificar manualmente.';
      reasons.push('order_status_mcp_not_enabled');
    } else if (
      orderStatusAction &&
      hasSuccessfulTool(
        recentToolResults,
        String(orderStatusTool.name),
        toolActionArguments(orderStatusAction),
      )
    ) {
      expectedNextAction = 'respond_from_tool_result';
      reasons.push('order_status_available_in_recent_tool_memory');
    } else if (
      orderStatusAction &&
      hasFailedTool(
        recentToolResults,
        String(orderStatusTool.name),
        toolActionArguments(orderStatusAction),
      ) &&
      !explicitRetryRequested
    ) {
      expectedNextAction = 'continue_llm';
      responseOverride = buildRecentFailureResponse(String(orderStatusTool.name));
      reasons.push('order_status_recent_mcp_failure');
    } else {
      expectedNextAction = 'call_required_tool';
      preResponseActions = orderStatusAction ? [orderStatusAction] : [];
      reasons.push('order_status_mcp_lookup_required');
    }
  }

  if (customerNeed === 'generic_external_lookup') {
    forbiddenToolNames.push(...input.enabledToolNames.filter((toolName) => {
      const tool = input.toolCatalog.find((item) => item.name === toolName);
      if (!tool) return DESTRUCTIVE_TOOL_PATTERNS.some((pattern) => pattern.test(toolName));
      return !isReadOnlyExternalTool(tool) || DESTRUCTIVE_TOOL_PATTERNS.some((pattern) => pattern.test(catalogSearchText(tool)));
    }));

    if (!genericExternalLookupTool) {
      expectedNextAction = 'continue_llm';
      responseOverride = null;
      reasons.push('generic_external_lookup_tool_not_enabled');
    } else {
      requiredToolNames.push(String(genericExternalLookupTool.name));
      const continuationArguments = (
        isLikelyContinuationMessage(input.customerMessage)
          ? latestToolArguments(recentToolResults, String(genericExternalLookupTool.name))
          : null
      );
      const genericArgs = retryTool?.name === genericExternalLookupTool.name && retryArguments
        ? retryArguments
        : continuationArguments
          ? continuationArguments
        : buildGenericMcpArguments({
            tool: genericExternalLookupTool,
            slotExtraction: input.slotExtraction,
            customerMessage: input.customerMessage,
            chatHistory: input.chatHistory,
          });
      const genericMissingSlots = genericMissingSlotsForRequiredSchema({
        tool: genericExternalLookupTool,
        args: genericArgs,
      });
      const genericMissingInputFields = genericMissingInputFieldsForRequiredSchema({
        tool: genericExternalLookupTool,
        args: genericArgs,
      });
      const genericLookupAction = buildGenericExternalLookupAction({
        tool: genericExternalLookupTool,
        slotExtraction: input.slotExtraction,
        customerMessage: input.customerMessage,
        chatHistory: input.chatHistory,
        arguments: genericArgs,
        reason: `Consultar dados solicitados usando a ferramenta MCP/API real ${genericExternalLookupTool.name}.`,
      });

      if (genericMissingSlots.length > 0 || genericMissingInputFields.length > 0) {
        expectedNextAction = 'ask_slot';
        missingSlots = genericMissingSlots;
        missingInputFields = genericMissingInputFields;
        responseOverride = [
          genericMissingSlots.length > 0 ? buildMissingSlotsResponse(genericMissingSlots) : '',
          genericMissingInputFields.length > 0 ? buildMissingInputFieldsResponse(genericMissingInputFields) : '',
        ].filter(Boolean).join(' ');
        reasons.push('generic_external_lookup_requires_slots');
      } else if (hasSuccessfulTool(
        recentToolResults,
        String(genericExternalLookupTool.name),
        toolActionArguments(genericLookupAction),
      )) {
        expectedNextAction = 'respond_from_tool_result';
        reasons.push('generic_external_lookup_available_in_recent_tool_memory');
      } else if (
        hasFailedTool(
          recentToolResults,
          String(genericExternalLookupTool.name),
          toolActionArguments(genericLookupAction),
        ) &&
        !explicitRetryRequested
      ) {
        expectedNextAction = 'continue_llm';
        responseOverride = buildRecentFailureResponse(String(genericExternalLookupTool.name));
        reasons.push('generic_external_lookup_recent_mcp_failure');
      } else {
        expectedNextAction = 'call_required_tool';
        preResponseActions = [genericLookupAction];
        reasons.push('generic_external_lookup_required');
      }
    }
  }

  if (customerNeed === 'generic_external_action') {
    if (!genericExternalActionTool) {
      expectedNextAction = 'continue_llm';
      responseOverride = 'Entendi a acao solicitada, mas nao encontrei uma ferramenta MCP habilitada e coerente para executa-la com seguranca. Vou precisar encaminhar ou verificar manualmente.';
      reasons.push('generic_external_action_tool_not_enabled');
    } else {
      const toolName = String(genericExternalActionTool.name);
      requiredToolNames.push(toolName);
      forbiddenToolNames.push(...input.enabledToolNames.filter((enabledToolName) => {
        if (enabledToolName === toolName) return false;
        const enabledTool = input.toolCatalog.find((item) => item.name === enabledToolName);
        return Boolean(enabledTool?.source === 'mcp' && enabledTool.sideEffect !== 'none');
      }));

      const continuationArguments = (
        isLikelyContinuationMessage(input.customerMessage)
          ? latestToolArguments(recentToolResults, toolName)
          : null
      );
      const actionArgs = retryTool?.name === genericExternalActionTool.name && retryArguments
        ? retryArguments
        : continuationArguments
          ? continuationArguments
        : buildGenericMcpArguments({
            tool: genericExternalActionTool,
            slotExtraction: input.slotExtraction,
            customerMessage: input.customerMessage,
            chatHistory: input.chatHistory,
          });
      genericExternalActionArguments = actionArgs;
      const actionMissingSlots = genericMissingSlotsForRequiredSchema({
        tool: genericExternalActionTool,
        args: actionArgs,
      });
      const actionMissingInputFields = genericMissingInputFieldsForRequiredSchema({
        tool: genericExternalActionTool,
        args: actionArgs,
      });
      const genericAction = buildGenericExternalAction({
        tool: genericExternalActionTool,
        slotExtraction: input.slotExtraction,
        customerMessage: input.customerMessage,
        chatHistory: input.chatHistory,
        arguments: actionArgs,
        reason: `Preparar a acao solicitada com a ferramenta MCP real ${toolName}; a politica de execucao deve exigir confirmacao vinculada aos argumentos.`,
      });

      if (hasSuccessfulTool(
        recentToolResults,
        toolName,
        toolActionArguments(genericAction),
      )) {
        expectedNextAction = 'respond_from_tool_result';
        reasons.push('generic_external_action_already_completed');
      } else if (
        hasFailedTool(
          recentToolResults,
          toolName,
          toolActionArguments(genericAction),
        ) &&
        !explicitRetryRequested
      ) {
        expectedNextAction = 'continue_llm';
        responseOverride = 'A acao anterior nao foi concluida. Nao vou repeti-la automaticamente para evitar duplicidade. Posso verificar o ocorrido ou encaminhar para atendimento humano.';
        reasons.push('generic_external_action_recent_failure_no_retry');
      } else if (actionMissingSlots.length > 0 || actionMissingInputFields.length > 0) {
        expectedNextAction = 'ask_slot';
        missingSlots = actionMissingSlots;
        missingInputFields = actionMissingInputFields;
        responseOverride = [
          actionMissingSlots.length > 0 ? buildMissingSlotsResponse(actionMissingSlots) : '',
          actionMissingInputFields.length > 0 ? buildMissingInputFieldsResponse(actionMissingInputFields) : '',
        ].filter(Boolean).join(' ');
        reasons.push('generic_external_action_requires_slots');
      } else {
        expectedNextAction = 'require_confirmation';
        preResponseActions = [genericAction];
        reasons.push('generic_external_action_stage_for_confirmation');
      }
    }
  }

  if (customerNeed === 'wifi_credentials_lookup') {
    forbiddenToolNames.push(...input.enabledToolNames.filter((toolName) => (
      /\b(reboot_router|reboot|restart|reinici|change_wifi_credentials|update_wifi|set_wifi)\b/i.test(toolName)
    )));
    if (wifiLookupTool) requiredToolNames.push(String(wifiLookupTool.name));

    if (!input.slotExtraction.slots.customer_identifier) {
      expectedNextAction = 'ask_slot';
      missingSlots = ['customer_identifier'];
      responseOverride = 'Para consultar os dados do Wi-Fi com seguranca, me informe o CPF/CNPJ do titular ou identificador cadastrado.';
      reasons.push('wifi_credentials_requires_customer_identifier');
    } else if (!enabledNames.has('sgp_fetch_contact_panel_data')) {
      expectedNextAction = 'continue_llm';
      responseOverride = 'Consigo ajudar com os dados do Wi-Fi, mas a consulta de cadastro/contrato nao esta habilitada para este agente. Vou precisar que a equipe verifique manualmente.';
      reasons.push('sgp_lookup_not_enabled');
    } else if (
      !latestSgpPanelResult(recentToolResults, customerIdentifier) &&
      hasFailedTool(recentToolResults, 'sgp_fetch_contact_panel_data') &&
      !explicitRetryRequested
    ) {
      expectedNextAction = 'continue_llm';
      responseOverride = buildRecentFailureResponse('sgp_fetch_contact_panel_data');
      reasons.push('wifi_credentials_recent_sgp_failure');
    } else if (!latestSgpPanelResult(recentToolResults, customerIdentifier)) {
      expectedNextAction = 'call_required_tool';
      requiredToolNames.unshift('sgp_fetch_contact_panel_data');
      preResponseActions = [{
        type: 'sgp_fetch_contact_panel_data',
        reason: 'Validar cliente e contrato antes de consultar dados sensiveis do Wi-Fi.',
        payload: { customerIdentifier },
      }];
      reasons.push('wifi_credentials_requires_sgp_validation');
    } else if (!wifiLookupTool) {
      expectedNextAction = 'continue_llm';
      responseOverride = 'Validei o cadastro, mas nao encontrei uma ferramenta MCP habilitada para consultar SSID/senha do Wi-Fi. Vou precisar que a equipe verifique manualmente.';
      reasons.push('wifi_lookup_mcp_not_enabled');
    } else {
      const contract = selectContractWithIp(recentToolResults, input.customerMessage, customerIdentifier);
      if (!contract?.ip) {
        expectedNextAction = 'continue_llm';
        if (requestedContractIsMissing(recentToolResults, input.customerMessage, customerIdentifier)) {
          responseOverride = 'O contrato informado nao foi encontrado entre os contratos do titular validado para este CPF/CNPJ. Confira o numero do contrato ou o CPF/CNPJ antes de continuar.';
          reasons.push('requested_contract_not_owned_by_validated_customer');
        } else {
          responseOverride = 'Validei o cadastro, mas nao encontrei um IPv4 do contrato para consultar o roteador automaticamente. Vou precisar que a equipe verifique manualmente.';
          reasons.push('sgp_contract_has_no_ipv4_for_wifi_lookup');
        }
      } else {
        const wifiLookupAction = buildMcpAction({
          tool: wifiLookupTool,
          contract,
          reason: `Consultar SSID/senha do Wi-Fi do contrato ${contract.id || 'validado'} usando a ferramenta MCP real.`,
        });
        const wifiLookupArguments = toolActionArguments(wifiLookupAction);
        if (hasSuccessfulTool(
          recentToolResults,
          String(wifiLookupTool.name),
          wifiLookupArguments,
        )) {
          expectedNextAction = 'respond_from_tool_result';
          reasons.push('wifi_credentials_available_in_recent_tool_memory');
        } else if (
          hasFailedTool(
            recentToolResults,
            String(wifiLookupTool.name),
            wifiLookupArguments,
        ) &&
        !explicitRetryRequested
      ) {
        expectedNextAction = 'continue_llm';
        responseOverride = 'Validei o cadastro, mas nao consegui obter os dados do Wi-Fi automaticamente agora. Para evitar uma informacao incorreta, sera necessario verificar manualmente.';
        reasons.push('wifi_credentials_recent_mcp_failure');
      } else {
          expectedNextAction = 'call_required_tool';
          preResponseActions = [wifiLookupAction];
          reasons.push('wifi_credentials_mcp_lookup_required');
        }
      }
    }
  }

  if (customerNeed === 'wifi_channel_diagnostics') {
    if (wifiDiagnosticTool) requiredToolNames.push(String(wifiDiagnosticTool.name));
    forbiddenToolNames.push(...input.enabledToolNames.filter((toolName) => (
      /\b(reboot_router|reboot|restart|reinici|change_wifi_credentials|update_wifi|set_wifi)\b/i.test(toolName)
    )));
    if (!input.slotExtraction.slots.customer_identifier) {
      expectedNextAction = 'ask_slot';
      missingSlots = ['customer_identifier'];
      responseOverride = 'Para analisar o Wi-Fi do contrato correto, me informe o CPF/CNPJ do titular ou identificador cadastrado.';
      reasons.push('wifi_diagnostics_requires_customer_identifier');
    } else if (
      enabledNames.has('sgp_fetch_contact_panel_data') &&
      !latestSgpPanelResult(recentToolResults, customerIdentifier) &&
      hasFailedTool(recentToolResults, 'sgp_fetch_contact_panel_data') &&
      !explicitRetryRequested
    ) {
      expectedNextAction = 'continue_llm';
      responseOverride = buildRecentFailureResponse('sgp_fetch_contact_panel_data');
      reasons.push('wifi_diagnostics_recent_sgp_failure');
    } else if (enabledNames.has('sgp_fetch_contact_panel_data') && !latestSgpPanelResult(recentToolResults, customerIdentifier)) {
      expectedNextAction = 'call_required_tool';
      requiredToolNames.unshift('sgp_fetch_contact_panel_data');
      preResponseActions = [{
        type: 'sgp_fetch_contact_panel_data',
        reason: 'Validar contrato e localizar IP antes do diagnostico de Wi-Fi.',
        payload: { customerIdentifier },
      }];
      reasons.push('wifi_diagnostics_requires_sgp_validation');
    } else if (wifiDiagnosticTool) {
      const contract = selectContractWithIp(recentToolResults, input.customerMessage, customerIdentifier);
      if (contract?.ip) {
        const wifiDiagnosticAction = buildMcpAction({
          tool: wifiDiagnosticTool,
          contract,
          reason: `Consultar diagnostico/canais Wi-Fi do contrato ${contract.id || 'validado'} usando MCP real.`,
        });
        const wifiDiagnosticArguments = toolActionArguments(wifiDiagnosticAction);
        if (
          hasFailedTool(
            recentToolResults,
            String(wifiDiagnosticTool.name),
            wifiDiagnosticArguments,
          ) &&
          !explicitRetryRequested
        ) {
          expectedNextAction = 'continue_llm';
          responseOverride = buildRecentFailureResponse(String(wifiDiagnosticTool.name));
          reasons.push('wifi_diagnostics_recent_mcp_failure');
        } else if (hasSuccessfulTool(
          recentToolResults,
          String(wifiDiagnosticTool.name),
          wifiDiagnosticArguments,
        )) {
          expectedNextAction = 'respond_from_tool_result';
          reasons.push('wifi_diagnostics_available_in_recent_tool_memory');
        } else {
          expectedNextAction = 'call_required_tool';
          preResponseActions = [wifiDiagnosticAction];
          reasons.push('wifi_diagnostics_mcp_required');
        }
      } else if (requestedContractIsMissing(recentToolResults, input.customerMessage, customerIdentifier)) {
        expectedNextAction = 'continue_llm';
        responseOverride = 'O contrato informado nao foi encontrado entre os contratos do titular validado para este CPF/CNPJ. Confira os dados antes de iniciar o diagnostico.';
        reasons.push('requested_contract_not_owned_by_validated_customer');
      }
    }
  }

  if (customerNeed === 'router_reboot') {
    expectedNextAction = 'require_confirmation';
    if (routerRebootTool) requiredToolNames.push(String(routerRebootTool.name));
    forbiddenToolNames.push(...input.enabledToolNames.filter((toolName) => (
      /\b(change_wifi_credentials|update_wifi|set_wifi|password|senha|credential)\b/i.test(toolName)
    )));
    if (!customerIdentifier) {
      expectedNextAction = 'ask_slot';
      missingSlots = ['customer_identifier'];
      responseOverride = 'Para reiniciar o roteador correto com seguranca, me informe o CPF/CNPJ do titular ou identificador cadastrado.';
      reasons.push('router_reboot_requires_customer_identifier');
    } else if (!enabledNames.has('sgp_fetch_contact_panel_data')) {
      expectedNextAction = 'continue_llm';
      responseOverride = 'Nao consigo validar com seguranca qual roteador deve ser reiniciado porque a consulta de contrato nao esta habilitada. Vou precisar de verificacao manual.';
      reasons.push('router_reboot_sgp_lookup_not_enabled');
    } else if (
      !latestSgpPanelResult(recentToolResults, customerIdentifier)
      && hasFailedTool(recentToolResults, 'sgp_fetch_contact_panel_data')
      && !explicitRetryRequested
    ) {
      expectedNextAction = 'continue_llm';
      responseOverride = buildRecentFailureResponse('sgp_fetch_contact_panel_data');
      reasons.push('router_reboot_recent_sgp_failure');
    } else if (!latestSgpPanelResult(recentToolResults, customerIdentifier)) {
      expectedNextAction = 'call_required_tool';
      requiredToolNames.unshift('sgp_fetch_contact_panel_data');
      preResponseActions = [{
        type: 'sgp_fetch_contact_panel_data',
        reason: 'Validar cliente e contrato antes de preparar confirmacao de reboot.',
        payload: { customerIdentifier },
      }];
      responseOverride = null;
      reasons.push('router_reboot_requires_sgp_validation');
    } else if (!routerRebootTool) {
      expectedNextAction = 'continue_llm';
      responseOverride = 'Validei o contrato, mas a ferramenta especifica de reboot nao esta habilitada. Vou precisar de verificacao manual.';
      reasons.push('router_reboot_mcp_not_enabled');
    } else {
      const contract = selectContractWithIp(recentToolResults, input.customerMessage, customerIdentifier);
      if (!contract?.ip) {
        expectedNextAction = 'continue_llm';
        responseOverride = requestedContractIsMissing(recentToolResults, input.customerMessage, customerIdentifier)
          ? 'O contrato informado nao foi encontrado entre os contratos do titular validado. Confira o CPF/CNPJ e o contrato antes de continuar.'
          : 'Validei o cadastro, mas nao encontrei os dados tecnicos necessarios para preparar o reboot com seguranca.';
        reasons.push(
          requestedContractIsMissing(recentToolResults, input.customerMessage, customerIdentifier)
            ? 'requested_contract_not_owned_by_validated_customer'
            : 'router_reboot_contract_has_no_ipv4',
        );
      } else {
        confirmationAction = buildMcpAction({
          tool: routerRebootTool,
          contract,
          reason: `Reiniciar o roteador do contrato ${contract.id || 'validado'} somente apos confirmacao explicita.`,
        });
        responseOverride = 'Posso reiniciar o roteador agora? A conexao pode ficar indisponivel por alguns minutos. Confirme explicitamente para eu prosseguir.';
        reasons.push('router_reboot_requires_explicit_confirmation');
      }
    }
  }

  if (customerNeed === 'wifi_credentials_change') {
    expectedNextAction = 'require_confirmation';
    if (wifiChangeTool) requiredToolNames.push(String(wifiChangeTool.name));
    forbiddenToolNames.push(...input.enabledToolNames.filter((toolName) => (
      /\b(reboot_router|reboot|restart|reinici)\b/i.test(toolName)
    )));
    if (!customerIdentifier) {
      expectedNextAction = 'ask_slot';
      missingSlots = ['customer_identifier'];
      responseOverride = 'Para alterar dados do Wi-Fi com seguranca, me informe o CPF/CNPJ do titular ou identificador cadastrado.';
      reasons.push('wifi_credentials_change_requires_customer_identifier');
    } else if (!enabledNames.has('sgp_fetch_contact_panel_data')) {
      expectedNextAction = 'continue_llm';
      responseOverride = 'Nao consigo validar com seguranca qual contrato deve receber a alteracao porque a consulta de cadastro nao esta habilitada. Vou precisar de verificacao manual.';
      reasons.push('wifi_credentials_change_sgp_lookup_not_enabled');
    } else if (
      !latestSgpPanelResult(recentToolResults, customerIdentifier)
      && hasFailedTool(recentToolResults, 'sgp_fetch_contact_panel_data')
      && !explicitRetryRequested
    ) {
      expectedNextAction = 'continue_llm';
      responseOverride = buildRecentFailureResponse('sgp_fetch_contact_panel_data');
      reasons.push('wifi_credentials_change_recent_sgp_failure');
    } else if (!latestSgpPanelResult(recentToolResults, customerIdentifier)) {
      expectedNextAction = 'call_required_tool';
      requiredToolNames.unshift('sgp_fetch_contact_panel_data');
      preResponseActions = [{
        type: 'sgp_fetch_contact_panel_data',
        reason: 'Validar cliente e contrato antes de preparar alteracao de credenciais do Wi-Fi.',
        payload: { customerIdentifier },
      }];
      responseOverride = null;
      reasons.push('wifi_credentials_change_requires_sgp_validation');
    } else if (!wifiChangeTool) {
      expectedNextAction = 'continue_llm';
      responseOverride = 'Validei o contrato, mas a ferramenta MCP especifica para alterar nome ou senha do Wi-Fi nao esta habilitada. Vou precisar de verificacao manual.';
      reasons.push('wifi_credentials_change_mcp_not_enabled');
    } else {
      const requestContext = recentCustomerRequestContext(
        input.customerMessage,
        input.chatHistory,
      );
      const contract = selectContractWithIp(
        recentToolResults,
        requestContext,
        customerIdentifier,
      );
      if (!contract?.ip) {
        expectedNextAction = 'continue_llm';
        responseOverride = requestedContractIsMissing(
          recentToolResults,
          requestContext,
          customerIdentifier,
        )
          ? 'O contrato informado nao foi encontrado entre os contratos do titular validado. Confira o CPF/CNPJ e o contrato antes de continuar.'
          : 'Validei o cadastro, mas nao encontrei os dados tecnicos necessarios para preparar a alteracao do Wi-Fi com seguranca.';
        reasons.push(
          requestedContractIsMissing(recentToolResults, requestContext, customerIdentifier)
            ? 'requested_contract_not_owned_by_validated_customer'
            : 'wifi_credentials_change_contract_has_no_ipv4',
        );
      } else {
        const changeInputPlan = buildWifiCredentialChangeInputPlan({
          tool: wifiChangeTool,
          customerMessage: input.customerMessage,
          chatHistory: input.chatHistory,
        });
        if (changeInputPlan.unsupportedKinds.length > 0) {
          expectedNextAction = 'continue_llm';
          responseOverride = 'A ferramenta habilitada para esta ONT nao possui os campos especificos necessarios para a alteracao solicitada. Nenhuma mudanca foi executada.';
          reasons.push('wifi_credentials_change_schema_missing_fields');
        } else if (changeInputPlan.validationError || changeInputPlan.missingKinds.length > 0) {
          expectedNextAction = 'ask_slot';
          missingInputFields = changeInputPlan.missingKinds.map((kind) => ({
            name: kind === 'password'
              ? 'new_wifi_password'
              : kind === 'ssid'
                ? 'new_wifi_ssid'
                : 'wifi_credential_selection',
            label: kind === 'password'
              ? 'nova senha do Wi-Fi'
              : kind === 'ssid'
                ? 'novo nome da rede Wi-Fi'
                : 'nome da rede, senha ou ambos',
          }));
          responseOverride = buildWifiCredentialChangeMissingResponse(changeInputPlan);
          reasons.push(
            changeInputPlan.validationError
              ? 'wifi_credentials_change_value_invalid'
              : 'wifi_credentials_change_requires_requested_values',
          );
        } else {
          confirmationAction = buildWifiCredentialChangeAction({
            tool: wifiChangeTool,
            contract,
            credentialArguments: changeInputPlan.arguments,
          });
          responseOverride = buildWifiCredentialChangeConfirmationResponse(changeInputPlan);
          reasons.push('wifi_credentials_change_requires_explicit_confirmation');
        }
      }
    }
  }

  return {
    customerNeed,
    expectedNextAction,
    requiredToolNames: unique(requiredToolNames),
    forbiddenToolNames: unique(forbiddenToolNames),
    missingSlots,
    missingInputFields,
    preResponseActions,
    confirmationAction,
    responseOverride,
    reasons,
    metadata: {
      intent: input.intentResolution?.intent ?? null,
      selectedWifiLookupTool: wifiLookupTool?.name ?? null,
      selectedWifiDiagnosticTool: wifiDiagnosticTool?.name ?? null,
      selectedRouterRebootTool: routerRebootTool?.name ?? null,
      selectedWifiChangeTool: wifiChangeTool?.name ?? null,
      selectedOrderStatusTool: orderStatusTool?.name ?? null,
      selectedGenericExternalLookupTool: genericExternalLookupTool?.name ?? null,
      selectedGenericExternalActionTool: genericExternalActionTool?.name ?? null,
      genericExternalActionConfirmationPrompt: genericExternalActionTool
        ? buildGenericActionConfirmationPrompt(
            genericExternalActionTool,
            genericExternalActionArguments,
          )
        : null,
      requiresSgpOperationalLookup,
      recentToolNames: recentToolResults.map((result) => result.toolName),
      recentSgpMemoryMatchesCustomer: Boolean(
        latestSgpPanelResult(recentToolResults, customerIdentifier),
      ),
      recentSgpIdentityDiagnostics: recentToolResults
        .filter((result) => result.toolName === 'sgp_fetch_contact_panel_data')
        .map((result) => {
          const expected = onlyDigits(customerIdentifier);
          const requested = inputCustomerIdentifier(result);
          const output = outputCustomerIdentifier(result.output);
          const expectedFingerprint = expected
            ? fingerprintAuditedToolOperation({
                type: 'sgp_fetch_contact_panel_data',
                payload: { customerIdentifier: expected },
              })
            : '';
          return {
            expectedLength: expected.length,
            requestedLength: requested.length,
            outputLength: output.length,
            requestedMatches: Boolean(expected && requested === expected),
            outputMatches: Boolean(expected && output === expected),
            operationFingerprintMatches: Boolean(
              expectedFingerprint
              && inputOperationFingerprint(result) === expectedFingerprint
            ),
          };
        }),
      actionToolNames: preResponseActions.map(actionToolName),
      missingInputFields,
    },
  };
}

export function buildAutopilotTurnPlanFollowUpActions(input: {
  turnPlan: AutopilotTurnPlan;
  customerMessage: string;
  enabledToolNames: string[];
  allowedToolNames?: string[] | null;
  toolCatalog: AgentToolCatalogItem[];
  toolResults: AgentToolExecutionResult[];
}): AgentToolAction[] {
  if (!['wifi_credentials_lookup', 'wifi_channel_diagnostics'].includes(input.turnPlan.customerNeed)) {
    return [];
  }
  if (!input.toolResults.some((result) => result.toolName === 'sgp_fetch_contact_panel_data' && result.status === 'success')) {
    return [];
  }

  const enabledNames = new Set(input.enabledToolNames);
  const allowedNames = new Set(input.allowedToolNames?.length ? input.allowedToolNames : input.enabledToolNames);
  const executableNames = new Set([...enabledNames, ...allowedNames].filter((name) => enabledNames.has(name)));
  const patterns = input.turnPlan.customerNeed === 'wifi_channel_diagnostics'
    ? WIFI_DIAGNOSTIC_TOOL_PATTERNS
    : WIFI_LOOKUP_TOOL_PATTERNS;
  const tool = findToolByPatterns({
    toolCatalog: input.toolCatalog,
    availableToolNames: executableNames,
    include: patterns,
    exclude: WIFI_CHANGE_TOOL_PATTERNS,
  });
  if (!tool) return [];
  if (input.toolResults.some((result) => result.toolName === tool.name && result.status === 'success')) return [];

  const contract = selectContractWithIp(input.toolResults, input.customerMessage);
  if (!contract?.ip) return [];

  return [buildMcpAction({
    tool,
    contract,
    reason: input.turnPlan.customerNeed === 'wifi_channel_diagnostics'
      ? `Consultar diagnostico/canais Wi-Fi do contrato ${contract.id || 'validado'} apos validacao SGP.`
      : `Consultar SSID/senha do Wi-Fi do contrato ${contract.id || 'validado'} apos validacao SGP.`,
  })];
}

export function buildAutopilotTurnPlanRecoveryActions(input: {
  turnPlan: AutopilotTurnPlan;
  customerMessage: string;
  enabledToolNames: string[];
  allowedToolNames?: string[] | null;
  toolCatalog: AgentToolCatalogItem[];
  toolResults: AgentToolExecutionResult[];
}): AgentToolAction[] {
  if (input.turnPlan.customerNeed !== 'wifi_channel_diagnostics') return [];
  if (!input.toolResults.some((result) => (
    result.status !== 'success'
    && /\bscan_wifi_neighbors\b/i.test(String(result.toolName))
  ))) {
    return [];
  }
  if (input.toolResults.some((result) => (
    /\bget_wifi_scan_cached\b/i.test(String(result.toolName))
  ))) {
    return [];
  }

  const enabledNames = new Set(input.enabledToolNames);
  const cachedTool = input.toolCatalog.find((tool) => (
    enabledNames.has(String(tool.name))
    && /\bget_wifi_scan_cached\b/i.test(String(tool.name))
    && tool.sideEffect === 'none'
    && tool.idempotent
  ));
  if (!cachedTool) return [];

  const contract = selectContractWithIp(input.toolResults, input.customerMessage);
  if (!contract?.ip) return [];
  return [buildMcpAction({
    tool: cachedTool,
    contract,
    reason: `O scan ao vivo falhou; consultar o ultimo scan Wi-Fi em cache do contrato ${contract.id || 'validado'} sem alterar configuracoes.`,
  })];
}

export function buildAutopilotTurnPlanCustomerResponse(input: {
  turnPlan: AutopilotTurnPlan;
  toolResults: AgentToolExecutionResult[];
}): string | null {
  if (input.turnPlan.customerNeed === 'wifi_credentials_lookup') {
    const mcpResult = findSuccessfulMcpResult(input.toolResults, /\b(get_wifi_view|refresh_wifi_summary|wifi)\b/i);
    if (!mcpResult) {
      if (input.toolResults.some((result) => result.toolName === 'sgp_fetch_contact_panel_data' && result.status === 'success')) {
        return 'Validei o cadastro, mas nao consegui obter os dados do Wi-Fi automaticamente agora. Vou precisar que a equipe verifique manualmente.';
      }
      return null;
    }

    const output = mcpResult.output as any;
    const structured = output?.structuredContent || output;
    const textPayloads = extractStructuredMcpTextItems(output);
    const fields: WifiFields = {};
    collectWifiFields(structured, fields);
    for (const parsedTextPayload of textPayloads.parsed) {
      collectWifiFields(parsedTextPayload, fields);
    }
    const plainTextFields = extractWifiFieldsFromText(textPayloads.plainText);
    fields.ssid ||= plainTextFields.ssid;
    fields.username ||= plainTextFields.username;
    fields.password ||= plainTextFields.password;
    const lines = ['Consultei os dados atuais do Wi-Fi deste contrato:'];
    if (fields.ssid) lines.push(`Rede/SSID: ${fields.ssid}`);
    if (fields.username && fields.username !== fields.ssid) lines.push(`Usuario: ${fields.username}`);
    if (fields.password) lines.push(`Senha: ${fields.password}`);
    if (lines.length === 1) return null;
    return lines.join('\n');
  }

  if (input.turnPlan.customerNeed === 'wifi_channel_diagnostics') {
    const diagnosticResult = findSuccessfulMcpResult(input.toolResults, /\b(scan_wifi_neighbors|get_wifi_scan_cached|wifi|channel|canal)\b/i);
    if (!diagnosticResult) return null;
    return buildWifiChannelAnalysisResponse(diagnosticResult.output, {
      isCached: /\bget_wifi_scan_cached\b/i.test(String(diagnosticResult.toolName)),
    });
  }

  if (input.turnPlan.customerNeed === 'external_lookup') {
    const sgpResult = latestSuccessfulSgpPanelFromResults(input.toolResults);
    return sgpResult ? buildOperationalSgpResponse(sgpResult) : null;
  }

  if (input.turnPlan.customerNeed === 'generic_external_lookup') {
    const toolName = String(input.turnPlan.metadata.selectedGenericExternalLookupTool || '');
    const toolResult = toolName ? latestToolResult(input.toolResults, toolName) : null;
    if (!toolResult || toolResult.status !== 'success') return null;
    if (toolName === 'sgp_fetch_contact_panel_data') return buildOperationalSgpResponse(toolResult);
    return buildGenericMcpLookupResponse(toolResult);
  }

  if (input.turnPlan.customerNeed === 'generic_external_action') {
    const toolName = String(input.turnPlan.metadata.selectedGenericExternalActionTool || '');
    const toolResult = toolName ? latestToolResult(input.toolResults, toolName) : null;
    if (!toolResult) return null;
    if (
      toolResult.status === 'rejected' &&
      toolResult.error?.includes('[tool_policy:confirmation_required]')
    ) {
      return String(
        input.turnPlan.metadata.genericExternalActionConfirmationPrompt ||
        'Preciso da sua confirmacao explicita antes de executar essa acao.'
      );
    }
    if (toolResult.status !== 'success') {
      return 'Nao consegui executar a acao. Para evitar duplicidade, nao vou repeti-la automaticamente. Posso verificar o ocorrido ou encaminhar para atendimento humano.';
    }
    return buildGenericMcpLookupResponse(toolResult) || 'Pronto, a acao confirmada foi executada com sucesso.';
  }

  if (input.turnPlan.customerNeed === 'order_status_lookup') {
    const toolName = String(input.turnPlan.metadata.selectedOrderStatusTool || '');
    const mcpResult = toolName
      ? findSuccessfulMcpResultByToolName(input.toolResults, toolName)
      : findSuccessfulMcpResult(input.toolResults, /\b(order_status|tracking|pedido|protocolo|ticket|request)\b/i);
    return mcpResult ? buildGenericMcpStatusResponse(mcpResult) : null;
  }

  return null;
}
