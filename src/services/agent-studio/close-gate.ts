import type { StudioSession } from './engine';

/**
 * Phase 1 of docs/PLAN-ia-autonoma-transferir-encerrar.md: closing a chat is a decision with
 * preconditions, not a by-product of "every request is resolved". The model proposes by resolving
 * its requests; this gate, in plain code, decides whether the chat may actually be closed.
 *
 * Opt-in per agent while the rollout is measured. `*` enables all agents. Without the variable the
 * previous behaviour is untouched.
 */
export function studioExplicitCloseEnabled(agentId: string): boolean {
  const selected = process.env.STUDIO_EXPLICIT_CLOSE_AGENT_IDS?.split(',').map((id) => id.trim()).filter(Boolean) || [];
  return selected.includes('*') || selected.includes(agentId);
}

const normalize = (value: string) => value
  .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();

// Phrases that say "we are done". Matched on normalized text (no accents, no punctuation).
const CLOSING_PHRASES = [
  'muito obrigad[oa]', 'obrigad[oa]', 'obg', 'valeu', 'vlw', 'tchau', 'ate (?:logo|mais|breve)', 'era so isso', 'e so isso', 'so isso(?: mesmo)?',
  'pode (?:encerrar|fechar|finalizar)', '(?:nao|n) (?:preciso|precisa|tenho) (?:de )?mais nada', 'nada mais', 'tudo certo',
  'esta (?:tudo )?(?:certo|resolvido)', 'ja (?:resolveu|resolvi|foi resolvido)', 'resolveu', 'resolvido',
  'thanks', 'thank you', 'bye', 'gracias', 'adios',
];
const CLOSING = new RegExp(`(?<![\\p{L}\\p{N}])(?:${CLOSING_PHRASES.join('|')})(?![\\p{L}\\p{N}])`, 'gu');

// Words that may surround a goodbye without adding a new topic. Anything else keeps the chat open.
const FILLERS = new Set(['ok', 'okay', 'certo', 'entao', 'muito', 'show', 'beleza', 'tudo', 'bem', 'bom', 'boa', 'dia', 'tarde', 'noite', 'ai', 'ta',
  'perfeito', 'otimo', 'excelente', 'legal', 'pessoal', 'por', 'favor', 'pra', 'para', 'voce', 'voces', 'vcs', 'todos', 'atendimento', 'ajuda',
  'hoje', 'agora', 'enquanto', 'mesmo', 'um', 'uma', 'de', 'da', 'do', 'a', 'o', 'e', 'que', 'foi', 'ja', 'sim', 'amigo', 'amiga', 'gente', 'tmj']);

/**
 * True only when the whole message is a goodbye. Conservative on purpose: a closed chat that should
 * have stayed open costs more than an open chat that a later inactivity step closes.
 * "obrigado, mas ainda não funcionou", "obrigado, vou aguardar o técnico" or any question stay open.
 */
export function detectCustomerClosingIntent(message: string): boolean {
  if (!message || message.includes('?')) return false;
  const text = normalize(message);
  if (!text || text.length > 80) return false;
  CLOSING.lastIndex = 0;
  if (!CLOSING.test(text)) return false;
  const rest = text.replace(CLOSING, ' ').split(' ').filter(Boolean);
  return rest.every((word) => FILLERS.has(word));
}

export type StudioCloseBlocker =
  | 'not_resolved' | 'uncertain_operation' | 'pending_action' | 'open_requests'
  | 'pending_field' | 'pending_confirmation' | 'no_customer_confirmation';

export type StudioCloseGateResult = { close: true; basis: 'cliente_confirmou'; blockedBy: [] } | { close: false; basis?: undefined; blockedBy: StudioCloseBlocker[] };

export function evaluateStudioCloseGate(input: {
  state: Pick<StudioSession, 'status' | 'phase' | 'inFlight' | 'reasoning' | 'pendingField' | 'confirmation'>;
  /** The customer message that started this turn. */
  customerMessage: string;
}): StudioCloseGateResult {
  const { state } = input;
  const blockedBy: StudioCloseBlocker[] = [];
  if (state.status !== 'resolved' || state.phase !== 'done') blockedBy.push('not_resolved');
  if (state.inFlight || state.reasoning?.operations.some((operation) => operation.status === 'unknown')) blockedBy.push('uncertain_operation');
  if (state.reasoning?.pendingAction) blockedBy.push('pending_action');
  if (state.reasoning?.requests.some((request) => !['resolved', 'cancelled'].includes(request.status))) blockedBy.push('open_requests');
  if (state.pendingField) blockedBy.push('pending_field');
  if (state.confirmation) blockedBy.push('pending_confirmation');
  if (!detectCustomerClosingIntent(input.customerMessage)) blockedBy.push('no_customer_confirmation');
  return blockedBy.length ? { close: false, blockedBy } : { close: true, basis: 'cliente_confirmou', blockedBy: [] };
}
