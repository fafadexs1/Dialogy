import type { KnowledgeBaseDocument } from '@/lib/types';
import type {
  AutopilotExtractedSlots,
  AutopilotIntentResolution,
  KnowledgeDocumentCategory,
  UniversalAutopilotIntent,
} from '@/services/autopilot/intent-types';
import { extractAutopilotSlots } from '@/services/autopilot/slots';
import { getAutopilotWorkflow } from '@/services/autopilot/workflows';
import { getCanonicalKnowledgeAnswer, isUnsafeAsCustomerFacingKnowledge } from '@/services/rag/document-safety';

export type AutopilotIntentName = UniversalAutopilotIntent;

const OFFICIAL_ANSWER_MAX_CHARS = 3200;
const DETERMINISTIC_OFFICIAL_INTENTS = new Set<UniversalAutopilotIntent>([
  'catalog_request',
  'pricing_request',
  'promotion_request',
  'return_or_refund',
  'cancellation_request',
]);

const VERTICAL_CATEGORY_EQUIVALENTS: Partial<Record<UniversalAutopilotIntent, string[]>> = {
  purchase_inquiry: [
    'isp_plan_catalog',
    'menu',
    'course_catalog',
    'property_catalog',
    'ecommerce_product',
    'clinic_service',
    'delivery_menu',
  ],
  catalog_request: [
    'isp_plan_catalog',
    'menu',
    'course_catalog',
    'property_catalog',
    'ecommerce_product',
    'clinic_service',
    'delivery_menu',
  ],
  pricing_request: [
    'isp_plan_catalog',
    'menu',
    'course_catalog',
    'property_catalog',
    'ecommerce_product',
    'delivery_menu',
  ],
  billing_or_payment: ['isp_invoice', 'invoice', 'payment', 'subscription_billing'],
  scheduling_request: ['clinic_appointment', 'reservation', 'visit_scheduling', 'class_schedule'],
  order_or_request_status: ['ecommerce_tracking', 'order_tracking', 'delivery_order_status', 'request_tracking'],
  troubleshooting: ['isp_no_connection', 'isp_router', 'technical_support'],
  support_request: ['customer_support', 'student_support', 'technical_support'],
  return_or_refund: ['ecommerce_return', 'ecommerce_exchange', 'ecommerce_warranty'],
  cancellation_request: ['cancelamento', 'cancellation_policy', 'subscription_cancellation'],
};

const LLM_COMPOSED_INTENTS = new Set<UniversalAutopilotIntent>([
  'purchase_inquiry',
]);

const INTENT_KEYWORDS: Record<UniversalAutopilotIntent, RegExp[]> = {
  greeting: [/\b(ola|oi|oie|oii|bom dia|boa tarde|boa noite|hey)\b/],
  human_handoff: [
    /\b(atendente|humano|pessoa|consultor|vendedor|suporte humano)\b/,
    /\b(falar|conversar|chamar|transferir|transfere|transfira|me transfere|passar|me passa|me passar|me coloca).{0,60}\b(atendente|humano|pessoa|equipe|comercial|vendas|financeiro|suporte|tecnico)\b/,
  ],
  purchase_inquiry: [/\b(comprar|contratar|assinar|adquirir|fechar|quero esse|vou querer|tenho interesse)\b/],
  catalog_request: [
    /\b(catalogo|cardapio|menu|lista|opcoes|opcao|produtos|servicos|planos|pacotes|cursos|imoveis|modelos)\b/,
    /\b(me mostra|mostrar|manda|mandar|envia|enviar|quais|todos|todas|ver).{0,40}\b(opcoes|produtos|servicos|planos|pacotes|cardapio|menu)\b/,
  ],
  pricing_request: [
    /\b(preco|precos|valor|valores|quanto custa|custa quanto|orcamento|mensalidade|taxa|tarifa|condicoes|condicao)\b/,
    /\br\$\s*\d+/,
  ],
  promotion_request: [/\b(promocao|promocoes|promocional|promo|desconto|oferta|cupom|campanha|condicao especial)\b/],
  availability_request: [/\b(disponivel|disponibilidade|tem vaga|tem estoque|em estoque|atende minha regiao|atende|atendem|atendimento no bairro|bairro|area de entrega|tem horario)\b/],
  billing_or_payment: [/\b(boletos?|faturas?|pix|pagamento|pagar|cobranca|segunda via|2a via|vencimento|debito|mensalidade atrasada)\b/],
  scheduling_request: [/\b(agendar|marcar|remarcar|desmarcar|horario|agenda|consulta|reserva|visita|reuniao)\b/],
  order_or_request_status: [/\b(status|andamento|rastreio|rastreamento|pedido|solicitacao|protocolo|entrega|chegou|atrasado)\b/],
  support_request: [/\b(suporte|ajuda|duvida|orientacao|como faco|como fazer|nao sei)\b/],
  troubleshooting: [
    /\b(problema|erro|falha|nao funciona|nao esta funcionando|parou|travando|lento|lenta|lentidao|instabilidade|oscilando|cai|caiu|caindo|quedas?|rompeu|rompida|rompido|sem acesso|sem sinal|sem conexao|sem internet|los|loss)\b/,
    /\b(internet|conexao|wifi|wi fi|fibra|sinal|roteador|modem)\b.{0,50}\b(ruim|lenta?|lento|cai|caiu|caindo|falhando|oscilando|instavel|instabilidade|nao funciona|sem sinal|sem acesso|rompeu|rompida|rompido|loss|los)\b/,
    /\b(ruim|lenta?|lento|cai|caiu|caindo|falhando|oscilando|instavel|instabilidade|nao funciona|sem sinal|sem acesso|rompeu|rompida|rompido|loss|los)\b.{0,50}\b(internet|conexao|wifi|wi fi|fibra|sinal|roteador|modem)\b/,
  ],
  change_request: [/\b(alterar|mudar|trocar|atualizar|corrigir).{0,40}\b(cadastro|dados|endereco|plano|pedido|horario|produto|servico|senha|wifi|wi fi|rede)\b/],
  return_or_refund: [/\b(devolver|devolucao|troca|estorno|reembolso|garantia|arrependimento)\b/],
  cancellation_request: [/\b(cancelar|cancelamento|encerrar|desistir|suspender|rescindir)\b/],
  document_request: [/\b(documento|contratos?|nota fiscal|nf|comprovante|recibo|termo|declaracao|laudo|resultado)\b/],
  complaint: [/\b(reclamacao|reclamar|insatisfeito|absurdo|pessimo|horrivel|raiva|procon|processo|irritado|indignado|cansado de|ninguem resolve|ja reclamei)\b/],
  thanks: [/\b(obrigado|obrigada|valeu|agradeco|grato|grata|perfeito|beleza|ok obrigado)\b/],
  unknown: [],
};

function normalizeForIntent(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeCategory(value: string): string {
  return normalizeForIntent(value).replace(/[\s-]+/g, '_');
}

function getDocumentValue(document: KnowledgeBaseDocument, keys: string[]): unknown {
  const raw = document as KnowledgeBaseDocument & Record<string, unknown>;
  for (const key of keys) {
    const value = raw[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return null;
}

function getDocumentCategories(document: KnowledgeBaseDocument): string[] {
  const rawCategory = getDocumentValue(document, ['category', 'type', 'kind']);
  const rawTags = getDocumentValue(document, ['tags']);
  const rawHints = getDocumentValue(document, ['workflowHints', 'workflow_hints']);
  const values = [
    typeof rawCategory === 'string' ? rawCategory : null,
    ...(Array.isArray(rawTags) ? rawTags : []),
    ...(Array.isArray(rawHints) ? rawHints : []),
  ]
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .flatMap((item) => item.split(/[;,]/g))
    .map((item) => normalizeCategory(item))
    .filter(Boolean);

  return values.length > 0 ? Array.from(new Set(values)) : ['uncategorized'];
}

function getCanonicalAnswer(document: KnowledgeBaseDocument): string {
  return getCanonicalKnowledgeAnswer(document);
}

function hasExactResponseDirective(document: KnowledgeBaseDocument): boolean {
  const content = normalizeForIntent(`${document.name || ''}\n${getCanonicalAnswer(document)}\n${document.content || ''}`).slice(0, 1200);
  return (
    /\b(?:voce\s+deve\s+mandar|deve\s+mandar|envie|mande|responda|usar)\b.{0,100}\b(?:exatamente|mesmo\s+espacamento|mesmos?\s+emojis?|sem\s+alterar|nao\s+mude)\b/.test(content) ||
    /\b(?:exatamente|mesmo\s+espacamento)\b.{0,100}\b(?:emojis?|quebras?\s+de\s+linha|espacamento)\b/.test(content)
  );
}

function getDocumentPriority(document: KnowledgeBaseDocument): number {
  const value = Number(getDocumentValue(document, ['priority']));
  return Number.isFinite(value) ? value : 0;
}

function parseDate(value: unknown): number | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function isDocumentActive(document: KnowledgeBaseDocument): boolean {
  const status = normalizeCategory(String(getDocumentValue(document, ['status']) || 'active'));
  if (status === 'draft' || status === 'archived' || status === 'expired' || status === 'inactive') return false;

  const now = Date.now();
  const validFrom = parseDate(getDocumentValue(document, ['validFrom', 'valid_from']));
  const validUntil = parseDate(getDocumentValue(document, ['validUntil', 'valid_until']));
  if (validFrom && validFrom > now) return false;
  if (validUntil && validUntil < now) return false;

  return true;
}

function getIntentCategoryTargets(intent: UniversalAutopilotIntent): string[] {
  const workflow = getAutopilotWorkflow(intent);
  return Array.from(new Set([
    ...workflow.knowledgeCategories.map((category) => normalizeCategory(String(category))),
    ...(VERTICAL_CATEGORY_EQUIVALENTS[intent] || []).map(normalizeCategory),
  ]));
}

function documentMatchesIntentCategory(document: KnowledgeBaseDocument, intent: UniversalAutopilotIntent): boolean {
  const categories = getDocumentCategories(document);
  const targets = getIntentCategoryTargets(intent);
  return categories.some((category) => targets.some((target) => category === target || category.includes(target) || target.includes(category)));
}

function countRegexMatches(haystack: string, patterns: RegExp[]): number {
  return patterns.reduce((score, pattern) => score + (pattern.test(haystack) ? 1 : 0), 0);
}

function getOfficialDocumentScore(document: KnowledgeBaseDocument, intent: UniversalAutopilotIntent): number {
  if (!isDocumentActive(document)) return -500;
  if (isUnsafeAsCustomerFacingKnowledge(document)) return -500;

  const content = String(document.content || '');
  const canonicalAnswer = getCanonicalAnswer(document);
  const haystack = normalizeForIntent(`${document.name || ''}\n${content}\n${canonicalAnswer}`);
  const categories = getDocumentCategories(document);
  const hasCategoryMatch = documentMatchesIntentCategory(document, intent);
  let score = 0;

  if (hasCategoryMatch) score += 120;
  if (canonicalAnswer) score += 90;
  if (
    hasExactResponseDirective(document) &&
    /\br\$\s*\d+/i.test(content) &&
    /\b\d{2,4}\s*(?:mega|megas|mb|gb)\b/.test(haystack)
  ) {
    score += 150;
  }
  score += Math.max(0, Math.min(20, getDocumentPriority(document))) * 4;
  score += countRegexMatches(haystack, INTENT_KEYWORDS[intent] || []) * 30;

  if (/\br\$\s*\d+/i.test(content) && (intent === 'pricing_request' || intent === 'catalog_request' || intent === 'purchase_inquiry')) {
    score += 35;
  }
  if (categories.includes('internal_only')) score -= 180;
  if (
    intent !== 'cancellation_request' &&
    categories.some((category) => category.includes('cancellation') && category !== 'returns_or_cancellation')
  ) score -= 140;
  if (!['human_handoff', 'complaint', 'cancellation_request'].includes(intent) && categories.includes('handoff_policy')) score -= 80;
  if (!['return_or_refund', 'cancellation_request'].includes(intent) && categories.includes('returns_or_cancellation')) score -= 90;
  if (normalizeForIntent(content).length < 40 && !canonicalAnswer) score -= 30;
  if (!DETERMINISTIC_OFFICIAL_INTENTS.has(intent) && !canonicalAnswer) score -= 160;

  return score;
}

function extractPromotionSection(content: string): string {
  const lines = content.split('\n');
  const startIndex = lines.findIndex((line) => /\b(promocao|promocoes|promocional|promo|oferta)\b/.test(normalizeForIntent(line)));
  if (startIndex < 0) return content;

  const section = lines.slice(startIndex);
  const validUntilIndex = section.findIndex((line) => /\b(oferta\s+valida|valido\s+ate|valida\s+ate)\b/.test(normalizeForIntent(line)));
  if (validUntilIndex >= 0) {
    return section.slice(0, validUntilIndex + 1).join('\n').trim();
  }

  return section.join('\n').trim();
}

const REQUEST_SCOPE_STOP_WORDS = new Set([
  'a',
  'as',
  'ao',
  'aos',
  'com',
  'da',
  'das',
  'de',
  'do',
  'dos',
  'e',
  'em',
  'eu',
  'me',
  'meu',
  'minha',
  'no',
  'na',
  'nos',
  'nas',
  'o',
  'os',
  'para',
  'por',
  'que',
  'queria',
  'quero',
  'quer',
  'ver',
  'veja',
  'mostrar',
  'mostra',
  'mande',
  'manda',
  'envie',
  'envia',
  'apenas',
  'somente',
  'so',
  'só',
  'todos',
  'todas',
  'todo',
  'toda',
  'opcoes',
  'opcao',
  'catalogo',
  'cardapio',
  'lista',
  'planos',
  'plano',
  'pacotes',
  'pacote',
  'produtos',
  'produto',
  'servicos',
  'servico',
  'itens',
  'item',
]);

function uniqueValues(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function wordsFromScopeText(value: string): string[] {
  const words = normalizeForIntent(value)
    .split(/[^a-z0-9]+/g)
    .map((word) => word.trim())
    .filter((word) => word.length >= 2 && !REQUEST_SCOPE_STOP_WORDS.has(word) && !/^\d+$/.test(word));

  return uniqueValues(
    words
  );
}

function hasScopeTerm(haystack: string, term: string): boolean {
  const variants = [term];
  if (term.length > 3 && term.endsWith('s') && !term.endsWith('ais') && !term.endsWith('eis') && !term.endsWith('ois')) {
    variants.push(term.slice(0, -1));
  }
  if (term.length > 4 && term.endsWith('a')) variants.push(`${term.slice(0, -1)}o`);
  if (term.length > 4 && term.endsWith('o')) variants.push(`${term.slice(0, -1)}a`);
  return uniqueValues(variants).some((variant) => new RegExp(`\\b${variant}\\b`).test(haystack));
}

function hasScopeNumber(haystack: string, number: string): boolean {
  return new RegExp(`\\b${number.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:[,.]0+)?\\b`).test(haystack);
}

function getRequestScope(customerMessage?: string | null): {
  includeTerms: string[];
  excludeTerms: string[];
  numbers: string[];
  hasExplicitScope: boolean;
} {
  const normalized = normalizeForIntent(customerMessage || '');
  const includeFragments: string[] = [];
  const excludeFragments: string[] = [];

  for (const match of normalized.matchAll(/\b(?:com|inclui|incluindo|tem|contendo)\s+([^,.?!;]+)/g)) {
    includeFragments.push(match[1]);
  }
  for (const match of normalized.matchAll(/\b(?:apenas|somente|so)\s+(?:os?|as?|opcoes?|itens?|pacotes?|planos?|produtos?|servicos?)?\s*(?:(?:com|de|do|da|para|sobre)\b)?\s*([^,.?!;]+)/g)) {
    includeFragments.push(match[1]);
  }
  for (const match of normalized.matchAll(/\b(?:sem|exceto|menos|tirando|nao quero)\s+([^,.?!;]+)/g)) {
    excludeFragments.push(match[1]);
  }

  const numbers = uniqueValues((normalized.match(/\b\d+(?:[,.]\d+)?\b/g) || []).map((value) => value.replace(',', '.')));
  const includeTerms = wordsFromScopeText(includeFragments.join(' '));
  const excludeTerms = wordsFromScopeText(excludeFragments.join(' '));

  return {
    includeTerms,
    excludeTerms,
    numbers,
    hasExplicitScope: includeTerms.length > 0 || excludeTerms.length > 0 || numbers.length > 0,
  };
}

function splitCatalogBlocks(content: string): { header: string[]; blocks: string[] } {
  const normalized = content.replace(/\r\n?/g, '\n').trim();
  if (!normalized) return { header: [], blocks: [] };

  const blocks = normalized
    .split(/\n{2,}/g)
    .map((block) => block.trim())
    .filter(Boolean);

  const firstPlanIndex = blocks.findIndex((block) => {
    const normalizedBlock = normalizeForIntent(block);
    return /\b\d+(?:[,.]\d+)?\b/.test(normalizedBlock) || /\br\$\s*\d+/i.test(block);
  });

  if (firstPlanIndex <= 0) return { header: firstPlanIndex === 0 ? [] : [], blocks };
  return {
    header: blocks.slice(0, firstPlanIndex),
    blocks: blocks.slice(firstPlanIndex),
  };
}

function blockMatchesCatalogFilters(
  block: string,
  scope: ReturnType<typeof getRequestScope>
): boolean {
  const normalized = normalizeForIntent(block);
  const isCatalogItem = (
    /\b\d+(?:[,.]\d+)?\b/.test(normalized) ||
    /\br\$\s*\d+/i.test(block) ||
    /\b(?:plano|pacote|servico|produto|combo|item|curso|aula|imovel|casa|apartamento|consulta|procedimento|opcao|menu|prato)\b/.test(normalized)
  );
  if (!isCatalogItem) return false;
  if (scope.excludeTerms.some((term) => hasScopeTerm(normalized, term))) return false;
  if (scope.includeTerms.length > 0 && !scope.includeTerms.every((term) => hasScopeTerm(normalized, term))) return false;
  if (scope.numbers.length > 0 && !scope.numbers.some((number) => hasScopeNumber(normalized, number))) return false;
  return true;
}

function scopeCatalogContentToRequest(
  content: string,
  customerMessage: string | null | undefined,
  intent?: UniversalAutopilotIntent
): string {
  if (!['catalog_request', 'pricing_request', 'promotion_request'].includes(intent || 'unknown')) return content;

  const scope = getRequestScope(customerMessage);
  if (!scope.hasExplicitScope) {
    return content;
  }

  const { header, blocks } = splitCatalogBlocks(content);
  const selected = blocks.filter((block) => blockMatchesCatalogFilters(block, scope));
  if (selected.length === 0) return content;

  return [...header, ...selected].join('\n\n').trim();
}

export function cleanKnowledgeCatalogContent(
  content: string,
  preserveSpacing = false,
  intent?: UniversalAutopilotIntent,
  customerMessage?: string | null
): string {
  let normalized = content.replace(/\r\n?/g, '\n');

  if (preserveSpacing) {
    normalized = normalized
      .split('\n')
      .map((line) => line.replace(/[ \t]+$/g, ''))
      .join('\n')
      .trim();
  } else {
    normalized = normalized
      .split('\n')
      .map((line) => line.replace(/[ \t]+$/g, '').trimStart())
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  const lines = normalized.split('\n');
  while (lines.length > 0) {
    const first = normalizeForIntent(lines[0] || '');
    if (!first || /^(voce deve mandar|deve mandar|nao mude|nao altere|envie exatamente|mande dessa forma|mande exatamente|responda exatamente|resposta oficial|use esta resposta|instrucoes?|observacao interna)/.test(first)) {
      lines.shift();
      continue;
    }
    break;
  }

  normalized = lines.join('\n').replace(/^\s*(resposta oficial|resposta canonica|catalogo|cardapio)\s*:\s*/i, '').trim();
  if (intent === 'promotion_request') {
    normalized = extractPromotionSection(normalized);
  }
  normalized = scopeCatalogContentToRequest(normalized, customerMessage, intent);
  return normalized;
}

export function findOfficialKnowledgeAnswer(input: {
  documents: KnowledgeBaseDocument[] | null | undefined;
  intent: UniversalAutopilotIntent;
  customerMessage?: string | null;
}): { content: string; document: KnowledgeBaseDocument; score: number; preserveFormatting: boolean } | null {
  if (
    input.intent === 'unknown' ||
    input.intent === 'greeting' ||
    input.intent === 'thanks' ||
    input.intent === 'human_handoff' ||
    LLM_COMPOSED_INTENTS.has(input.intent)
  ) {
    return null;
  }

  const candidates = (input.documents || [])
    .map((document) => {
      const canonicalAnswer = getCanonicalAnswer(document);
      const preserveFormatting = hasExactResponseDirective(document);
      const content = cleanKnowledgeCatalogContent(
        canonicalAnswer || String(document.content || ''),
        preserveFormatting,
        input.intent,
        input.customerMessage
      );
      return {
        document,
        content,
        preserveFormatting,
        score: getOfficialDocumentScore(document, input.intent),
      };
    })
    .filter(({ content, score }) => content.trim().length > 0 && score >= 100)
    .sort((left, right) => right.score - left.score || right.content.length - left.content.length);

  const best = candidates[0];
  if (!best) return null;

  return {
    ...best,
    content: best.content.length > OFFICIAL_ANSWER_MAX_CHARS
      ? best.content.slice(0, OFFICIAL_ANSWER_MAX_CHARS).trim()
      : best.content,
  };
}

export function findOfficialPlanCatalog(
  documents: KnowledgeBaseDocument[] | null | undefined
): { content: string; document: KnowledgeBaseDocument; score: number; preserveFormatting: boolean } | null {
  return (
    findOfficialKnowledgeAnswer({ documents, intent: 'catalog_request' }) ||
    findOfficialKnowledgeAnswer({ documents, intent: 'pricing_request' })
  );
}

function matchesAny(normalizedText: string, intent: UniversalAutopilotIntent): boolean {
  return (INTENT_KEYWORDS[intent] || []).some((pattern) => pattern.test(normalizedText));
}

function isShortMessage(normalizedMessage: string): boolean {
  return normalizedMessage.length <= 48 && normalizedMessage.split(/\s+/).length <= 7;
}

function isAffirmativeFollowUp(normalizedMessage: string): boolean {
  return /^(sim|quero|pode|manda|manda sim|mostrar|mostra|envia|envia sim|ok|beleza|claro|isso|esse|essa|pode ser)\b/.test(normalizedMessage);
}

function hasCatalogOfferContext(normalizedHistory: string): boolean {
  return /\b(catalogo|cardapio|menu|opcoes|produtos|servicos|planos|pacotes|precos|valores|oferta|promocao|promocional|conhecer|interesse|internet|fibra|mega|megas)\b/.test(normalizedHistory);
}

function isCustomerIdentifierOnly(normalizedMessage: string): boolean {
  const digits = normalizedMessage.replace(/\D/g, '');
  return (
    (digits.length === 11 || digits.length === 14) &&
    normalizedMessage.replace(/[\d.\-/\s]/g, '').length === 0
  );
}

function isLocationFollowUp(normalizedMessage: string): boolean {
  return (
    /\b(?:moro|resido|fico|estou|sou)\s+(?:no|na|em|do|da)\s+[\p{L}\d][\p{L}\d\s.'-]{2,}$/u.test(normalizedMessage) ||
    /\b(?:bairro|setor|condominio|condominio|quadra|rua|avenida|av\.?|cidade|regiao)\s+[\p{L}\d][\p{L}\d\s.'-]{2,}$/u.test(normalizedMessage)
  );
}

function hasQuestionOrCatalogVerb(normalizedMessage: string): boolean {
  return (
    normalizedMessage.includes('?') ||
    /\b(qual|quais|quanto|preco|precos|valor|valores|custa|tem|existe|ha|alguma|algum|mostra|mostrar|manda|mandar|envia|enviar|ver|conhecer|detalhe|detalhes|explica|canais|canal)\b/.test(normalizedMessage)
  );
}

function hasSpecificCatalogSelection(normalizedMessage: string): boolean {
  if (!normalizedMessage || hasQuestionOrCatalogVerb(normalizedMessage)) return false;

  const hasSpeed = /\b\d{2,4}\s*(?:mega|megas|mb|gb)\b/.test(normalizedMessage);
  const hasPointer = /\b(esse|essa|este|esta|desse|dessa|do|da|de|o|a)\b/.test(normalizedMessage);
  const hasMoney = /\br\$\s*\d+|\b\d+[,.]\d{2}\b/.test(normalizedMessage);
  const hasOrdinal = /\b(primeir[oa]|segund[oa]|terceir[oa]|quart[oa]|quint[oa]|sext[oa]|setim[oa]|oitav[oa]|non[oa]|decim[oa])\b/.test(normalizedMessage);
  const hasProductReference = /\b(plano|pacote|combo|produto|servico|curso|modelo|item|opcao|oferta|promo|promocional)\b/.test(normalizedMessage);
  const hasNumberedOption = /\b(?:opcao|numero|n[ºo]?|item)\s*#?\s*\d{1,2}\b/.test(normalizedMessage);
  const hasPromoSelection = /\b(?:esse|essa|este|esta|desse|dessa|o|a)?\s*(?:plano|pacote)?\s*(?:promo|promocional|oferta)\b/.test(normalizedMessage);

  return (
    (hasPointer && (hasSpeed || hasMoney || hasOrdinal || hasProductReference)) ||
    hasNumberedOption ||
    hasPromoSelection
  );
}

function isSpecificCatalogSelectionFollowUp(normalizedMessage: string, normalizedHistory: string): boolean {
  return hasSpecificCatalogSelection(normalizedMessage) && hasCatalogOfferContext(normalizedHistory);
}

function hasPurchaseCommitment(normalizedMessage: string): boolean {
  return (
    /\b(?:quero|vou querer|fico com|fechar|fecho|contratar|assinar|aderir|pegar)\b.{0,50}\b(?:esse|essa|ele|ela|plano|pacote|promo|promocional|oferta)\b/.test(normalizedMessage) ||
    /\b(?:esse|essa|ele|ela|plano|pacote|promo|promocional|oferta)\b.{0,50}\b(?:quero|vou querer|fico com|fechar|fecho|contratar|assinar|aderir|pegar)\b/.test(normalizedMessage) ||
    /\bacho que quero\b/.test(normalizedMessage)
  );
}

function hasIdentifierRequestContext(normalizedHistory: string): boolean {
  return (
    /\b(?:cpf|cnpj|documento|identificador|cadastro)\b/.test(normalizedHistory) &&
    /\b(?:me informe|informe|envie|manda|mandar|preciso|necessario|necessario|para seguir|para continuar|para consultar|para verificar|validar|acessar)\b/.test(normalizedHistory)
  );
}

const CONTEXT_CONTINUATION_PATTERNS: Array<{
  intent: UniversalAutopilotIntent;
  patterns: RegExp[];
}> = [
  {
    intent: 'billing_or_payment',
    patterns: [
      /\b(boletos?|faturas?|pix|pagamento|pagar|cobranca|segunda via|2a via|vencimento|debito|mensalidade atrasada|financeiro)\b/,
    ],
  },
  {
    intent: 'troubleshooting',
    patterns: [
      /\b(problema|erro|falha|nao funciona|nao esta funcionando|parou|travando|lento|instabilidade|sem acesso|sem sinal|sem conexao|conexao|sinal|fibra|modem|roteador|cabo|reinicie|tomada|los|caiu|caindo|queda|quedas)\b/,
    ],
  },
  {
    intent: 'order_or_request_status',
    patterns: [
      /\b(status|andamento|rastreio|rastreamento|pedido|solicitacao|protocolo|entrega|chegou|atrasado)\b/,
    ],
  },
  {
    intent: 'document_request',
    patterns: [
      /\b(documento|contratos?|nota fiscal|nf|comprovante|recibo|termo|declaracao|laudo|resultado|titularidade)\b/,
    ],
  },
  {
    intent: 'availability_request',
    patterns: [
      /\b(disponivel|disponibilidade|tem vaga|tem estoque|em estoque|atende minha regiao|area de entrega|tem horario|regiao|bairro|endereco|cep)\b/,
    ],
  },
  {
    intent: 'purchase_inquiry',
    patterns: [
      /\b(comprar|contratar|contratacao|assinar|adesao|adquirir|fechar|quero esse|vou querer|tenho interesse|comercial|proposta)\b/,
      /\b(continuar|seguir|prosseguir).{0,80}\b(contratacao|contratar|assinar|adesao|cadastro)\b/,
    ],
  },
  {
    intent: 'support_request',
    patterns: [
      /\b(suporte|ajuda|duvida|orientacao|como faco|como fazer|nao sei|atendimento)\b/,
    ],
  },
  {
    intent: 'change_request',
    patterns: [
      /\b(alterar|mudar|trocar|atualizar|corrigir).{0,60}\b(cadastro|dados|endereco|plano|pedido|horario|produto|servico)\b/,
    ],
  },
  {
    intent: 'cancellation_request',
    patterns: [
      /\b(cancelar|cancelamento|encerrar|desistir|suspender|rescindir)\b/,
    ],
  },
];

function scoreContinuationPatterns(normalizedHistory: string, patterns: RegExp[]): number {
  const recent = normalizedHistory.slice(-700);
  return patterns.reduce((score, pattern) => {
    let nextScore = score;
    if (pattern.test(normalizedHistory)) nextScore += 1;
    if (pattern.test(recent)) nextScore += 2;
    return nextScore;
  }, 0);
}

function inferContextContinuationIntent(
  normalizedHistory: string,
  minimumScore = 1
): { intent: UniversalAutopilotIntent; score: number } | null {
  const scored = CONTEXT_CONTINUATION_PATTERNS
    .map(({ intent, patterns }) => ({
      intent,
      score: scoreContinuationPatterns(normalizedHistory, patterns),
    }))
    .filter((item) => item.score >= minimumScore)
    .sort((left, right) => right.score - left.score);

  const best = scored[0];
  if (!best) return null;

  const second = scored[1];
  if (second && second.score === best.score) {
    return { intent: 'unknown', score: best.score };
  }

  return best;
}

function inferIdentifierContinuationIntent(
  normalizedHistory: string
): { intent: UniversalAutopilotIntent; confidence: number; reason: string } | null {
  if (!normalizedHistory || !hasIdentifierRequestContext(normalizedHistory)) return null;

  const best = inferContextContinuationIntent(normalizedHistory);
  if (!best) return null;

  if (best.intent === 'unknown') {
    return {
      intent: 'unknown',
      confidence: 0.42,
      reason: 'Cliente informou CPF/CNPJ como follow-up, mas o historico recente ficou ambiguo.',
    };
  }

  return {
    intent: best.intent,
    confidence: Math.min(0.92, 0.72 + best.score * 0.04),
    reason: `Cliente informou CPF/CNPJ como follow-up; mantendo o contexto ativo inferido do historico recente: ${best.intent}.`,
  };
}

function isContextOnlyFollowUp(normalizedMessage: string): boolean {
  return (
    isShortMessage(normalizedMessage) &&
    /^(nao resolveu|nao funcionou|continua|continua igual|ainda nao|mesma coisa|deu erro|sim|ok|pode|isso|certo|beleza)\b/.test(normalizedMessage)
  );
}

function inferShortFollowUpIntent(
  normalizedMessage: string,
  normalizedHistory: string
): { intent: UniversalAutopilotIntent; confidence: number; reason: string } | null {
  if (!isContextOnlyFollowUp(normalizedMessage) || !normalizedHistory) return null;

  const continuation = inferContextContinuationIntent(normalizedHistory, 2);
  if (!continuation || continuation.intent === 'unknown') return null;

  return {
    intent: continuation.intent,
    confidence: Math.min(0.88, 0.7 + continuation.score * 0.04),
    reason: `Cliente respondeu com follow-up curto; mantendo o contexto ativo inferido do historico recente: ${continuation.intent}.`,
  };
}

type DetectedIntent = { intent: UniversalAutopilotIntent; confidence: number; reason: string };

function detectIntent(customerMessage: string, chatHistory = ''): DetectedIntent {
  const normalized = normalizeForIntent(customerMessage);
  const normalizedHistory = normalizeForIntent(chatHistory).slice(-1600);

  if (!normalized) {
    return { intent: 'unknown', confidence: 0, reason: 'Mensagem vazia.' };
  }

  if (matchesAny(normalized, 'cancellation_request')) {
    return { intent: 'cancellation_request', confidence: 0.88, reason: 'Cliente pediu cancelamento/encerramento de contrato, plano ou servico.' };
  }

  if (hasPurchaseCommitment(normalized)) {
    return { intent: 'purchase_inquiry', confidence: 0.9, reason: 'Cliente indicou compromisso de compra/contratacao.' };
  }

  if (isSpecificCatalogSelectionFollowUp(normalized, normalizedHistory)) {
    return { intent: 'purchase_inquiry', confidence: 0.88, reason: 'Cliente selecionou uma opcao especifica apos catalogo/oferta no historico recente.' };
  }

  if (
    isLocationFollowUp(normalized) &&
    /\b(disponibilidade|disponivel|atende|regiao|bairro|endereco|cep|localizacao|onde voce mora|onde fica)\b/.test(normalizedHistory)
  ) {
    return { intent: 'availability_request', confidence: 0.88, reason: 'Cliente informou localizacao como follow-up de disponibilidade.' };
  }

  if (isCustomerIdentifierOnly(normalized)) {
    const continuationIntent = inferIdentifierContinuationIntent(normalizedHistory);
    if (continuationIntent) return continuationIntent;
  }

  const shortFollowUpIntent = inferShortFollowUpIntent(normalized, normalizedHistory);
  if (shortFollowUpIntent) return shortFollowUpIntent;

  if (
    matchesAny(normalized, 'catalog_request') &&
    matchesAny(normalized, 'pricing_request') &&
    /\b(mostra|mostrar|manda|mandar|envia|enviar|quais|todos|todas|lista|catalogo|cardapio|menu)\b/.test(normalized)
  ) {
    return { intent: 'catalog_request', confidence: 0.88, reason: 'Cliente pediu lista/catalogo com valores.' };
  }

  if (
    matchesAny(normalized, 'pricing_request') &&
    !/\b(agendar|marcar|remarcar|desmarcar|agenda|horario|reserva|visita|reuniao)\b/.test(normalized)
  ) {
    return { intent: 'pricing_request', confidence: 0.87, reason: 'Cliente perguntou valores, preco ou custo.' };
  }

  if (matchesAny(normalized, 'promotion_request')) {
    return { intent: 'promotion_request', confidence: 0.87, reason: 'Cliente perguntou por promocao, oferta ou cupom.' };
  }

  if (matchesAny(normalized, 'availability_request')) {
    return { intent: 'availability_request', confidence: 0.86, reason: 'Cliente perguntou por disponibilidade.' };
  }

  const explicitNonCatalogIntents: UniversalAutopilotIntent[] = [
    'human_handoff',
    'complaint',
    'cancellation_request',
    'return_or_refund',
    'billing_or_payment',
    'scheduling_request',
    'order_or_request_status',
    'troubleshooting',
    'support_request',
    'document_request',
    'change_request',
  ];

  for (const intent of explicitNonCatalogIntents) {
    if (matchesAny(normalized, intent)) {
      return {
        intent,
        confidence: intent === 'human_handoff' ? 0.96 : 0.86,
        reason: `Intencao explicita reconhecida antes de contexto de catalogo: ${intent}.`,
      };
    }
  }

  if (
    isAffirmativeFollowUp(normalized) &&
    hasCatalogOfferContext(normalizedHistory)
  ) {
    return { intent: 'catalog_request', confidence: 0.82, reason: 'Confirmacao curta apos oferta/catalogo no historico recente.' };
  }

  if (hasQuestionOrCatalogVerb(normalized) && getRequestScope(normalized).hasExplicitScope) {
    return { intent: 'catalog_request', confidence: 0.84, reason: 'Cliente pediu um recorte especifico de catalogo/lista.' };
  }

  const orderedIntents: UniversalAutopilotIntent[] = [
    'human_handoff',
    'complaint',
    'cancellation_request',
    'return_or_refund',
    'billing_or_payment',
    'scheduling_request',
    'order_or_request_status',
    'troubleshooting',
    'support_request',
    'document_request',
    'change_request',
    'pricing_request',
    'promotion_request',
    'availability_request',
    'catalog_request',
    'purchase_inquiry',
  ];

  for (const intent of orderedIntents) {
    if (matchesAny(normalized, intent)) {
      return {
        intent,
        confidence: intent === 'human_handoff' ? 0.96 : 0.86,
        reason: `Intencao reconhecida por padroes deterministas universais: ${intent}.`,
      };
    }
  }

  if (isShortMessage(normalized) && matchesAny(normalized, 'thanks')) {
    return { intent: 'thanks', confidence: 0.9, reason: 'Agradecimento curto reconhecido.' };
  }

  if (isShortMessage(normalized) && matchesAny(normalized, 'greeting')) {
    return { intent: 'greeting', confidence: 0.9, reason: 'Saudacao curta reconhecida.' };
  }

  return { intent: 'unknown', confidence: 0.18, reason: 'Nenhuma intencao universal clara foi reconhecida.' };
}

function extractSlots(customerMessage: string): AutopilotExtractedSlots {
  return extractAutopilotSlots({ customerMessage }).slots;
}

export function isInternetPlanInquiry(message: string, chatHistory = ''): boolean {
  const normalized = normalizeForIntent(`${message}\n${chatHistory}`);
  const detected = detectIntent(message, chatHistory).intent;
  return (
    (detected === 'catalog_request' || detected === 'pricing_request' || detected === 'purchase_inquiry') &&
    /\b(planos?|pacotes?|internet|fibra|mega|megas)\b/.test(normalized)
  );
}

export function resolveAutopilotIntent(input: {
  customerMessage: string;
  chatHistory?: string;
  knowledgeDocuments?: KnowledgeBaseDocument[] | null;
}): AutopilotIntentResolution {
  const detected = detectIntent(input.customerMessage, input.chatHistory || '');
  return buildAutopilotIntentResolution(input, detected);
}

export function resolveAutopilotIntentWithOverride(input: {
  customerMessage: string;
  chatHistory?: string;
  knowledgeDocuments?: KnowledgeBaseDocument[] | null;
}, override: DetectedIntent): AutopilotIntentResolution {
  return buildAutopilotIntentResolution(input, override);
}

function buildAutopilotIntentResolution(input: {
  customerMessage: string;
  chatHistory?: string;
  knowledgeDocuments?: KnowledgeBaseDocument[] | null;
}, detected: DetectedIntent): AutopilotIntentResolution {
  const workflow = getAutopilotWorkflow(detected.intent);
  const official = findOfficialKnowledgeAnswer({
    documents: input.knowledgeDocuments,
    intent: detected.intent,
    customerMessage: input.customerMessage,
  });
  const extractedSlots = extractSlots(input.customerMessage);
  const shouldRetrieveKnowledge = !['greeting', 'thanks', 'human_handoff'].includes(detected.intent);

  return {
    intent: detected.intent,
    subIntent: null,
    confidence: official ? Math.max(detected.confidence, 0.94) : detected.confidence,
    reason: official
      ? `${detected.reason} Documento oficial elegivel encontrado.`
      : detected.reason,
    requiredSlots: workflow.requiredSlots,
    extractedSlots,
    workflowId: workflow.id,
    shouldUseLlm: !official && detected.intent !== 'human_handoff',
    shouldRetrieveKnowledge,
    shouldUseTool: workflow.allowedTools.some((tool) => tool !== 'transfer_chat' && tool !== 'add_internal_note'),
    shouldTransfer: detected.intent === 'human_handoff' || workflow.handoffPolicy === 'immediate',
    knowledgeCategories: workflow.knowledgeCategories as KnowledgeDocumentCategory[],
    sourceDocumentId: official?.document.id,
    sourceDocumentName: official?.document.name,
    officialResponse: official?.content,
    officialResponsePreserveFormatting: official?.preserveFormatting,
  };
}
