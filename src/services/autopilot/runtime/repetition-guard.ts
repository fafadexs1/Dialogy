export type ConfirmationPromptKind =
  | 'generic_confirmation';

const GENERIC_LOOP_RECOVERY_MESSAGE =
  'Percebi que minha resposta anterior nao resolveu sua solicitacao. Para evitar repetir a mesma mensagem, pausei esta tentativa automatica. Descreva o pedido com mais detalhes ou solicite atendimento humano.';

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripAgentSignature(value: string): string {
  return value.replace(
    /^\s*\*?[^*\n:]+?\s+\(Agente Virtual\)\*?\s*:?\s*/i,
    '',
  );
}

function normalizeComparableMessage(value: string): string {
  return normalize(stripAgentSignature(value));
}

function calculateTokenOverlap(left: string, right: string): number {
  const leftTokens = new Set(left.split(' ').filter((token) => token.length >= 3));
  const rightTokens = new Set(right.split(' ').filter((token) => token.length >= 3));
  if (leftTokens.size < 6 || rightTokens.size < 6) return 0;

  const sharedTokens = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return sharedTokens / Math.max(leftTokens.size, rightTokens.size);
}

function isRepeatedComparableMessage(message: string, recentMessage: string): boolean {
  if (message === recentMessage) return true;
  if (Math.min(message.length, recentMessage.length) < 80) return false;
  return calculateTokenOverlap(message, recentMessage) >= 0.82;
}

export function detectConfirmationPromptKind(message: string): ConfirmationPromptKind | null {
  const normalized = normalize(message);
  if (/\b(posso|pode me confirmar).{0,100}\b(agora|prosseguir|executar|aplicar|confirmar)\b/.test(normalized)) {
    return 'generic_confirmation';
  }
  return null;
}

function buildRecoveryMessage(_kind: ConfirmationPromptKind): string {
  return 'Para evitar repetir a mesma pergunta, pausei esta tentativa. Se ainda quiser autorizar, confirme explicitamente qual acao posso executar agora.';
}

export function guardRepeatedConfirmationPrompt(input: {
  message: string;
  recentAutomatedMessages: string[];
}): {
  action: 'send' | 'replace' | 'suppress';
  message: string | null;
} {
  const kind = detectConfirmationPromptKind(input.message);
  const recentMessages = input.recentAutomatedMessages.map(normalizeComparableMessage);

  if (kind) {
    const recoveryMessage = buildRecoveryMessage(kind);
    const normalizedRecovery = normalizeComparableMessage(recoveryMessage);
    const alreadyAsked = input.recentAutomatedMessages.some((message) => (
      detectConfirmationPromptKind(message) === kind
    ));

    if (!alreadyAsked) return { action: 'send', message: input.message };
    if (recentMessages.some((message) => message.includes(normalizedRecovery))) {
      return { action: 'suppress', message: null };
    }

    return { action: 'replace', message: recoveryMessage };
  }

  const normalizedMessage = normalizeComparableMessage(input.message);
  if (!normalizedMessage || normalizedMessage === normalizeComparableMessage(GENERIC_LOOP_RECOVERY_MESSAGE)) {
    return { action: 'send', message: input.message };
  }

  if (!recentMessages.some((message) => isRepeatedComparableMessage(normalizedMessage, message))) {
    return { action: 'send', message: input.message };
  }

  if (recentMessages.includes(normalizeComparableMessage(GENERIC_LOOP_RECOVERY_MESSAGE))) {
    return { action: 'suppress', message: null };
  }

  return { action: 'replace', message: GENERIC_LOOP_RECOVERY_MESSAGE };
}
