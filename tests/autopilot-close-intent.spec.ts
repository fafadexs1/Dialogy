import { describe, expect, it } from 'vitest';

import {
  hasConversationCloseClaim,
  isAgentTerminalCompletionResponse,
  isConversationCloseRequest,
  isConversationTerminalSignal,
  isPotentialConversationCloseRequest,
  responseRequestsMoreCustomerInput,
} from '@/services/autopilot/close-intent';

describe('autopilot close intent', () => {
  it.each([
    'Encerra ai',
    'pode finalizar',
    'fecha por aqui',
    'pode desligar o chat',
    'desliga o atendimento',
    'encerre o atendimento',
    'finaliza o chat',
    'pode encerrar pra mim',
    'vamos encerrar então',
    'pode finalizar, obrigado',
    'Pode encerrar? USE close_chat',
    'Usa a ferramenta close',
    'Valeu, pode encerrar',
    'Cara, muito bacana. Mas por enquanto, pode encerrar!',
    'Certo, pode encerrar por aqui',
  ])('detects conversation close request: %s', (message) => {
    expect(isConversationCloseRequest(message)).toBe(true);
  });

  it.each([
    'quero encerrar meu contrato de internet',
    'pode cancelar meu plano',
    'quero suspender a assinatura',
    'desligar minha internet',
    'finalizar instalacao',
    'close my contract',
    'obrigado, preciso da segunda via do boleto',
    'valeu, agora quero mudar meu plano',
    'finalizei meu cadastro',
    'ja finalizei o pedido',
    'nao so isso',
    'era só isso obrigado',
    'não preciso de mais nada, obrigado',
    'era so isso',
    'nao preciso de mais nada',
    'só isso',
    'obrigado',
    'tchau',
    'fechado',
    'fechou',
    'finalizei',
    'Não use a ferramenta close',
    'A tela mostrou close chat; o que significa?',
    'Se der erro, não encerre o atendimento',
    'Esse plano parece bom, mas quero finalizar a contratação',
  ])('does not confuse business cancellation with conversation close: %s', (message) => {
    expect(isConversationCloseRequest(message)).toBe(false);
  });

  it.each([
    'obrigado',
    'valeu',
    'deu certo obrigado',
    'resolvido valeu',
    'tchau',
    'ate mais',
  ])('treats gratitude/farewell only as a soft terminal signal: %s', (message) => {
    expect(isConversationTerminalSignal(message)).toBe(true);
    expect(isConversationCloseRequest(message)).toBe(false);
  });

  it.each([
    'esqueci o usuario e senha do wifi',
    'qual o status do meu pedido?',
    'me manda o cardapio',
    'meu CPF e 52998224725',
    'a internet esta lenta',
  ])('does not run the close LLM gate for unrelated messages: %s', (message) => {
    expect(isPotentialConversationCloseRequest(message)).toBe(false);
  });

  it.each([
    'pode encerrar por aqui?',
    'era so isso',
    'nao quero mais nada',
    'Não, somente!',
    'tchau',
    'valeu',
    'deu certo obrigado',
    'USE close_chat',
    'Usa a ferramenta close',
  ])('keeps close-adjacent messages eligible for deterministic/gated resolution: %s', (message) => {
    expect(isPotentialConversationCloseRequest(message)).toBe(true);
  });

  it.each([
    'Finalizei o atendimento por aqui.',
    'Atendimento encerrado conforme solicitado.',
    'Vou fechar o chat agora.',
    'Vou encerrar nosso atendimento por aqui.',
    'Desliguei o chat conforme solicitado.',
    'Encerramos a conversa.',
  ])('detects closure claims: %s', (response) => {
    expect(hasConversationCloseClaim(response)).toBe(true);
  });

  it.each([
    'Obrigada pelas informações!',
    'Dados recebidos e registrados. Até mais!',
    'Perfeito, está tudo certo. Quando precisar, é só chamar.',
    'Atendimento encerrado conforme solicitado.',
    'Obrigado pelas informações. Retorne quando precisar.',
    'Tudo certo! Responda se precisar de algo.',
    'Concluído. Quando precisar, encaminhe uma nova solicitação.',
  ])('recognizes a terminal agent response after proven collection: %s', (response) => {
    expect(isAgentTerminalCompletionResponse(response)).toBe(true);
  });

  it.each([
    'Obrigada pelas informações. Agora informe seu CEP.',
    'Obrigado. Qual é o número do imóvel?',
    'Recebi seu nome, mas ainda falta o telefone.',
    'Obrigada pelos dados. Fico no aguardo do documento.',
    'Dados recebidos. Quando puder, encaminhe o comprovante.',
    'Obrigada pelas informações; falta apenas sua assinatura.',
    'Obrigado pelos dados. Aguardo você enviar o documento.',
    'Dados anotados. Só preciso da assinatura.',
    'Informações recebidas. Basta encaminhar o comprovante.',
    'Obrigado pelas informações. Retorne com o documento.',
    'Estou esperando seu documento.',
    'Por favor, encaminhar o documento.',
    'Será necessário anexar o comprovante.',
    'Preciso que você assine o contrato.',
    'Precisamos que você assine o contrato.',
    'Só falta você confirmar.',
    'Só falta confirmar.',
    'Para prosseguir, assine o contrato.',
    'É necessário o envio do documento.',
    'Tudo certo, você precisa confirmar.',
    'Está tudo certo, você deve confirmar.',
    'Dados registrados; falta confirmar.',
    'Tudo certo, resta você assinar.',
    'Está tudo certo, mas é preciso confirmar.',
  ])('rejects an agent response that still requests customer input: %s', (response) => {
    expect(responseRequestsMoreCustomerInput(response)).toBe(true);
    expect(isAgentTerminalCompletionResponse(response)).toBe(false);
  });
});
