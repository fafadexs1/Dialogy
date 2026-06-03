import { describe, expect, it } from 'vitest';

import { hasConversationCloseClaim, isConversationCloseRequest } from '@/services/autopilot/close-intent';

describe('autopilot close intent', () => {
  it.each([
    'Encerra ai',
    'pode finalizar',
    'fecha por aqui',
    'pode desligar o chat',
    'desliga o atendimento',
    'encerre o atendimento',
    'finaliza o chat',
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
  ])('does not confuse business cancellation with conversation close: %s', (message) => {
    expect(isConversationCloseRequest(message)).toBe(false);
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
