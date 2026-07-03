import { describe, expect, it } from 'vitest';

import {
  hasConversationCloseClaim,
  isConversationCloseRequest,
  isPotentialConversationCloseRequest,
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
    'Pode encerrar? USE close_chat',
    'Usa a ferramenta close',
    'era so isso',
    'nao preciso de mais nada',
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
  ])('does not confuse business cancellation with conversation close: %s', (message) => {
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
    'tchau',
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
});
