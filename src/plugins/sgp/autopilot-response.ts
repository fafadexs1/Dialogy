// Optional SGP plugin response adapters. The universal runtime imports this only as an opt-in adapter.
import type { AgentToolAction, AgentToolExecutionResult } from '@/services/agent-tools/types';

function onlyDigits(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '');
}

function normalizeLookupText(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/(\d)\s*\/\s*(\d)/g, '$1x$2')
    .replace(/\b(?:r|rua)\s*(\d+(?:x\d+)*)\b/g, ' rua $1 ')
    .replace(/\b(?:q|qd|qdr|quadra)\s*(\d+(?:x\d+)*)\b/g, ' quadra $1 ')
    .replace(/\b(?:l|lt|lte|lote)\s*(\d+(?:x\d+)*)\b/g, ' lote $1 ')
    .replace(/\b(?:c|cs|csa|casa)\s*(\d+(?:x\d+)*)\b/g, ' casa $1 ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const ADDRESS_LOOKUP_STOP_WORDS = new Set([
  'a', 'ao', 'aos', 'as', 'da', 'das', 'de', 'do', 'dos', 'e', 'em', 'meu', 'minha',
  'na', 'nas', 'no', 'nos', 'o', 'os', 'para', 'por', 'pra', 'pro', 'qual', 'que',
  'quero', 'seria', 'tratar',
]);

function tokenizeAddressLookup(value: unknown): string[] {
  return normalizeLookupText(value)
    .split(' ')
    .filter((token) => token && !ADDRESS_LOOKUP_STOP_WORDS.has(token));
}

function getStructuredAddressComponents(value: unknown): Record<string, string[]> {
  const normalized = ` ${normalizeLookupText(value)} `;
  const components: Record<string, string[]> = {};
  for (const key of ['rua', 'quadra', 'lote', 'casa']) {
    const matches = [...normalized.matchAll(new RegExp(`\\b${key}\\s+(\\d+(?:x\\d+)*)\\b`, 'g'))]
      .map((match) => match[1]);
    if (matches.length > 0) components[key] = matches;
  }
  return components;
}

function hasConflictingAddressComponents(
  contextComponents: Record<string, string[]>,
  addressComponents: Record<string, string[]>
): boolean {
  return Object.entries(contextComponents).some(([key, contextValues]) => {
    const addressValues = addressComponents[key];
    return Array.isArray(addressValues) &&
      addressValues.length > 0 &&
      !contextValues.some((value) => addressValues.includes(value));
  });
}

function getAddressLabel(contract: any): string {
  return String(
    contract?.addressLabel ||
    contract?.address ||
    contract?.endereco ||
    contract?.installationAddress ||
    contract?.serviceAddress ||
    ''
  ).trim();
}

export function resolveContractIdFromAddress(contracts: any[], contextText: string): string | null {
  const contextTokens = new Set(tokenizeAddressLookup(contextText));
  const contextComponents = getStructuredAddressComponents(contextText);
  if (contextTokens.size < 2) return null;

  const candidates = contracts.flatMap((contract: any) => {
    const id = String(contract?.id ?? '').trim();
    const address = getAddressLabel(contract);
    const addressTokens = new Set(tokenizeAddressLookup(address));
    if (!id || addressTokens.size === 0) return [];
    if (hasConflictingAddressComponents(contextComponents, getStructuredAddressComponents(address))) return [];

    const matchingTokens = [...contextTokens].filter((token) => addressTokens.has(token));
    const numericMatches = matchingTokens.filter((token) => /^\d+$/.test(token)).length;
    const textMatches = matchingTokens.length - numericMatches;
    const score = numericMatches * 3 + textMatches;
    if (matchingTokens.length < 2 || (numericMatches === 0 && textMatches < 3)) return [];

    return [{ id, score }];
  }).sort((left, right) => right.score - left.score);

  if (candidates.length === 0) return null;
  if (candidates[1]?.score === candidates[0].score) return null;
  return candidates[0].id;
}

function getContractsFromToolResults(results: AgentToolExecutionResult[]): any[] {
  const panelResult = [...results].reverse().find(
    (result) => result.toolName === 'sgp_fetch_contact_panel_data' && result.status === 'success'
  );
  const contracts = (panelResult?.output as any)?.contracts;
  return Array.isArray(contracts) ? contracts : [];
}

export function getScopedContractIdFromToolResults(results: AgentToolExecutionResult[]): string | null {
  for (const result of results) {
    if (result.toolName !== 'sgp_fetch_contact_panel_data' || result.status !== 'success') continue;
    if (result.input.type !== 'sgp_fetch_contact_panel_data') continue;
    const contractId = String(result.input.payload?.contractId ?? '').trim();
    if (/^\d+$/.test(contractId)) return contractId;
  }

  return null;
}

export function resolveFocusedContractId(
  results: AgentToolExecutionResult[],
  contextText: string
): string | null {
  return extractFocusedContractId(contextText) ||
    resolveContractIdFromAddress(getContractsFromToolResults(results), contextText);
}

export function extractRequestedContractId(...values: Array<string | null | undefined>): string | null {
  return extractFocusedContractId(...values);
}

export function extractFocusedContractId(...values: Array<string | null | undefined>): string | null {
  const text = values
    .filter(Boolean)
    .join(' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  const matches = [
    ...[...text.matchAll(
      /\bcontrato\b(?:\s+(?:id|numero|nro|no|em|questao|seria|e|eh|o)){0,6}\s*[:#-]?\s*(\d+)\b/gi
    )].map((match) => ({ id: match[1], index: match.index ?? -1 })),
    ...[...text.matchAll(
      /\b(\d+)\b\s+(?:(?:e|eh|seria)\s+)?(?:(?:este|esse|o)\s+)?contrato\b/gi
    )].map((match) => ({ id: match[1], index: match.index ?? -1 })),
  ].sort((left, right) => left.index - right.index);
  const latestMatch = matches.at(-1);
  if (!latestMatch || latestMatch.index == null) return null;

  const latestClearFocusIndex = Math.max(
    ...[...text.matchAll(
      /\b(?:nao\s+(?:quero|consulte|verifique|trate|fale|e|eh)\s+(?:mais\s+)?(?:desse|deste|esse|este|o|do)?\s*contrato|(?:trocar|mudar|outro)\b[^\n.!?]{0,30}\bcontrato)\b/gi
    )].map((match) => match.index ?? -1),
    -1
  );
  if (latestClearFocusIndex > latestMatch.index) return null;

  const prefix = text.slice(Math.max(0, latestMatch.index - 40), latestMatch.index);
  if (/\bnao\s+(?:(?:e|eh|seria|quero|consulte|verifique)\s+)(?:o\s+)?$/.test(prefix)) {
    return null;
  }

  return latestMatch.id || null;
}

export function scopeSgpLookupActionsToFocusedContract(
  actions: AgentToolAction[],
  ...contextValues: Array<string | null | undefined>
): AgentToolAction[] {
  const contractId = extractFocusedContractId(...contextValues);
  if (!contractId) return actions;

  return actions.map((action) => {
    if (action.type !== 'sgp_fetch_contact_panel_data' || action.payload?.contractId) {
      return action;
    }

    return {
      ...action,
      payload: {
        ...(action.payload || {}),
        contractId,
      },
    };
  });
}

export function scopeSgpLookupActionsToAddressedContract(
  actions: AgentToolAction[],
  results: AgentToolExecutionResult[],
  contextText: string
): AgentToolAction[] {
  const contractId = resolveFocusedContractId(results, contextText);
  if (!contractId) return actions;

  return actions.map((action) => {
    if (action.type !== 'sgp_fetch_contact_panel_data' || action.payload?.contractId) {
      return action;
    }

    return {
      ...action,
      payload: {
        ...(action.payload || {}),
        contractId,
      },
    };
  });
}

export function hasPromisedOperationalLookup(response: string | null | undefined): boolean {
  if (!response) return false;
  const normalized = response
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  const promisesLookup = /\b(vou|irei|posso|deixa eu|so um|um instante|aguarde)\b/.test(normalized) ||
                         /\b(verificar|consultar|checar|validar|conferir|olhada|olhadinha)\b/.test(normalized);

  const mentionsSystem = /\b(status|contrato|cadastro|sistema|sgp|conexao|fatura|pendencia|financeir|internet|pontos|cpf|cnpj)\b/.test(normalized);

  // If they just say "um momento" or "aguarde", that's enough of a promise if the system is also mentioned
  const explicitWait = /\b(um momento|um instante|aguarde|so um minuto|so um momento)\b/.test(normalized);

  return (promisesLookup && mentionsSystem) || explicitWait;
}

export function ensurePromisedSgpLookupAction(input: {
  response: string | null | undefined;
  customerMessage: string;
  actions: AgentToolAction[];
  enabledToolNames: string[];
}): AgentToolAction[] {
  if (!hasPromisedOperationalLookup(input.response)) {
    return input.actions;
  }

  if (!input.enabledToolNames.includes('sgp_fetch_contact_panel_data')) {
    return input.actions;
  }

  const alreadyHasSgpLookup = input.actions.some((action) => (
    action.type === 'sgp_fetch_contact_panel_data' || action.type === 'sgp_fetch_contracts'
  ));
  if (alreadyHasSgpLookup) {
    return input.actions;
  }

  return [
    {
      type: 'sgp_fetch_contact_panel_data',
      reason: 'Resposta prometeu consultar dados operacionais antes de responder ao cliente.',
      payload: {},
    },
    ...input.actions,
  ];
}

function hasSgpLookupAction(actions: AgentToolAction[]): boolean {
  return actions.some((action) => (
    action.type === 'sgp_fetch_contact_panel_data' || action.type === 'sgp_fetch_contracts'
  ));
}

function hasRouterRebootIntent(...values: Array<string | null | undefined>): boolean {
  const normalized = values
    .filter(Boolean)
    .join(' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  return (
    /\b(reinici|reinicializ|reset|reboot)\w*/.test(normalized) &&
    /\b(roteador|router|conexao|internet|contrato)\b/.test(normalized)
  );
}

export function ensureProcedureSgpLookupAction(input: {
  response: string | null | undefined;
  customerMessage: string;
  actions: AgentToolAction[];
  enabledToolNames: string[];
  knowledgeToolProcedures: string;
}): AgentToolAction[] {
  if (!/(?:reboot|restart|reinici)/i.test(input.knowledgeToolProcedures)) {
    return input.actions;
  }

  if (!hasRouterRebootIntent(input.customerMessage, input.response)) {
    return input.actions;
  }

  if (!input.enabledToolNames.includes('sgp_fetch_contact_panel_data')) {
    return input.actions;
  }

  if (hasSgpLookupAction(input.actions)) {
    return input.actions;
  }

  return [
    {
      type: 'sgp_fetch_contact_panel_data',
      reason: 'Procedimento de reinicializacao de roteador precisa consultar SGP para obter o IPv4 do contrato.',
      payload: {},
    },
    ...input.actions,
  ];
}

function formatContractFinancialStatus(summary: any): string {
  const overdueInvoices = Number(summary?.overdueInvoices || 0);
  const openInvoices = Number(summary?.openInvoices || 0);

  if (overdueInvoices > 0) {
    return `Encontrei ${overdueInvoices} fatura(s) vencida(s) nesse contrato.`;
  }

  if (openInvoices > 0) {
    return `Encontrei ${openInvoices} fatura(s) em aberto nesse contrato.`;
  }

  return 'Nao encontrei faturas vencidas nem em aberto nesse contrato.';
}

function formatContractConnectionStatus(contract: any): string {
  if (!contract) return 'sem status claro de conexao';
  if (contract.connectionStatus === 'online') return 'online';
  if (contract.connectionStatus === 'offline') return 'offline';
  return 'sem status claro de conexao';
}

function pluralize(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural;
}

function formatContractCountSummary(contractsCount: number, onlineContracts: number): string {
  if (contractsCount === 0) return 'Nao encontrei contratos ativos no cadastro.';
  if (contractsCount === 1) {
    return onlineContracts === 1
      ? 'Encontrei 1 contrato online.'
      : 'Encontrei 1 contrato no cadastro.';
  }

  return `Encontrei ${contractsCount} contratos no cadastro; ${onlineContracts} online.`;
}

function formatOpenInvoiceSummary(count: number): string {
  if (count <= 0) return 'Nao encontrei faturas vencidas nem em aberto.';
  return `Ha ${count} ${pluralize(count, 'fatura', 'faturas')} em aberto.`;
}

function asksForFinancialSummary(contextText: string): boolean {
  const normalized = normalizeForIntent(contextText);
  return /\b(faturas?|boletos?|pix|pagamento|pagar|pendencias?|pendencia|debito|financeiro|cobranca|cobrancas?|vencid[ao]s?)\b/.test(normalized);
}

function asksForContractOverview(contextText: string): boolean {
  const normalized = contextText
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  const asksQuantityOrList = /\b(quais|quantos?|listar|lista|mostra|mostrar|ver|tenho)\b/.test(normalized);
  const mentionsContracts = /\b(contratos?|pontos? de internet|pontos?|internet)\b/.test(normalized);

  return asksQuantityOrList && mentionsContracts;
}

function formatContractOverview(contracts: any[], output: any, contextText = ''): string {
  const onlineContracts = Number(output.onlineContracts || 0);
  const overdueInvoices = Number(output.overdueInvoices || 0);
  const openInvoices = Number(output.openInvoices || 0);
  const visibleContracts = contracts.slice(0, 8);
  const contractLines = visibleContracts.map((contract: any) => {
    const id = contract.id ? `Contrato ${contract.id}` : 'Contrato';
    const plan = contract.planDescription || contract.statusLabel || 'sem descricao do plano';
    const connection = formatContractConnectionStatus(contract);
    const status = contract.statusLabel ? `, status ${contract.statusLabel}` : '';
    return `- ${id}: ${plan}, conexao ${connection}${status}.`;
  });

  return [
    `Consultei seu cadastro no sistema. ${formatContractCountSummary(contracts.length, onlineContracts)}`,
    contractLines.join('\n'),
    contracts.length > visibleContracts.length ? `Mostrei os ${visibleContracts.length} primeiros contratos.` : '',
    asksForFinancialSummary(contextText)
      ? overdueInvoices > 0
        ? `Tambem ha ${overdueInvoices} ${pluralize(overdueInvoices, 'fatura vencida', 'faturas vencidas')}.`
        : formatOpenInvoiceSummary(openInvoices)
      : '',
  ].filter(Boolean).join('\n');
}

function asksForContractAddress(contextText: string): boolean {
  const normalized = contextText
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  return /\b(endereco|address|localizacao|localizaçao|local|instalacao|instalaçao)\b/.test(normalized) &&
    /\b(contrato|cadastro|meu|minha|instalacao|instalaçao|ponto)\b/.test(normalized);
}

const getContractAddressLabel = getAddressLabel;

function findRequestedOrPrimaryContract(contracts: any[], requestedContractId: string | null): any | null {
  if (requestedContractId) {
    const requestedDigits = onlyDigits(requestedContractId);
    return contracts.find((contract: any) => onlyDigits(contract?.id) === requestedDigits) || null;
  }

  return contracts.find((contract: any) => contract?.connectionStatus === 'online') ||
    contracts[0] ||
    null;
}

function formatContractAddressResponse(contracts: any[], requestedContractId: string | null): string | null {
  const contract = findRequestedOrPrimaryContract(contracts, requestedContractId);
  if (!contract) {
    return 'Consultei seu cadastro no sistema, mas nao encontrei contrato para conferir o endereco.';
  }

  const address = getContractAddressLabel(contract);
  const contractLabel = contract.id ? `contrato ${contract.id}` : 'contrato';
  if (!address || normalizeForIntent(address) === 'endereco nao informado') {
    return `Consultei o ${contractLabel}, mas o endereco nao veio informado no cadastro.`;
  }

  return `O endereco do ${contractLabel} e: ${address}.`;
}

type OperationalFieldRequest = {
  label: string;
  keys: string[];
  scope: 'contract' | 'output' | 'invoice';
};

const OPERATIONAL_FIELD_REQUESTS: OperationalFieldRequest[] = [
  { label: 'plano', keys: ['planDescription', 'plan', 'plano', 'servicePlan'], scope: 'contract' },
  { label: 'status do contrato', keys: ['statusLabel', 'status', 'rawStatus', 'contractStatus'], scope: 'contract' },
  { label: 'status da conexao', keys: ['connectionStatus', 'connection', 'conexao', 'serviceStatus'], scope: 'contract' },
  { label: 'IPv4', keys: ['ip', 'ipv4', 'clientIp', 'radIp'], scope: 'contract' },
  { label: 'IPv6', keys: ['ipv6', 'delegatedIpv6', 'framedIpv6Prefix'], scope: 'contract' },
  { label: 'login', keys: ['login', 'username', 'user', 'pppoeLogin'], scope: 'contract' },
  { label: 'MAC', keys: ['mac', 'macAddress'], scope: 'contract' },
  { label: 'serial', keys: ['serial', 'serialNumber', 'onuSerial'], scope: 'contract' },
  { label: 'CTO', keys: ['cto', 'box', 'splitter'], scope: 'contract' },
  { label: 'localizacao', keys: ['geoLocation', 'location', 'coordinates', 'latLong'], scope: 'contract' },
  { label: 'data de cadastro do contrato', keys: ['contractDate', 'createdAt', 'dataCadastro'], scope: 'contract' },
  { label: 'detalhes da conexao', keys: ['detailsLabel', 'connectionDetails'], scope: 'contract' },
  { label: 'contratos online', keys: ['onlineContracts'], scope: 'output' },
  { label: 'faturas em aberto', keys: ['openInvoices'], scope: 'output' },
  { label: 'faturas vencidas', keys: ['overdueInvoices'], scope: 'output' },
  { label: 'valor da fatura', keys: ['correctedAmount', 'amount', 'valor', 'value'], scope: 'invoice' },
  { label: 'vencimento da fatura', keys: ['dueDate', 'vencimento', 'dataVencimento'], scope: 'invoice' },
];

const SENSITIVE_FIELD_NAME = /\b(token|secret|senha|password|authorization|api[_-]?key|bearer|cookie|session|jwt)\b/i;

function normalizeFieldName(value: string): string {
  return normalizeForIntent(value).replace(/[^a-z0-9]/g, '');
}

function isSensitiveFieldName(value: string): boolean {
  return SENSITIVE_FIELD_NAME.test(value);
}

function formatFieldValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'sim' : 'nao';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) {
    return value
      .map(formatFieldValue)
      .filter(Boolean)
      .slice(0, 5)
      .join(', ');
  }
  return '';
}

function formatCustomerFacingDate(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';

  const dateTime = raw.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?$/);
  if (dateTime) {
    return `${dateTime[3]}/${dateTime[2]}/${dateTime[1]} ${dateTime[4]}:${dateTime[5]}`;
  }

  const dateOnly = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) {
    return `${dateOnly[3]}/${dateOnly[2]}/${dateOnly[1]}`;
  }

  return raw;
}

function formatOperationalFieldValue(request: OperationalFieldRequest, value: unknown): string {
  const isDateField = request.keys.some((key) => /date|data|vencimento|createdat/i.test(key));
  return isDateField ? formatCustomerFacingDate(value) : formatFieldValue(value);
}

function findNestedFieldValue(source: unknown, keys: string[], depth = 0): unknown {
  if (!source || typeof source !== 'object' || depth > 4) return null;
  const wantedKeys = new Set(keys.map(normalizeFieldName));
  const entries = Object.entries(source as Record<string, unknown>);

  for (const wantedKey of wantedKeys) {
    const entry = entries.find(([key]) => !isSensitiveFieldName(key) && normalizeFieldName(key) === wantedKey);
    if (entry) return entry[1];
  }

  for (const [key, value] of entries) {
    if (isSensitiveFieldName(key)) continue;
    if (!value || typeof value !== 'object') continue;
    const nested = findNestedFieldValue(value, keys, depth + 1);
    if (nested !== null && nested !== undefined && formatFieldValue(nested)) return nested;
  }

  return null;
}

function mentionsFieldRequest(contextText: string, request: OperationalFieldRequest): boolean {
  const normalized = normalizeForIntent(contextText);
  if (
    request.scope === 'output' &&
    !/\b(quantos?|quantas?|numero|número|total|qtd|quantidade)\b/.test(normalized)
  ) {
    return false;
  }

  const normalizedWords = new Set(normalized.split(/[^a-z0-9]+/).filter(Boolean));
  const labelWords = request.label
    .split(/\s+/)
    .map((word) => normalizeFieldName(word))
    .filter((word) => word.length > 2 && !['contrato', 'fatura'].includes(word));
  if (labelWords.length > 0 && labelWords.every((word) => normalizedWords.has(word))) return true;

  return request.keys.some((key) => {
    const normalizedKey = normalizeFieldName(key);
    if (normalizedKey.length <= 2) {
      return normalizedWords.has(normalizedKey);
    }
    return normalizeFieldName(normalized).includes(normalizedKey);
  });
}

function buildDynamicFieldRequest(contextText: string): OperationalFieldRequest | null {
  const normalized = normalizeForIntent(contextText);
  const match = normalized.match(/\bqual(?:\s+e|\s+eh|\s+é)?\s+(?:o|a|os|as)?\s*([a-z0-9_ -]{3,45}?)(?:\s+(?:do|da|de|deste|desse|meu|minha)\b|[?.!]|$)/) ||
    normalized.match(/\b(?:informe|informar|me diga|mostra|mostrar|ver)\s+(?:o|a|os|as)?\s*([a-z0-9_ -]{3,45}?)(?:\s+(?:do|da|de|deste|desse|meu|minha)\b|[?.!]|$)/);
  const rawField = match?.[1]?.trim();
  if (!rawField || isSensitiveFieldName(rawField)) return null;
  if (/\b(contrato|cadastro|sistema|dados|informacao|informaçoes|informacoes)\b/.test(rawField)) return null;

  return {
    label: rawField,
    keys: [rawField],
    scope: /\bfatura|boleto|pagamento\b/.test(normalized) ? 'invoice' : 'contract',
  };
}

function formatOperationalFieldResponse(input: {
  output: any;
  contracts: any[];
  requestedContractId: string | null;
  contextText: string;
}): string | null {
  const configuredRequest = OPERATIONAL_FIELD_REQUESTS.find((request) => mentionsFieldRequest(input.contextText, request));
  const request = configuredRequest || buildDynamicFieldRequest(input.contextText);
  if (!request) return null;

  if (request.scope === 'output') {
    const value = formatFieldValue(findNestedFieldValue(input.output, request.keys));
    return value ? `${request.label}: ${value}.` : null;
  }

  if (request.scope === 'invoice') {
    const invoices = findPayableInvoices(input.output, input.requestedContractId);
    if (invoices.length === 0) return 'Consultei seu cadastro no sistema, mas nao encontrei faturas em aberto para responder essa informacao.';
    const lines = invoices.slice(0, 5).map((invoice, index) => {
      const value = formatOperationalFieldValue(request, findNestedFieldValue(invoice, request.keys));
      return value ? `${formatInvoiceLabel(invoice, index)}: ${request.label} ${value}.` : '';
    }).filter(Boolean);
    return lines.length > 0
      ? lines.join('\n')
      : `Consultei as faturas em aberto, mas o campo ${request.label} nao veio informado.`;
  }

  const contract = findRequestedOrPrimaryContract(input.contracts, input.requestedContractId);
  if (!contract) return 'Consultei seu cadastro no sistema, mas nao encontrei contrato para responder essa informacao.';

  const value = formatOperationalFieldValue(request, findNestedFieldValue(contract, request.keys));
  const contractLabel = contract.id ? `contrato ${contract.id}` : 'contrato';
  if (!value) return `Consultei o ${contractLabel}, mas o campo ${request.label} nao veio informado.`;

  return `O ${request.label} do ${contractLabel} e: ${value}.`;
}

function normalizeForIntent(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

type PaymentArtifactRequest = {
  wantsPix: boolean;
  wantsPaymentLink: boolean;
  wantsBarcode: boolean;
  wantsGenericInvoiceCopy: boolean;
  wantsAnyPaymentArtifact: boolean;
};

function detectPaymentArtifactRequest(contextText: string): PaymentArtifactRequest {
  const normalized = normalizeForIntent(contextText);
  const wantsPix = /\bpix\b/.test(normalized);
  const asksToSendInvoice = (
    /\b(manda|mandar|envia|enviar|passa|passar|informa|informar|preciso|quero|gerar|emitir)\b.{0,60}\b(boleto|fatura)\b/.test(normalized) ||
    /\b(boleto|fatura)\b.{0,60}\b(manda|mandar|envia|enviar|passa|passar|informa|informar|gerar|emitir)\b/.test(normalized)
  );
  const wantsBarcode = /\b(linha digitavel|codigo de barras|barcode)\b/.test(normalized);
  const wantsPaymentLink = (
    (/\b(link|segunda via|2a via|pagamento|pagar)\b/.test(normalized) || asksToSendInvoice) &&
    !wantsPix &&
    !wantsBarcode
  );

  return {
    wantsPix,
    wantsPaymentLink,
    wantsBarcode,
    wantsGenericInvoiceCopy: asksToSendInvoice && !wantsPix && !wantsBarcode,
    wantsAnyPaymentArtifact: wantsPix || wantsPaymentLink || wantsBarcode,
  };
}

function isOpenPayableInvoice(invoice: any): boolean {
  if (!invoice || invoice.isCancelled || invoice.isPaid) return false;
  if (invoice.isOpen === true) return true;
  const status = normalizeForIntent(String(invoice.status || ''));
  return /\b(aberto|open|pendente|pending|vencido|overdue)\b/.test(status);
}

function findPayableInvoices(output: any, requestedContractId: string | null): any[] {
  const requestedDigits = requestedContractId ? onlyDigits(requestedContractId) : null;
  const directInvoices = Array.isArray(output.invoices) ? output.invoices : [];
  const groupedInvoices = (Array.isArray(output.invoiceGroups) ? output.invoiceGroups : [])
    .flatMap((group: any) => (
      Array.isArray(group?.invoices)
        ? group.invoices
        : Array.isArray(group?.invoiceSections)
          ? group.invoiceSections.flatMap((section: any) => Array.isArray(section?.invoices) ? section.invoices : [])
          : []
    ));

  const seen = new Set<string>();
  return [...directInvoices, ...groupedInvoices]
    .filter(isOpenPayableInvoice)
    .filter((invoice: any) => !requestedDigits || onlyDigits(invoice.contractId) === requestedDigits)
    .filter((invoice: any) => {
      const key = String(invoice.id || invoice.paymentLink || invoice.digitableLine || invoice.pixCode || JSON.stringify(invoice));
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a: any, b: any) => String(a.dueDate || '').localeCompare(String(b.dueDate || '')));
}

function formatMoney(value: unknown): string {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '';
  return amount
    .toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
    .replace(/\u00a0/g, ' ');
}

function formatInvoiceTitle(index: number): string {
  if (index === 0) return '*Fatura atual*';
  if (index === 1) return '*Proxima fatura*';
  return `*Fatura ${index + 1}*`;
}

function formatInvoiceLabel(invoice: any, index: number): string {
  const parts = [
    invoice.dueDate ? `vencimento ${formatCustomerFacingDate(invoice.dueDate)}` : '',
    formatMoney(invoice.correctedAmount ?? invoice.amount),
  ].filter(Boolean);
  return `Fatura ${invoice.id || index + 1}${parts.length ? ` (${parts.join(', ')})` : ''}`;
}

function formatInvoiceDetails(invoice: any, index: number, request: PaymentArtifactRequest): string[] {
  const lines = [formatInvoiceTitle(index)];
  if (invoice.id) lines.push(`Numero: ${invoice.id}`);
  if (invoice.dueDate) lines.push(`Vencimento: ${formatCustomerFacingDate(invoice.dueDate)}`);
  const amount = formatMoney(invoice.correctedAmount ?? invoice.amount);
  if (amount) lines.push(`Valor: ${amount}`);

  if (request.wantsPix && invoice.pixCode) {
    lines.push(`PIX copia e cola: ${invoice.pixCode}`);
  }
  if (request.wantsPaymentLink && invoice.paymentLink) {
    lines.push('Link para pagamento:');
    lines.push(invoice.paymentLink);
  }
  if (request.wantsBarcode && (invoice.digitableLine || invoice.barcode)) {
    lines.push(`Linha digitavel: ${invoice.digitableLine || invoice.barcode}`);
  }

  if (lines.length <= 4 && request.wantsGenericInvoiceCopy) {
    if (invoice.pixCode) {
      lines.push(`PIX copia e cola: ${invoice.pixCode}`);
    } else if (invoice.paymentLink) {
      lines.push('Link para pagamento:');
      lines.push(invoice.paymentLink);
    } else if (invoice.digitableLine || invoice.barcode) {
      lines.push(`Linha digitavel: ${invoice.digitableLine || invoice.barcode}`);
    }
  }

  return lines;
}

function formatPaymentArtifactsFromInvoices(invoices: any[], request: PaymentArtifactRequest): string | null {
  if (!request.wantsAnyPaymentArtifact) return null;
  if (invoices.length === 0) {
    return 'Consultei seu cadastro no sistema, mas nao encontrei faturas em aberto com dados de pagamento disponiveis para enviar agora.';
  }

  const sections = invoices.slice(0, 5)
    .map((invoice: any, index) => formatInvoiceDetails(invoice, index, request))
    .filter((lines) => lines.some((line) => (
      /^PIX copia e cola:|^Linha digitavel:|^https?:\/\//i.test(line)
    )));

  if (sections.length === 0) {
    return 'Consultei as faturas em aberto, mas elas nao vieram com o dado de pagamento solicitado. Vou evitar te passar uma informacao incompleta.';
  }

  return [
    invoices.length === 1
      ? 'Encontrei 1 fatura em aberto para pagamento.'
      : `Encontrei ${invoices.length} faturas em aberto para pagamento.`,
    sections.map((lines) => lines.join('\n')).join('\n\n'),
    invoices.length > 5 ? 'Mostrei as 5 primeiras faturas em aberto.' : '',
  ].filter(Boolean).join('\n\n');
}

export function buildSgpResponseFromToolResults(
  results: AgentToolExecutionResult[],
  contextText = ''
): string | null {
  const panelResult = results.find(
    (result) => result.toolName === 'sgp_fetch_contact_panel_data' && result.status === 'success'
  );
  const output = panelResult?.output as any;
  if (!output) return null;

  const contracts = Array.isArray(output.contracts) ? output.contracts : [];
  const invoiceGroups = Array.isArray(output.invoiceGroups) ? output.invoiceGroups : [];
  const requestedContractId = resolveFocusedContractId(results, contextText);
  const paymentArtifactRequest = detectPaymentArtifactRequest(contextText);
  const paymentArtifactResponse = formatPaymentArtifactsFromInvoices(
    findPayableInvoices(output, requestedContractId),
    paymentArtifactRequest
  );
  if (paymentArtifactResponse) return paymentArtifactResponse;

  if (asksForContractAddress(contextText)) {
    return formatContractAddressResponse(contracts, requestedContractId);
  }

  if (!requestedContractId && asksForContractOverview(contextText)) {
    return formatContractOverview(contracts, output, contextText);
  }

  const operationalFieldResponse = formatOperationalFieldResponse({
    output,
    contracts,
    requestedContractId,
    contextText,
  });
  if (operationalFieldResponse) return operationalFieldResponse;

  if (requestedContractId) {
    const requestedDigits = onlyDigits(requestedContractId);
    const requestedGroup = invoiceGroups.find((group: any) => (
      onlyDigits(group?.contractId || group?.key) === requestedDigits
    ));
    const requestedContract = requestedGroup?.contract || contracts.find((contract: any) => (
      onlyDigits(contract?.id) === requestedDigits
    ));

    if (requestedGroup || requestedContract) {
      const statusLabel = requestedContract?.statusLabel ? ` e status ${requestedContract.statusLabel}` : '';
      return [
        `Consultei o contrato ${requestedContractId} no sistema.`,
        requestedContract ? `A conexao esta ${formatContractConnectionStatus(requestedContract)}${statusLabel}.` : '',
        requestedGroup ? formatContractFinancialStatus(requestedGroup.summary) : 'Nao encontrei faturas vinculadas a esse contrato.',
      ].filter(Boolean).join(' ');
    }

    return `Consultei o sistema, mas nao encontrei o contrato ${requestedContractId} no cadastro desse cliente.`;
  }

  const onlineContracts = Number(output.onlineContracts || 0);
  const overdueInvoices = Number(output.overdueInvoices || 0);
  const openInvoices = Number(output.openInvoices || 0);
  const firstContract = contracts[0];
  const statusLabel = firstContract?.connectionStatus === 'online'
    ? 'online'
    : firstContract?.connectionStatus === 'offline'
      ? 'offline'
      : 'sem status claro de conexao';

  return [
    `Consultei seu cadastro no sistema. ${formatContractCountSummary(contracts.length, onlineContracts)}`,
    firstContract && !(contracts.length === 1 && onlineContracts === 1 && statusLabel === 'online')
      ? `O contrato consta ${statusLabel}.`
      : '',
    asksForFinancialSummary(contextText)
      ? overdueInvoices > 0
        ? `Tambem ha ${overdueInvoices} ${pluralize(overdueInvoices, 'fatura vencida', 'faturas vencidas')}.`
        : formatOpenInvoiceSummary(openInvoices)
      : 'Como posso te ajudar?',
  ].filter(Boolean).join(' ');
}

function extractMcpRebootToolName(knowledgeToolProcedures: string): string | null {
  const match = knowledgeToolProcedures.match(/Tool resolvida:\s*(mcp:[^\s]*(?:reboot|restart|reinici)[^\s]*)\b/i);
  return match?.[1] || null;
}

function extractTargetContractFromSgpResults(results: AgentToolExecutionResult[], contextText: string): any | null {
  const panelResult = results.find(
    (result) => result.toolName === 'sgp_fetch_contact_panel_data' && result.status === 'success'
  );
  const output = panelResult?.output as any;
  if (!output) return null;

  const contracts = Array.isArray(output.contracts) ? output.contracts : [];
  const requestedContractId = resolveFocusedContractId(results, contextText);
  if (requestedContractId) {
    const requestedDigits = onlyDigits(requestedContractId);
    return contracts.find((contract: any) => onlyDigits(contract?.id) === requestedDigits) || null;
  }

  return contracts.find((contract: any) => contract?.connectionStatus === 'online' && contract?.ip) ||
    contracts.find((contract: any) => contract?.ip) ||
    null;
}

export function buildRouterRebootActionFromSgpResults(input: {
  toolResults: AgentToolExecutionResult[];
  customerMessage: string;
  response: string | null | undefined;
  chatHistory?: string | null;
  knowledgeToolProcedures: string;
}): AgentToolAction | null {
  if (!hasRouterRebootIntent(input.customerMessage, input.response)) return null;

  const toolName = extractMcpRebootToolName(input.knowledgeToolProcedures);
  if (!toolName) return null;

  const contract = extractTargetContractFromSgpResults(
    input.toolResults,
    `${input.chatHistory || ''}\n${input.customerMessage || ''}\n${input.response || ''}`
  );
  const clientIp = String(contract?.ip || '').trim();
  if (!clientIp) return null;

  return {
    type: 'mcp_call_tool',
    reason: `Reinicializar roteador do contrato ${contract.id || 'selecionado'} usando IPv4 retornado pelo SGP.`,
    payload: {
      toolName,
      arguments: {
        client_ip: clientIp,
        reason: `Cliente solicitou reinicializacao do roteador${contract.id ? ` do contrato ${contract.id}` : ''}.`,
      },
    },
  };
}

export function buildMcpCustomerResponseFromToolResults(results: AgentToolExecutionResult[]): string | null {
  const rebootResult = results.find((result) => (
    /(?:reboot|restart|reinici)/i.test(result.toolName) && result.status === 'success'
  ));
  if (!rebootResult) return null;

  return 'Pronto, enviei o comando de reinicializacao para o roteador. Aguarde alguns minutos enquanto o equipamento reinicia e a conexao volta a estabilizar.';
}

export function buildToolFailureResponse(results: AgentToolExecutionResult[], response: string): string | null {
  const unboundConfirmation = results.find((result) =>
    result.status === 'rejected' &&
    result.error?.includes('[tool_policy:confirmation_context_missing]')
  );
  if (unboundConfirmation) {
    const toolName = unboundConfirmation.input.type === 'mcp_call_tool'
      ? String(unboundConfirmation.input.payload?.toolName || '')
      : unboundConfirmation.toolName;
    if (/(?:reboot|restart|reinici)/i.test(toolName)) {
      return 'Entendi sua confirmacao, mas nao consegui vincula-la com seguranca. Para autorizar, escreva: pode reiniciar o roteador agora.';
    }
    return 'Entendi sua confirmacao, mas nao consegui vincula-la com seguranca. Por favor, informe explicitamente qual alteracao posso executar.';
  }

  const confirmationRequired = results.find((result) =>
    result.status === 'rejected' &&
    result.error?.includes('[tool_policy:confirmation_required]')
  );
  if (confirmationRequired) {
    const toolName = confirmationRequired.input.type === 'mcp_call_tool'
      ? String(confirmationRequired.input.payload?.toolName || '')
      : confirmationRequired.toolName;
    if (/(?:reboot|restart|reinici)/i.test(toolName)) {
      return 'Posso reiniciar seu roteador agora? A conexao pode ficar indisponivel por alguns minutos enquanto o equipamento reinicia.';
    }
    if (/(?:password|senha|credential|wifi|wi-fi)/i.test(toolName)) {
      return 'Posso aplicar essa alteracao no seu Wi-Fi agora? Confirme para eu prosseguir.';
    }
    if (/(?:payment|promise|promessa)/i.test(toolName)) {
      return 'Posso registrar essa promessa de pagamento agora? Confirme para eu prosseguir.';
    }
    return 'Posso executar essa alteracao agora? Confirme para eu prosseguir.';
  }

  const failedDependency = results.find((result) =>
    result.status === 'rejected' &&
    result.error?.includes('[tool_policy:dependency_failed]')
  );
  if (failedDependency) {
    return 'Nao consegui concluir a verificacao anterior, entao nao fiz nenhuma alteracao. Posso tentar novamente ou seguir com outra verificacao.';
  }

  const policyBlockedAction = results.find((result) =>
    result.status === 'rejected' &&
    /\[tool_policy:(?:intent_mismatch|missing_parameters|metadata_unavailable)\]/.test(result.error || '')
  );
  if (policyBlockedAction) {
    if (
      policyBlockedAction.input.type === 'mcp_call_tool' &&
      /(?:^|:)find_router_by_ip$/i.test(String(policyBlockedAction.input.payload?.toolName || '')) &&
      policyBlockedAction.error?.includes('[tool_policy:missing_parameters]')
    ) {
      return 'Nao encontrei um IPv4 disponivel para esse contrato, entao nao executei nenhuma alteracao no roteador. Sera necessario que nossa equipe verifique manualmente.';
    }
    return 'Nao fiz nenhuma alteracao porque faltam dados ou contexto para executar essa acao com seguranca. Vamos seguir pela verificacao correta.';
  }

  // Check for failed critical tools first (SGP and MCP)
  const failedCriticalTool = results.find((result) =>
    result.status !== 'success' &&
    (
      result.toolName === 'sgp_fetch_contact_panel_data' ||
      result.toolName === 'sgp_fetch_contracts' ||
      result.toolName === 'mcp_call_tool' ||
      result.toolName.startsWith('mcp:')
    )
  );

  if (failedCriticalTool) {
    if (failedCriticalTool.toolName === 'mcp_call_tool' || failedCriticalTool.toolName.startsWith('mcp:')) {
      return 'Nao consegui concluir a acao tecnica automaticamente agora. Para evitar te passar uma informacao errada, sera necessario que nossa equipe verifique manualmente.';
    }

    // Se uma ferramenta crítica do SGP falhou, a resposta da IA possivelmente
    // está carente de dados ou é apenas uma mensagem de espera. Sempre informamos
    // a falha no sistema para não deixar o cliente no vácuo.
    return 'Nao consegui concluir a consulta no sistema agora. Para evitar te passar uma informacao errada, sera necessario que nossa equipe verifique manualmente.';
  }

  // Check for failed operational tools (transfer, close, etc.) that should not be silently ignored
  const failedOperationalTool = results.find((result) =>
    result.status !== 'success' &&
    (
      result.toolName === 'transfer_chat' ||
      result.toolName === 'close_chat' ||
      result.toolName === 'sgp_generate_invoice_pix' ||
      result.toolName === 'sgp_create_payment_promise'
    )
  );

  if (failedOperationalTool) {
    if (failedOperationalTool.toolName === 'transfer_chat') {
      return 'Nao consegui encaminhar seu atendimento automaticamente agora. Nossa equipe sera notificada para dar seguimento.';
    }
    if (failedOperationalTool.toolName === 'close_chat') {
      return 'Nao consegui encerrar o atendimento automaticamente. Nossa equipe sera notificada.';
    }
    if (failedOperationalTool.toolName === 'sgp_generate_invoice_pix') {
      return 'Nao consegui gerar o PIX da fatura automaticamente agora. Por favor, entre em contato com nosso atendimento para resolver manualmente.';
    }
    if (failedOperationalTool.toolName === 'sgp_create_payment_promise') {
      return 'Nao consegui registrar a promessa de pagamento automaticamente. Nossa equipe sera notificada para dar seguimento.';
    }
  }

  const failedCustomerVisibleTool = results.find((result) =>
    result.status !== 'success' &&
    result.toolName !== 'add_internal_note' &&
    result.toolName !== 'crm_update_contact_custom_fields'
  );
  if (failedCustomerVisibleTool) {
    return 'Nao consegui concluir essa acao automaticamente agora. Nossa equipe vai acompanhar por aqui para dar seguimento.';
  }

  return null;
}

export function hydrateFindRouterByIpActionsFromSgpResults(input: {
  actions: AgentToolAction[];
  toolResults: AgentToolExecutionResult[];
  contextText: string;
}): AgentToolAction[] {
  const requestedContractId = resolveFocusedContractId(input.toolResults, input.contextText) ||
    getScopedContractIdFromToolResults(input.toolResults);
  if (!requestedContractId) return input.actions;

  const requestedDigits = onlyDigits(requestedContractId);
  const contract = getContractsFromToolResults(input.toolResults)
    .find((item: any) => onlyDigits(item?.id) === requestedDigits);
  const clientIp = String(contract?.ip || '').trim();
  if (!clientIp) return input.actions;

  return input.actions.map((action) => {
    if (
      action.type !== 'mcp_call_tool' ||
      !/(?:^|:)find_router_by_ip$/i.test(String(action.payload?.toolName || '')) ||
      String((action.payload?.arguments as any)?.client_ip || '').trim()
    ) {
      return action;
    }

    return {
      ...action,
      payload: {
        ...(action.payload || {}),
        arguments: {
          ...((action.payload?.arguments as Record<string, unknown>) || {}),
          client_ip: clientIp,
        },
      },
    };
  });
}
