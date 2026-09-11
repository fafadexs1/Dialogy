export type StudioConversationControl =
  | 'answer'
  | 'cancel_procedure'
  | 'skip_field'
  | 'change_intent'
  | 'request_human'
  | 'conclude';

const normalize = (value: string) => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^\p{L}\p{N}\s]/gu, ' ')
  .replace(/\s+/g, ' ')
  .trim();

export function detectExplicitStudioConversationControl(message: string): StudioConversationControl {
  const text = normalize(message);
  if (!text) return 'answer';

  if (
    /\b(quero|preciso|chama|chamar|falar com)\b.{0,30}\b(humano|atendente|pessoa|equipe|especialista)\b/.test(text)
    || /\b(human agent|real person|talk to support|speak to someone)\b/.test(text)
    || /\b(hablar con|quiero un)\b.{0,20}\b(agente|persona|humano)\b/.test(text)
  ) return 'request_human';

  if (
    /^(obrigad[oa]|muito obrigad[oa]|valeu|valeu obrigado|obrigado valeu|era so isso|so isso mesmo|era so isso mesmo|pode encerrar|pode fechar|pode finalizar|nao preciso de mais nada|nao precisa de mais nada|tudo certo obrigado|tchau|tchau obrigado|ate logo|ate mais)( por enquanto| por hoje| agora)?$/.test(text)
    || /^(thanks|thank you|that s all|that is all|bye|goodbye|have a good day)$/.test(text)
    || /^(gracias|muchas gracias|eso es todo|adios|hasta luego)$/.test(text)
  ) return 'conclude';

  if (
    /^(nao precisa|nao e necessario|deixa pra la|deixe pra la|esquece|esqueca|pode parar|pare|para por aqui|cancela isso|cancele isso|nao quero continuar|nao vou continuar|nao quero responder|nao vou responder|nao quero fazer isso)( agora)?$/.test(text)
    || /^(never mind|no need|i don t need it|stop|stop this|cancel this|i don t want to continue)$/.test(text)
    || /^(no hace falta|dejalo|dejalo asi|olvidalo|cancela esto|no quiero continuar)$/.test(text)
  ) return 'cancel_procedure';

  if (
    /^(prefiro nao responder|quero pular|pula isso|pule isso|ignora essa pergunta|ignore essa pergunta|nao sei responder)$/.test(text)
    || /^(skip|skip this|prefer not to answer|i don t know)$/.test(text)
    || /^(prefiero no responder|saltar|omite esto|no se responder)$/.test(text)
  ) return 'skip_field';

  if (
    /\b(mudar de assunto|outro assunto|outra coisa|na verdade (eu )?quero|quero falar sobre)\b/.test(text)
    || /\b(change (the )?subject|something else|actually i want)\b/.test(text)
    || /\b(cambiar de tema|otra cosa|en realidad quiero)\b/.test(text)
  ) return 'change_intent';

  return 'answer';
}

export function studioMessageMayContainConversationControl(message: string) {
  const text = normalize(message);
  return /\b(nao|não|parar|pare|pular|ignorar|cancel|deixa|esquece|outro|outra|mudar|prefiro|need|stop|skip|never|change|human|agent|dejalo|saltar|cambiar|obrigad|valeu|tchau|encerrar|finalizar|fechar|thanks|bye)\b/.test(text);
}

const responseFingerprint = (value: string) => normalize(value).replace(/\s+/g, ' ');

export function guardRepeatedStudioResponse(input: {
  response: string;
  recentResponses: string[];
  procedureActive: boolean;
  pendingPrompt?: string;
}) {
  const fingerprint = responseFingerprint(input.response);
  if (fingerprint.length < 120) return input.response;
  const repeated = input.recentResponses.some((recent) => responseFingerprint(recent) === fingerprint);
  if (!repeated) return input.response;
  if (input.pendingPrompt?.trim()) return `Para continuar: ${input.pendingPrompt.trim()}`;
  return input.procedureActive
    ? 'Para não repetir a mesma informação, vou parar aqui e seguir do ponto em que já estamos. Diga o próximo passo que você deseja ou escreva “não precisa” para interromper este procedimento.'
    : 'Essa informação já foi enviada. Qual parte você quer esclarecer ou qual próximo passo deseja seguir?';
}
