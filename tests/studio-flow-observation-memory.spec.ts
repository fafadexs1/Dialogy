import { describe, expect, it, vi } from 'vitest';
import { createStudioFlowState, filterStudioApplicationObservations, runStudioFlowInvocation, selectStudioFlowObservations, type StudioFlowDecision, type StudioFlowState } from '@/services/agent-studio/flow-execution';
import { studioFlowRelease } from './fixtures/studio-flow-fixture';

describe('Studio tool observation memory', () => {
  it('exclui resultados da conta anterior, conexões removidas e memória apagada, preservando ferramentas locais', () => {
    const observation = (name: string, sourceKey?: string, observedAt = '2026-11-05T12:00:00.000Z'): StudioFlowState['observations'][number] => ({ name, sourceKey, observedAt, result: { status: 'completed', response: '', data: { name } } });
    const entries = [observation('calendar', 'old'), observation('calendar', 'new'), observation('mail', 'removed'), observation('calendar'), observation('calculator')];
    const identities = new Map<string, string | undefined>([['calendar', 'new'], ['mail', undefined]]);
    expect(filterStudioApplicationObservations(entries, identities, null)).toEqual([entries[1], entries[4]]);
    expect(filterStudioApplicationObservations(entries, identities, '2026-11-05T12:00:00.000Z')).toEqual([entries[4]]);
  });

  it('não envia ao modelo observações de uma conta trocada ao retomar a execução', async () => {
    const release = studioFlowRelease(); const state = createStudioFlowState(release.releaseId);
    state.observations = [{ name: 'calendar', sourceKey: 'old-account', observedAt: '2026-11-05T12:00:00.000Z', result: { status: 'completed', response: '', data: { private: 'old-event' } } }];
    const generate = vi.fn(async () => ({ kind: 'completed' as const, response: 'Pronto', data: { answer: 'ok' } }));
    await runStudioFlowInvocation({ release, state, generate, mode: 'task', data: {}, message: 'Continuar', messageId: 'm2',
      budget: { modelCalls: 0, toolCalls: 0, maxModelCalls: 8, maxToolCalls: 20, deadline: Date.now() + 10000, stack: [] },
      capabilities: [{ name: 'calendar', memoryKey: 'new-account', description: '', inputSchema: {}, invoke: async () => ({ status: 'completed', response: '', data: {} }) }],
      applicationIdentities: new Map([['calendar', 'new-account']]), signal: new AbortController().signal, checkpoint: async () => {}, event: async () => {},
    });
    expect(JSON.stringify(generate.mock.calls)).not.toContain('old-event');
    expect(state.observations).toEqual([]);
  });
  it.each(['revoked', 'replaced', 'cleared'] as const)('descarta decisão em andamento quando a integração é %s', async (change) => {
    const release = studioFlowRelease(); const state = createStudioFlowState(release.releaseId);
    const old = { name: 'calendar', sourceKey: 'old', observedAt: '2026-11-05T12:00:00.000Z', result: { status: 'completed' as const, response: '', data: { private: 'old-event' } } };
    state.observations = [old];
    const invoke = vi.fn(); let changed = false;
    const refresh = async () => ({ identities: new Map<string, string | undefined>([['calendar', changed && change === 'revoked' ? undefined : changed && change === 'replaced' ? 'new' : 'old'], ['recall_application_results', undefined]]), clearedAt: changed && change === 'cleared' ? '2026-11-05T12:01:00.000Z' : null, rememberedObservations: changed ? [] : [old] });
    const prompts: string[] = [];
    const generate = vi.fn(async (context: { user: string }) => { prompts.push(context.user); if (!changed) { changed = true; return { kind: 'tool_call' as const, toolName: 'calendar', arguments: {}, response: '', data: {} }; } return { kind: 'completed' as const, response: 'Pronto', data: { answer: 'ok' } }; });
    await runStudioFlowInvocation({ release, state, generate, mode: 'task', data: {}, message: 'Consultar', messageId: 'm1',
      budget: { modelCalls: 0, toolCalls: 0, maxModelCalls: 8, maxToolCalls: 20, deadline: Date.now() + 10000, stack: [] },
      capabilities: [{ name: 'calendar', memoryKey: 'old', description: '', inputSchema: {}, invoke }], applicationIdentities: new Map([['calendar', 'old'], ['recall_application_results', undefined]]), refreshApplicationAccess: refresh,
      signal: new AbortController().signal, checkpoint: async () => {}, event: async () => {},
    });
    expect(prompts[0]).toContain('old-event'); expect(prompts[1]).not.toContain('old-event'); expect(invoke).not.toHaveBeenCalled();
  });
  it('descarta página de memória recuperada se o vínculo mudar no mesmo turno', async () => {
    const release = studioFlowRelease(); const state = createStudioFlowState(release.releaseId); let changed = false;
    const identities = () => new Map<string, string | undefined>([['calendar', changed ? undefined : 'old'], ['recall_application_results', undefined]]);
    const refresh = async () => ({ identities: identities(), clearedAt: null, rememberedObservations: [] });
    const prompts: string[] = [];
    const generate = vi.fn(async (context: { user: string }) => { prompts.push(context.user); if (prompts.length === 1) return { kind: 'tool_call' as const, toolName: 'recall_application_results', arguments: {}, response: '', data: {} }; if (prompts.length === 2) { changed = true; return { kind: 'completed' as const, response: 'old-private-value', data: { answer: 'ok' } }; } return { kind: 'completed' as const, response: 'Pronto', data: { answer: 'ok' } }; });
    const result = await runStudioFlowInvocation({ release, state, generate, mode: 'task', data: {}, message: 'Consultar', messageId: 'm1', budget: { modelCalls: 0, toolCalls: 0, maxModelCalls: 8, maxToolCalls: 20, deadline: Date.now() + 10000, stack: [] },
      capabilities: [{ name: 'recall_application_results', description: '', inputSchema: {}, invoke: async () => ({ status: 'completed', response: '', data: { results: [{ value: 'old-private-value' }] } }) }], applicationIdentities: identities(), refreshApplicationAccess: refresh, signal: new AbortController().signal, checkpoint: async () => {}, event: async () => {},
    });
    expect(prompts[1]).toContain('old-private-value'); expect(prompts[2]).not.toContain('old-private-value'); expect(result.response).toBe('Pronto');
  });
  it('retains the latest result of an active tool alongside recent results and excludes disconnected tools', () => {
    const observation = (name: string, n: number): StudioFlowState['observations'][number] => ({ name, result: { status: 'completed', response: '', data: { n } } });
    const entries = [observation('calendar', 1), observation('disconnected', 2), ...Array.from({ length: 30 }, (_, n) => observation('mail', n))];
    const selected = selectStudioFlowObservations(entries, new Set(['calendar', 'mail']));
    expect(selected).toHaveLength(17);
    expect(selected[0]).toMatchObject({ name: 'calendar', result: { data: { n: 1 } } });
    expect(selected.some((entry) => entry.name === 'disconnected')).toBe(false);
    expect(selected.at(-1)?.result.data).toEqual({ n: 29 });
  });

  it('redacts credentials and marked fields in checkpointed observations without granting approval', async () => {
    const release = studioFlowRelease(); const state = createStudioFlowState(release.releaseId);
    const generate = vi.fn<() => Promise<StudioFlowDecision>>()
      .mockResolvedValueOnce({ kind: 'tool_call', toolName: 'api', arguments: {}, response: '', data: {} })
      .mockResolvedValueOnce({ kind: 'completed', response: 'Pronto', data: { answer: 'ok' } });
    await runStudioFlowInvocation({ release, state, generate, mode: 'task', data: {}, message: 'Consultar', messageId: 'm1',
      budget: { modelCalls: 0, toolCalls: 0, maxModelCalls: 8, maxToolCalls: 20, deadline: Date.now() + 10000, stack: [] },
      capabilities: [{ name: 'api', description: '', inputSchema: {}, invoke: async () => ({ status: 'completed', response: 'Bearer hidden-token', error: 'api_key=hidden-key',
        data: { access_token: 'secret', nested: { password: 'secret', private: 'private', answer: 42 }, detail: 'Authorization: Bearer embedded-token' }, sensitivePaths: ['nested.private'] }) }],
      signal: new AbortController().signal, checkpoint: async () => {}, event: async () => {},
    });
    const memory = state.observations[0];
    expect(memory.observedAt).toEqual(expect.any(String));
    expect(memory.result.data).toEqual({ access_token: '[protegido]', nested: { password: '[protegido]', private: '[protegido]', answer: 42 }, detail: 'Authorization: [protegido] [protegido]' });
    expect(memory.result.response).not.toContain('hidden-token');
    expect(memory.result.error).not.toContain('hidden-key');
    expect(JSON.stringify(state.operations)).not.toContain('secret');
    const context = JSON.parse((generate.mock.calls[1] as unknown as [{ user: string }])[0].user);
    expect(context.observations[0].result.data.nested.answer).toBe(42);
    expect(context.observations[0].result.approval).toBeUndefined();
  });
  it('does not repeat a completed operation when full memory storage fails', async () => {
    const release = studioFlowRelease(); const state = createStudioFlowState(release.releaseId); const invoke = vi.fn(async () => ({ status: 'completed' as const, response: '', data: { order: 'created' } }));
    const prompts: string[] = [];
    const generate = vi.fn(async (context: { user: string }) => { prompts.push(context.user); return prompts.length === 1 ? { kind: 'tool_call' as const, toolName: 'order', arguments: {}, response: '', data: {} } : { kind: 'completed' as const, response: 'Pedido criado.', data: { answer: 'ok' } }; });
    const result = await runStudioFlowInvocation({ release, state, generate, mode: 'task', data: {}, message: 'Criar', messageId: 'm1', budget: { modelCalls: 0, toolCalls: 0, maxModelCalls: 8, maxToolCalls: 20, deadline: Date.now() + 10000, stack: [] },
      capabilities: [{ name: 'order', memoryKey: 'key', description: '', inputSchema: {}, invoke }], rememberObservation: async () => { throw new Error('disk full'); }, signal: new AbortController().signal, checkpoint: async () => {}, event: async () => {},
    });
    expect(result.response).toBe('Pedido criado.'); expect(invoke).toHaveBeenCalledOnce(); expect(prompts[1]).toContain('Não repita a operação');
    expect(Object.values(state.operations)[0].status).toBe('completed');
  });
});
