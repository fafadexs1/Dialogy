import { describe, expect, it } from 'vitest';

import { detectHumanRequest } from '@/services/agent-studio/human-request';

describe('human request detection', () => {
  it.each([
    'quero falar com um atendente', 'Quero falar com uma pessoa', 'preciso de um atendente humano', 'gostaria de falar com alguém',
    'me passa pra um atendente por favor', 'transfere para uma pessoa de verdade', 'chama um humano', 'Chame um atendente',
    'atendimento humano', 'quero atendimento humano', 'pessoa de verdade, por favor', 'não quero falar com robô', 'não aguento mais esse bot',
    'quero falar com o gerente', 'preciso falar com o supervisor', 'conversar com o responsável',
    'I want to talk to a human', 'speak to someone please', 'quiero hablar con un agente', 'necesito una persona',
  ])('detects: %s', (message) => {
    expect(detectHumanRequest(message)).toBe(true);
  });

  it.each([
    'quanto custa o plano de 600 mega?', 'oi, bom dia', 'pode chamar o técnico?', 'preciso de uma pessoa para instalar o roteador',
    'o atendente foi muito educado', 'vocês têm atendente aos domingos?', 'tem algum atendente de plantão?', 'meu cpf é 123.456.789-00',
    'obrigado', 'quero contratar o plano', 'a pessoa que atendeu me passou o valor errado', '', '   ',
  ])('ignores: %s', (message) => {
    expect(detectHumanRequest(message)).toBe(false);
  });

  it('ignores a very long message', () => {
    expect(detectHumanRequest(`quero falar com um atendente ${'texto '.repeat(80)}`)).toBe(false);
  });
});
