import { describe, expect, it } from 'vitest';

import { guardStudioPromises, type StudioPromiseFacts } from '@/services/agent-studio/promise-guard';

const none: StudioPromiseFacts = { transferred: false, closing: false, successfulWrites: 0, successfulOperations: 0 };
const check = (response: string, facts: Partial<StudioPromiseFacts> = {}) => guardStudioPromises({ response, facts: { ...none, ...facts } });

describe('promises the AI cannot back', () => {
  it.each([
    ['Já encaminhei seu atendimento para o financeiro.', 'transfer'],
    ['Vou te transferir para um atendente agora.', 'transfer'],
    ['Seu atendimento foi encaminhado para a equipe comercial.', 'transfer'],
    ['Vou encerrar o atendimento por aqui, obrigado!', 'close'],
    ['Encerrei seu atendimento.', 'close'],
    ['Reservei o horário de quinta para a instalação.', 'action'],
    ['Cancelei o plano antigo e ativei o novo.', 'action'],
    ['Seu plano foi alterado com sucesso.', 'action'],
    ['Abri um chamado para o técnico.', 'action'],
    ['Enviei o boleto para o seu WhatsApp.', 'delivery'],
    ['Gerei a segunda via da fatura.', 'action'],
  ])('flags "%s" as %s when nothing happened', (text, kind) => {
    const result = check(text);
    expect(result.violations).toEqual([{ kind }]);
    expect(result.changed).toBe(true);
  });

  it('lets each claim through when the matching fact is true', () => {
    expect(check('Já encaminhei seu atendimento.', { transferred: true }).changed).toBe(false);
    expect(check('Vou encerrar o atendimento, obrigado!', { closing: true }).changed).toBe(false);
    expect(check('Reservei o horário de quinta.', { successfulWrites: 1 }).changed).toBe(false);
    expect(check('Enviei o boleto para você.', { successfulOperations: 1 }).changed).toBe(false);
  });

  it('does not mistake a read for a write', () => {
    expect(check('Alterei o seu plano.', { successfulOperations: 3, successfulWrites: 0 }).violations).toEqual([{ kind: 'action' }]);
  });

  it('ignores offers, questions and conditional phrasing', () => {
    for (const text of [
      'Posso agendar a visita para quinta?', 'Quer que eu reserve esse horário?', 'Assim que o pagamento for confirmado, vou encerrar o atendimento.',
      'Se quiser, posso transferir você para um atendente.', 'Caso queira, eu cancelo o plano antigo.', 'Quando eu confirmar, te aviso.',
    ]) expect(check(text).violations).toEqual([]);
  });

  it('keeps ordinary answers untouched, including commercial text it does not judge', () => {
    const text = 'O plano de 600 MEGA custa R$ 89,99 por mês. A instalação costuma levar até 48 horas.';
    expect(check(text)).toEqual({ response: text, violations: [], changed: false });
  });

  it('drops only the unsupported sentence and keeps the useful ones', () => {
    const result = check('Encontrei o seu contrato ativo. Já cancelei o plano antigo. Você tem 2 faturas em aberto.');
    expect(result.response).toBe('Encontrei o seu contrato ativo. Você tem 2 faturas em aberto.');
    expect(result.violations).toEqual([{ kind: 'action' }]);
  });

  it('replaces a reply that was nothing but the false claim with a neutral line', () => {
    expect(check('Já encaminhei seu atendimento.').response).toBe('Estou confirmando o melhor caminho para seguir com o seu atendimento e já te retorno.');
    expect(check('Vou encerrar o atendimento.').response).toBe('Antes de finalizar, me diga se posso ajudar em mais alguma coisa.');
  });

  it('reports every kind it found', () => {
    expect(check('Encaminhei você. Reservei o horário. Vou encerrar o atendimento.').violations.map((v) => v.kind)).toEqual(['transfer', 'action', 'close']);
  });

  it('is accent- and case-insensitive', () => {
    expect(check('JÁ ENCAMINHEI SEU ATENDIMENTO.').violations).toEqual([{ kind: 'transfer' }]);
  });
});
