export type ConfirmationPromptKind =
  | 'generic_confirmation';

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function detectConfirmationPromptKind(message: string): ConfirmationPromptKind | null {
  const normalized = normalize(message);
  if (/\b(posso|pode me confirmar).{0,100}\b(agora|prosseguir|executar|aplicar|confirmar)\b/.test(normalized)) {
    return 'generic_confirmation';
  }
  return null;
}

function buildRecoveryMessage(_kind: ConfirmationPromptKind): string {
  return 'Ainda preciso da sua confirmacao explicita antes de executar essa acao. Se quiser prosseguir, confirme qual acao posso executar agora; se mudou de assunto, diga como posso ajudar.';
}

export function guardRepeatedConfirmationPrompt(input: {
  message: string;
  recentAutomatedMessages: string[];
}): {
  action: 'send' | 'replace' | 'suppress';
  message: string | null;
} {
  const kind = detectConfirmationPromptKind(input.message);

  if (kind) {
    const recoveryMessage = buildRecoveryMessage(kind);
    const alreadyAsked = input.recentAutomatedMessages.some((message) => (
      detectConfirmationPromptKind(message) === kind
    ));

    if (!alreadyAsked) return { action: 'send', message: input.message };
    return { action: 'replace', message: recoveryMessage };
  }

  // Ordinary customer-facing answers must remain under the LLM/workflow
  // policy. Durable response delivery already prevents transport retries from
  // duplicating blocks; textual similarity is not evidence that a conversation
  // is stuck and must never disable an active chat.
  return { action: 'send', message: input.message };
}
