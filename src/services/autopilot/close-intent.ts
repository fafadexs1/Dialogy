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
const CLOSE_COMMAND_PATTERN = '(?:encerrar|encerre|encerra|finalizar|finalize|finaliza|fechar|feche|fecha|desligar|desligue|desliga)';
const BUSINESS_OBJECT_PATTERN = '(?:contrato|plano|assinatura|servico|internet|instalacao|instalacao)';
const CONVERSATION_OBJECT_PATTERN = '(?:atendimento|chat|chamado|conversa|contato)';
const OPTIONAL_ARTICLE_PATTERN = '(?:meu|minha|o|a|um|uma|esse|essa|este|esta|seu|sua|nosso|nossa)?';

const businessClosePattern = new RegExp(
  `\\b${CLOSE_VERB_PATTERN}\\s+${OPTIONAL_ARTICLE_PATTERN}\\s*${BUSINESS_OBJECT_PATTERN}\\b`
);

const explicitConversationClosePattern = new RegExp(
  `\\b${CLOSE_VERB_PATTERN}\\s+(?:${OPTIONAL_ARTICLE_PATTERN}\\s*)?${CONVERSATION_OBJECT_PATTERN}\\b`
);

const explicitConversationCloseRequestPattern = new RegExp(
  `^(?:(?:pode|por favor|favor|quero|queria|poderia|consegue|gostaria de|preciso|vamos)\\s+)?${CLOSE_COMMAND_PATTERN}(?:\\s+(?:o|a|meu|minha|esse|essa|este|esta)?\\s*${CONVERSATION_OBJECT_PATTERN})?(?:\\s+(?:ai|aqui|agora|por aqui|por favor|favor|isso|pra mim|para mim|entao|obrigad[ao]|valeu))*(?:\\s+(?:use|usa|execute)\\s+close\\s+chat)?$`
);

// A ordem de encerramento frequentemente vem depois de uma despedida natural,
// em vez de chegar como frase isolada. Este sufixo cobre esses casos sem
// remover as protecoes abaixo contra cancelamento de plano, pedido ou contrato.
const contextualConversationCloseRequestPattern = new RegExp(
  `(?:^por\\s+enquanto\\s+|\\b(?:mas|entao|certo|ok|okay|beleza|show|perfeito|valeu|obrigad[ao])\\s+(?:por\\s+enquanto\\s+)?)(?:(?:pode|por favor|favor|quero|queria|poderia|consegue|gostaria de|preciso|vamos)\\s+)?${CLOSE_COMMAND_PATTERN}(?:\\s+(?:o|a|meu|minha|esse|essa|este|esta)?\\s*${CONVERSATION_OBJECT_PATTERN})?(?:\\s+(?:ai|aqui|agora|por aqui|por favor|favor|isso|pra mim|para mim|entao|obrigad[ao]|valeu))*$`
);

const terminalGoodbyePattern = /^(?:(?:ok|okay|certo|perfeito|show|beleza|blz|tudo certo|deu certo|funcionou|(?:ficou\s+)?resolvido)\s+)?(?:obrigad[ao]|valeu|agradeco|grato|tchau|ate mais|ate logo|por enquanto)(?:\s+(?:mesmo|viu|tudo certo|ate mais|ate logo|por enquanto|obrigad[ao]|valeu))*$/;

const businessOrTaskCompletionPattern =
  /\b(?:cadastro|pedido|solicitacao|formulario|compra|pagamento|agendamento|instalacao|contratacao|orcamento|registro)\b/;

/**
 * A despedida e um sinal de que a conversa talvez tenha terminado, mas nao e
 * autorizacao suficiente para mudar o estado do chat. O runtime combina este
 * sinal com evidencia server-side de que o objetivo do fluxo foi concluido.
 */
export function isConversationTerminalSignal(message: string): boolean {
  const normalized = normalizeCloseText(message);
  if (!normalized || normalized.length > 240) return false;
  return terminalGoodbyePattern.test(normalized);
}

/**
 * Detects when an agent-facing response still asks the customer for data.
 * This is intentionally stricter than checking for a question mark because
 * models often emit imperative requests without punctuation.
 */
export function responseRequestsMoreCustomerInput(response: string): boolean {
  const normalized = normalizeCloseText(response);
  if (!normalized) return false;
  if (/[?？]/.test(response)) return true;

  return (
    /\b(?:informe|envie|passe|forneca|digite|confirme|compartilhe|mande)\b/.test(normalized)
    || /\b(?:qual|quais|quanto|quantos|quando|onde|como)\s+(?:e|sao|foi|seria|fica|ficam|esta|estao|voce)\b/.test(normalized)
    || /\b(?:preciso|necessito|ainda falta|faltou)\b.{0,60}\b(?:nome|cpf|cnpj|documento|cep|endereco|telefone|email|dado|informacao|numero|complemento)\b/.test(normalized)
    || /\b(?:fico|ficamos|estou|estamos)\s+(?:no\s+)?aguardo\b.{0,90}\b(?:documento|dado|informacao|retorno|resposta|confirmacao|assinatura|anexo|comprovante|envio)\b/.test(normalized)
    || /\b(?:aguardo|aguardamos|aguardando)\b.{0,90}\b(?:enviar|encaminhar|retornar|responder|assinar|anexar|documento|dado|informacao|assinatura|anexo|comprovante)\b/.test(normalized)
    || /\bquando\s+(?:puder|possivel|conseguir)\b.{0,90}\b(?:envie|encaminhe|mande|retorne|confirme|assine|responda)\b/.test(normalized)
    || /\b(?:falta|resta|ficou\s+faltando|esta\s+pendente)\b.{0,70}\b(?:documento|dado|informacao|confirmacao|assinatura|anexo|comprovante|envio|retorno)\b/.test(normalized)
    || /\b(?:so|somente)\s+(?:preciso|precisamos|falta|faltam)\b.{0,80}\b(?:documento|dado|informacao|confirmacao|assinatura|anexo|comprovante|envio|retorno)\b/.test(normalized)
    || /\bbasta\s+(?:enviar|encaminhar|mandar|retornar|responder|confirmar|assinar|anexar)\b/.test(normalized)
    || /\b(?:retorne|responda|assine|anexe|encaminhe)\b.{0,70}\b(?:documento|dado|informacao|confirmacao|assinatura|anexo|comprovante|formulario)\b/.test(normalized)
    || /\b(?:estou|estamos|fico|ficamos)\s+esperando\b.{0,80}\b(?:documentos?|dados?|informacoes?|retorno|resposta|confirmacao|assinatura|anexo|comprovante|envio)\b/.test(normalized)
    || /\b(?:por\s+favor\s+)?(?:enviar|envie|encaminhar|encaminhe|mandar|mande|retornar|retorne|responder|responda|confirmar|confirme|assinar|assine|anexar|anexe)\b.{0,70}\b(?:documentos?|dados?|informacoes?|confirmacao|assinatura|anexo|comprovante|formulario|contrato)\b/.test(normalized)
    || /\b(?:sera|e|eh)\s+necessari[oa]\b.{0,70}\b(?:enviar|encaminhar|mandar|retornar|responder|confirmar|assinar|anexar)\b/.test(normalized)
    || /\b(?:sera|e|eh)\s+necessari[oa]\b.{0,70}\b(?:envio|retorno|resposta|confirmacao|assinatura|anexo|comprovante|documento|dado|informacao)\b/.test(normalized)
    || /\b(?:preciso|precisamos|necessito|necessitamos)\s+que\s+voce\b.{0,50}\b(?:envie|encaminhe|mande|retorne|responda|confirme|assine|anexe)\b/.test(normalized)
    || /\b(?:so|somente)\s+falta(?:\s+voce)?\b.{0,40}\b(?:confirmar|assinar|enviar|encaminhar|mandar|retornar|responder|anexar)\b/.test(normalized)
    || /\bvoce\s+(?:ainda\s+)?(?:precisa|deve|precisara|tem\s+que|tera\s+que)\b.{0,50}\b(?:confirmar|assinar|enviar|encaminhar|mandar|retornar|responder|anexar)\b/.test(normalized)
    || /\b(?:ainda\s+)?(?:falta|resta)(?:\s+(?:so|somente|apenas))?(?:\s+voce)?\b.{0,40}\b(?:confirmar|assinar|enviar|encaminhar|mandar|retornar|responder|anexar)\b/.test(normalized)
    || /\b(?:e|eh)\s+preciso\b.{0,50}\b(?:confirmar|assinar|enviar|encaminhar|mandar|retornar|responder|anexar)\b/.test(normalized)
  );
}

/**
 * A terminal response is only a presentation signal. The runtime still
 * requires server-side evidence of a real collection cycle before closing.
 */
export function isAgentTerminalCompletionResponse(response: string): boolean {
  const normalized = normalizeCloseText(response);
  if (!normalized || normalized.length > 1_200) return false;
  if (responseRequestsMoreCustomerInput(response)) return false;
  if (hasConversationCloseClaim(response)) return true;

  const acknowledgesCollectedInformation = (
    /\b(?:obrigad[ao]|agradeco|agradecemos)\b.{0,45}\b(?:informacoes|dados|respostas|detalhes|envio|retorno)\b/.test(normalized)
    || /\b(?:informacoes|dados|respostas|detalhes)\b.{0,45}\b(?:recebid[ao]s?|registrad[ao]s?|anotad[ao]s?|salv[ao]s?|confirmad[ao]s?|complet[ao]s?)\b/.test(normalized)
    || /\b(?:recebi|registramos|registrei|anotei|salvei|coletei|confirmamos)\b.{0,60}\b(?:tudo|informacoes|dados|respostas|detalhes)\b/.test(normalized)
  );
  const completionLanguage = (
    /\b(?:tudo certo|esta tudo certo|pronto|concluido|concluida|finalizado|finalizada|cadastro concluido|solicitacao registrada)\b/.test(normalized)
    || /\b(?:ate mais|ate logo|quando precisar|sempre que precisar|entraremos em contato|retornaremos em breve)\b/.test(normalized)
  );

  return acknowledgesCollectedInformation || completionLanguage || isConversationTerminalSignal(response);
}

export function isConversationCloseRequest(message: string): boolean {
  const normalized = normalizeCloseText(message);
  if (!normalized) return false;

  if (/\b(cancelar|cancelamento|rescindir|suspender)\b/.test(normalized)) return false;
  if (/\b(?:nao|nunca|jamais|sem)\b.{0,40}\b(?:close|encerr\w*|finaliz\w*|fech\w*|deslig\w*)\b/.test(normalized)) return false;
  if (/^(?:use|usa|execute) (?:a )?ferramenta close(?: chat)?$/.test(normalized)) return true;
  if (/\b(?:ferramenta|comando|tela|mensagem|erro|texto|botao|significa|como funciona|o que e|o que significa)\b.{0,60}\bclose\b/.test(normalized)) return false;
  if (/\bclose\b.{0,60}\b(?:significa|como funciona|o que e|o que significa)\b/.test(normalized)) return false;
  if (/^(?:close|close chat|pode (?:usar|executar) close(?: chat)?|execute close(?: chat)?)$/.test(normalized)) return true;
  if (/\bnao\s+(?:so|somente)\s+isso\b/.test(normalized)) return false;
  if (businessClosePattern.test(normalized)) return false;
  if (
    businessOrTaskCompletionPattern.test(normalized) &&
    !explicitConversationClosePattern.test(normalized)
  ) return false;
  if (
    !explicitConversationCloseRequestPattern.test(normalized) &&
    (
      /\bfech\w*\b.*\b(hoje|depois|negocio|venda|comercial|contratar|contratacao|assinar|plano|pedido)\b/.test(normalized) ||
      /\b(comparar|planos?|contratar|comercial|loja|ponto)\b.*\bfech\w*\b/.test(normalized)
    )
  ) {
    return false;
  }

  return (
    explicitConversationCloseRequestPattern.test(normalized) ||
    contextualConversationCloseRequestPattern.test(normalized)
  );
}

export function isPotentialConversationCloseRequest(message: string): boolean {
  const normalized = normalizeCloseText(message);
  if (!normalized || normalized.length > 320) return false;
  return (
    /\b(encerr|finaliz|fech|deslig|termin|acabar|fim|tchau|close)\w*/.test(normalized) ||
    /\b(?:era|e|eh)\s+so\s+isso\b/.test(normalized) ||
    /\bnao\s+(?:preciso|quero)(?:\s+de)?\s+mais\s+nada\b/.test(normalized) ||
    /\bnao\s+(?:somente|so\s+isso)\b/.test(normalized) ||
    /\bso\s+isso\b/.test(normalized) ||
    isConversationTerminalSignal(message)
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
