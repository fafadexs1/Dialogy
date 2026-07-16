import type { KnowledgeBaseDocument } from '@/lib/types';
import type { UniversalAutopilotIntent } from '@/services/autopilot/intent-types';

const SELF_SERVICE_KNOWLEDGE_INTENTS = new Set<UniversalAutopilotIntent>([
  'purchase_inquiry',
  'catalog_request',
  'pricing_request',
  'promotion_request',
  'availability_request',
]);

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function documentScore(document: KnowledgeBaseDocument, customerMessage: string): number {
  const queryTokens = new Set(
    normalizeText(customerMessage)
      .split(' ')
      .filter((token) => token.length >= 4),
  );
  const identity = normalizeText(`${document.name} ${document.category || ''}`);
  const searchable = normalizeText(`${identity} ${document.content}`);
  let score = Number(document.priority || 0) / 100;

  for (const token of queryTokens) {
    if (searchable.includes(token)) score += 2;
  }
  if (/catalog|plano|preco|pricing|oferta|produto|servico/.test(identity)) score += 4;
  if (document.contextRole === 'fact') score += 2;
  return score;
}

function renderKnowledgeAnswer(document: KnowledgeBaseDocument): string | null {
  const answer = (document.canonicalAnswer || document.content || '').trim();
  if (!answer) return null;

  // WhatsApp needs the useful fact, not an entire large source document.
  const bounded = answer.length <= 2600
    ? answer
    : `${answer.slice(0, 2597).trimEnd()}...`;
  return `${bounded}\n\nQual dessas opcoes mais te interessou?`;
}

export function isGenericInstabilityReply(value?: string | null): boolean {
  const normalized = normalizeText(value || '');
  return Boolean(normalized) && (
    normalized.includes('instabilidade para responder')
    || normalized.includes('instabilidade para concluir')
    || (normalized.includes('aguarde') && normalized.includes('equipe vai acompanhar'))
  );
}

/**
 * Produces a customer-facing continuation tied to the current request. It is
 * intentionally deterministic so an AI/provider failure cannot turn a useful
 * catalog request into a generic "instability" message.
 */
export function buildContextualAutopilotFallback(input: {
  intent: UniversalAutopilotIntent;
  customerMessage: string;
  knowledgeDocuments?: KnowledgeBaseDocument[] | null;
  configuredFallback?: string | null;
}): string {
  if (input.intent === 'greeting') return 'Ola! Como posso ajudar voce hoje?';
  if (input.intent === 'thanks') return 'Por nada! Posso ajudar em mais alguma coisa?';

  if (SELF_SERVICE_KNOWLEDGE_INTENTS.has(input.intent)) {
    const bestDocument = [...(input.knowledgeDocuments || [])]
      .filter((document) => document.status !== 'archived' && document.status !== 'expired')
      .sort((left, right) => (
        documentScore(right, input.customerMessage) - documentScore(left, input.customerMessage)
      ))[0];
    const knowledgeAnswer = bestDocument ? renderKnowledgeAnswer(bestDocument) : null;
    if (knowledgeAnswer) return knowledgeAnswer;
  }

  const configuredFallback = input.configuredFallback?.trim();
  if (configuredFallback && !isGenericInstabilityReply(configuredFallback)) {
    return configuredFallback;
  }

  switch (input.intent) {
    case 'billing_or_payment':
      return 'Nao consegui concluir a consulta financeira automaticamente. Vou deixar o atendimento para verificacao manual sem afirmar um resultado que nao foi confirmado.';
    case 'support_request':
    case 'troubleshooting':
      return 'Nao consegui concluir o diagnostico automatico. Vou deixar o atendimento para verificacao manual com o contexto que voce ja informou.';
    case 'scheduling_request':
      return 'Nao consegui confirmar o agendamento automaticamente. Vou deixar a solicitacao para verificacao manual sem confirmar uma data incorreta.';
    case 'order_or_request_status':
      return 'Nao consegui confirmar o andamento da solicitacao automaticamente. Vou deixar o atendimento para verificacao manual.';
    default:
      return 'Nao consegui concluir esta solicitacao automaticamente. Vou deixar o atendimento para verificacao manual com o contexto desta conversa.';
  }
}
