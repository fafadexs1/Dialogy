import { describe, expect, it } from 'vitest';

import { buildHandoffBriefing, HANDOFF_REASON_CODES, isHandoffReasonCode, resolveHandoffReasonCode } from '@/services/agent-studio/handoff-reasons';

describe('handoff reason codes', () => {
  it('accepts only the closed vocabulary', () => {
    for (const code of HANDOFF_REASON_CODES) expect(isHandoffReasonCode(code)).toBe(true);
    expect(isHandoffReasonCode('qualquer_coisa')).toBe(false);
    expect(isHandoffReasonCode(undefined)).toBe(false);
  });

  it('keeps the model-declared code when valid', () => {
    expect(resolveHandoffReasonCode({ declared: 'fora_de_escopo', reason: 'texto qualquer' })).toBe('fora_de_escopo');
  });

  it('ignores an invalid or empty declaration and classifies the text', () => {
    expect(resolveHandoffReasonCode({ declared: 'inventado', reason: 'A conversa atingiu o limite de mensagens sem conclusão.' })).toBe('limite_de_turnos');
    expect(resolveHandoffReasonCode({ declared: 'nao_classificado', reason: 'A consulta às fontes está indisponível.' })).toBe('falha_de_ferramenta');
  });

  it('lets a customer asking for a person outrank everything', () => {
    expect(resolveHandoffReasonCode({ declared: 'falha_de_ferramenta', customerAskedForHuman: true })).toBe('cliente_pediu');
  });

  it.each([
    ['O cliente pediu atendimento humano.', 'cliente_pediu'],
    ['O cliente solicitou ou aceitou atendimento humano.', 'cliente_pediu'],
    ['A conversa atingiu o limite de mensagens sem conclusão.', 'limite_de_turnos'],
    ['O procedimento atingiu o limite de repetições.', 'limite_de_turnos'],
    ['A sessão atingiu o limite de ações permitido.', 'limite_de_turnos'],
    ['A solicitação continuou ambígua após as tentativas de esclarecimento.', 'incerteza_alta'],
    ['Não foi possível identificar um procedimento adequado.', 'incerteza_alta'],
    ['Uma operação anterior ficou sem confirmação de resultado. É necessária conferência antes de repetir.', 'operacao_incerta'],
    ['O cliente mudou de solicitação após uma ação já executada. A equipe deve conferir a operação incompleta.', 'operacao_incerta'],
    ['A consulta às fontes está indisponível.', 'falha_de_ferramenta'],
    ['A identificação da solicitação está indisponível.', 'configuracao_invalida'],
    ['A configuração tentou solicitar um dado proibido: senha.', 'configuracao_invalida'],
    ['Cliente ameaça acionar o Procon e quer cancelar o contrato.', 'reclamacao_grave'],
    ['O cliente informou que a solicitação não foi resolvida.', 'reclamacao_grave'],
    ['Cliente pediu revisão humana.', 'cliente_pediu'],
    ['Suspeita de fraude na conta do cliente.', 'risco_sensivel'],
    ['Isso está fora do escopo do que a IA pode resolver.', 'fora_de_escopo'],
  ])('classifies %s', (reason, expected) => {
    expect(resolveHandoffReasonCode({ reason })).toBe(expected);
  });

  it('falls back to nao_classificado, never to a guess', () => {
    expect(resolveHandoffReasonCode({ reason: 'Passando adiante.' })).toBe('nao_classificado');
    expect(resolveHandoffReasonCode({})).toBe('nao_classificado');
  });
});

describe('handoff briefing', () => {
  const base = {
    reasonCode: 'operacao_incerta' as const,
    reason: 'Não foi possível confirmar a troca de plano.',
    requests: [{ objective: 'Trocar o plano para 600 MEGA', status: 'active', values: { plano: '600', senha_wifi: 'segredo123', cpf: '123.456.789-00' }, choiceLabels: { plano: '600 MEGA' } }],
    operations: [
      { title: 'Consultar contrato', status: 'succeeded', readOnly: true },
      { title: 'Alterar plano', status: 'unknown', readOnly: false },
      { title: 'Transferir atendimento', status: 'succeeded' },
    ],
  };

  it('states the reason, requests, what was done and what is pending', () => {
    const text = buildHandoffBriefing(base);
    expect(text).toContain('Motivo: Uma operação ficou sem confirmação');
    expect(text).toContain('Trocar o plano para 600 MEGA (em andamento)');
    expect(text).toContain('plano: 600 MEGA');
    expect(text).toContain('Consultar contrato: feito (consulta)');
    expect(text).toContain('Alterar plano: sem confirmação, conferir antes de repetir');
    expect(text).toContain('confira no sistema externo antes de repetir');
    expect(text).not.toContain('Transferir atendimento');
  });

  it('never prints secrets, but keeps what the human needs to avoid asking again', () => {
    const text = buildHandoffBriefing(base);
    expect(text).not.toContain('segredo123');
    expect(text).toContain('cpf: 123.456.789-00');
  });

  it('mentions the queue when nobody was available', () => {
    expect(buildHandoffBriefing({ ...base, queued: { teamName: 'Financeiro' } })).toContain('equipe Financeiro sem ninguém disponível');
  });

  it('flags a run that ran out of budget and a proposal waiting for the customer', () => {
    const text = buildHandoffBriefing({ reasonCode: 'limite_de_turnos', requests: [], operations: [], budgetReached: true, pendingActionText: 'Confirmar a troca para 600 MEGA?' });
    expect(text).toContain('atingiu o limite de tempo ou de tentativas');
    expect(text).toContain('Aguardando o cliente confirmar: Confirmar a troca para 600 MEGA?');
  });

  it('stays compact on a long session', () => {
    const requests = Array.from({ length: 20 }, (_, i) => ({ objective: `Pedido ${i} ${'x'.repeat(300)}`, status: 'active', values: { [`k${i}`]: 'v'.repeat(300) } }));
    expect(buildHandoffBriefing({ reasonCode: 'nao_classificado', requests, operations: [] }).length).toBeLessThan(3500);
  });
});
