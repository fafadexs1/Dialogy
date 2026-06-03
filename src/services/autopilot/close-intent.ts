function normalizeCloseText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const CLOSE_VERB_PATTERN = '(?:encerr\\w*|finaliz\\w*|fech\\w*|deslig\\w*)';
const BUSINESS_OBJECT_PATTERN = '(?:contrato|plano|assinatura|servico|internet|instalacao|instalacao)';
const CONVERSATION_OBJECT_PATTERN = '(?:atendimento|chat|chamado|conversa|contato)';
const OPTIONAL_ARTICLE_PATTERN = '(?:meu|minha|o|a|um|uma|esse|essa|este|esta|seu|sua|nosso|nossa)?';

const businessClosePattern = new RegExp(
  `\\b${CLOSE_VERB_PATTERN}\\s+${OPTIONAL_ARTICLE_PATTERN}\\s*${BUSINESS_OBJECT_PATTERN}\\b`
);

const explicitConversationClosePattern = new RegExp(
  `\\b${CLOSE_VERB_PATTERN}\\s+(?:${OPTIONAL_ARTICLE_PATTERN}\\s*)?${CONVERSATION_OBJECT_PATTERN}\\b`
);

const shortCloseRequestPattern = new RegExp(
  `\\b(?:pode|favor|por favor|quero|queria|poderia|consegue|so|só)?\\s*${CLOSE_VERB_PATTERN}\\b(?!\\s+${BUSINESS_OBJECT_PATTERN})`
);

const doneHerePattern = /\b(?:era|e|eh)\s+so\s+isso\b|\bnao\s+(?:preciso|quero)\s+de\s+mais\s+nada\b/;

export function isConversationCloseRequest(message: string): boolean {
  const normalized = normalizeCloseText(message);
  if (!normalized) return false;

  if (/\b(cancelar|cancelamento|rescindir|suspender)\b/.test(normalized)) return false;
  if (/\bnao\s+(?:encerra|encerrar|finaliza|finalizar|fecha|fechar|desliga|desligar)\b/.test(normalized)) return false;
  if (businessClosePattern.test(normalized)) return false;
  if (
    !explicitConversationClosePattern.test(normalized) &&
    (
      /\bfech\w*\b.*\b(hoje|depois|negocio|venda|comercial|contratar|contratacao|assinar|plano|pedido)\b/.test(normalized) ||
      /\b(comparar|planos?|contratar|comercial|loja|ponto)\b.*\bfech\w*\b/.test(normalized)
    )
  ) {
    return false;
  }

  return (
    explicitConversationClosePattern.test(normalized) ||
    shortCloseRequestPattern.test(normalized) ||
    doneHerePattern.test(normalized)
  );
}

export function hasConversationCloseClaim(response: string): boolean {
  const normalized = normalizeCloseText(response);
  if (!normalized) return false;

  const closeClaimPattern = new RegExp(
    `\\b(?:atendimento|chat|chamado|conversa)\\s+(?:sera|foi|esta|ficara|ficou)?\\s*${CLOSE_VERB_PATTERN}`
  );
  const firstPersonClosePattern = new RegExp(
    `\\b(?:encerrei|finalizei|fechei|desliguei|encerramos|finalizamos|fechamos|desligamos)\\s+(?:o|a)?\\s*${CONVERSATION_OBJECT_PATTERN}\\b`
  );
const promiseClosePattern = new RegExp(
    `\\b(?:vou|irei|vamos|posso)\\s+${CLOSE_VERB_PATTERN}\\s+(?:${OPTIONAL_ARTICLE_PATTERN}\\s*)?${CONVERSATION_OBJECT_PATTERN}\\b`
  );

  return (
    closeClaimPattern.test(normalized) ||
    firstPersonClosePattern.test(normalized) ||
    promiseClosePattern.test(normalized) ||
    /\bencerrado\s+conforme\s+solicitado\b/.test(normalized)
  );
}
