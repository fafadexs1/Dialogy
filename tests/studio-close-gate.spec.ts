import { describe, expect, it } from 'vitest';

import { closingClassifierEligible, detectCustomerClosingIntent, evaluateStudioCloseGate } from '@/services/agent-studio/close-gate';
import { createStudioSession, type StudioSession } from '@/services/agent-studio/engine';

describe('customer closing intent', () => {
  it.each([
    'Obrigado!', 'obrigada', 'Muito obrigado', 'valeu', 'Valeu, era só isso', 'era so isso mesmo', 'pode encerrar', 'Pode fechar aí, obrigado',
    'não preciso de mais nada', 'tudo certo, obrigado', 'Ok, obrigado!', 'show, valeu', 'resolveu, obrigado', 'tchau', 'até logo',
    'obrigado, muito bom o atendimento', 'thank you', 'bye',
  ])('accepts a plain goodbye: %s', (message) => {
    expect(detectCustomerClosingIntent(message)).toBe(true);
  });

  it.each([
    'obrigado, mas ainda não funcionou', 'obrigado, vou aguardar o técnico', 'valeu! e a fatura de dezembro?', 'obrigado, só mais uma dúvida',
    'não foi resolvido', 'não resolveu', 'tudo certo? posso mandar o comprovante', 'ok', 'sim', 'quero cancelar', 'obrigado pelo contato mas quero falar com um atendente',
    '', '   ', 'pode encerrar o plano antigo?',
  ])('keeps the chat open when there is more than a goodbye: %s', (message) => {
    expect(detectCustomerClosingIntent(message)).toBe(false);
  });

  it('does not treat a long message as a goodbye even if it thanks', () => {
    expect(detectCustomerClosingIntent(`obrigado ${'conforme combinado '.repeat(10)}`)).toBe(false);
  });
});

const session = (patch: Partial<StudioSession> = {}): StudioSession => ({
  ...createStudioSession('agent-1', 'release-1', 's-1'), status: 'resolved', phase: 'done',
  reasoning: { version: 2, requests: [{ id: 'r1', status: 'resolved' }], operations: [], pendingAction: null } as never, ...patch,
});

describe('close gate', () => {
  it('closes only a resolved session whose customer said goodbye', () => {
    expect(evaluateStudioCloseGate({ state: session(), customerMessage: 'obrigado, era só isso' }))
      .toEqual({ close: true, basis: 'cliente_confirmou', blockedBy: [] });
  });

  it('keeps a resolved session open without the customer confirming', () => {
    expect(evaluateStudioCloseGate({ state: session(), customerMessage: 'manda a segunda via da fatura' }))
      .toEqual({ close: false, blockedBy: ['no_customer_confirmation'] });
  });

  it('blocks on every open loop, even with a goodbye', () => {
    const bye = 'obrigado';
    expect(evaluateStudioCloseGate({ state: session({ status: 'waiting_input', phase: 'resolve' }), customerMessage: bye }).blockedBy).toContain('not_resolved');
    expect(evaluateStudioCloseGate({ state: session({ inFlight: { key: 'k', stepId: 's' } }), customerMessage: bye }).blockedBy).toContain('uncertain_operation');
    expect(evaluateStudioCloseGate({ state: session({ reasoning: { version: 2, requests: [], pendingAction: null,
      operations: [{ status: 'unknown' }] } as never }), customerMessage: bye }).blockedBy).toContain('uncertain_operation');
    expect(evaluateStudioCloseGate({ state: session({ reasoning: { version: 2, requests: [{ id: 'r', status: 'resolved' }], operations: [],
      pendingAction: { kind: 'tool' } } as never }), customerMessage: bye }).blockedBy).toContain('pending_action');
    expect(evaluateStudioCloseGate({ state: session({ reasoning: { version: 2, requests: [{ id: 'r', status: 'active' }], operations: [],
      pendingAction: null } as never }), customerMessage: bye }).blockedBy).toContain('open_requests');
    expect(evaluateStudioCloseGate({ state: session({ pendingField: 'cpf' }), customerMessage: bye }).blockedBy).toContain('pending_field');
    expect(evaluateStudioCloseGate({ state: session({ confirmation: { key: 'k', signature: 's', at: 1 } }), customerMessage: bye }).blockedBy).toContain('pending_confirmation');
  });

  it('reports every reason, not only the first', () => {
    const result = evaluateStudioCloseGate({ state: session({ pendingField: 'cpf', inFlight: { key: 'k', stepId: 's' } }), customerMessage: 'oi' });
    expect(result.blockedBy).toEqual(['uncertain_operation', 'pending_field', 'no_customer_confirmation']);
  });
});

describe('model second opinion', () => {
  const resolved = createStudioSession('agent-1', 'release-1', 's-1');
  const state = { ...resolved, status: 'resolved' as const, phase: 'done' as const,
    reasoning: { version: 2, requests: [{ id: 'r1', status: 'resolved' }], operations: [], pendingAction: null } as never };

  it('is only worth asking for a short message that is not a question or a request for a person', () => {
    expect(closingClassifierEligible('fechou então, até amanhã')).toBe(true);
    expect(closingClassifierEligible('Qual o prazo de instalação?')).toBe(false);
    expect(closingClassifierEligible('quero falar com um atendente')).toBe(false);
    expect(closingClassifierEligible('')).toBe(false);
    expect(closingClassifierEligible('a'.repeat(101))).toBe(false);
  });

  it('can supply the missing confirmation, and nothing else', () => {
    expect(evaluateStudioCloseGate({ state, customerMessage: 'fechou então, até amanhã', confirmedByClassifier: true })).toEqual({ close: true, basis: 'cliente_confirmou', blockedBy: [] });
    expect(evaluateStudioCloseGate({ state: { ...state, pendingField: 'cpf' }, customerMessage: 'fechou então', confirmedByClassifier: true }).blockedBy).toEqual(['pending_field']);
    expect(evaluateStudioCloseGate({ state: { ...state, inFlight: { key: 'k', stepId: 's' } }, customerMessage: 'fechou então', confirmedByClassifier: true }).close).toBe(false);
  });
});
