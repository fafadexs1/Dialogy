import { describe, expect, it, vi } from 'vitest';
import { studioFlowRelease } from './fixtures/studio-flow-fixture';
import { createStudioFlowState, runStudioFlowInvocation, type StudioFlowBudget, type StudioFlowDecision } from '@/services/agent-studio/flow-execution';
import { runStudioFlowProcedure } from '@/services/agent-studio/flow-procedure';

function harness() {
  const release = studioFlowRelease(); const state = createStudioFlowState(release.releaseId);
  const budget: StudioFlowBudget = { modelCalls: 0, toolCalls: 0, maxModelCalls: 8, maxToolCalls: 20, deadline: Date.now() + 10000, stack: [] };
  const generate = vi.fn<() => Promise<StudioFlowDecision>>(async () => ({ kind: 'completed', response: 'Pronto.', data: { answer: 'resultado' } }));
  return { release, state, budget, generate, mode: 'task' as const, data: {}, message: 'Analise o pedido', messageId: 'message-1', capabilities: [], signal: new AbortController().signal, checkpoint: vi.fn(async () => {}), event: vi.fn(async () => {}) };
}
describe('Studio invocation coordinator', () => {
  it('provides remembered results only for available tools and persists sanitized successful observations', async () => {
    const input = harness();
    input.generate.mockResolvedValueOnce({ kind: 'tool_call', toolName: 'consulta', arguments: {}, response: '', data: {} });
    const rememberObservation = vi.fn(async () => {});
    const capabilities = [{ name: 'consulta', description: '', inputSchema: {}, memoryKey: 'tool-key', invoke: async () => ({ status: 'completed' as const, response: '', data: { access_token: 'secret-token', value: 'ok' } }) }];
    const rememberedObservations = [
      { name: 'consulta', observedAt: '2026-11-04T09:00:00Z', result: { status: 'completed' as const, response: '', data: { old: 'known' } } },
      { name: 'disconnected', observedAt: '2026-11-04T09:00:00Z', result: { status: 'completed' as const, response: '', data: { hidden: true } } },
    ];
    await runStudioFlowInvocation({ ...input, capabilities, rememberedObservations, rememberObservation });
    const user = JSON.parse((input.generate.mock.calls[0] as unknown as [{ user: string }])[0].user);
    expect(user.observations).toHaveLength(1);
    expect(user.observations[0].result.data.old).toBe('known');
    expect(rememberObservation).toHaveBeenCalledOnce();
    expect(rememberObservation).toHaveBeenCalledWith('tool-key', expect.objectContaining({ result: expect.objectContaining({ data: { access_token: '[protegido]', value: 'ok' } }) }));
  });
  it('resumes an approved tool with its exact pending arguments without another tool budget charge', async () => {
    const input = harness();
    const approval = { resumeToken: 'approval-token', approvalId: 'approval-id', waitingSince: new Date().toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString() };
    const invoke = vi.fn().mockResolvedValueOnce({ status: 'needs_input', response: '', data: {}, approval }).mockResolvedValueOnce({ status: 'completed', response: '', data: { confirmed: true } });
    const capabilities = [{ name: 'create_order', description: 'Cria pedido', inputSchema: { type: 'object' }, invoke }];
    input.generate.mockResolvedValueOnce({ kind: 'tool_call', toolName: 'create_order', arguments: { amount: 42 }, response: '', data: {} });
    const pending = await runStudioFlowInvocation({ ...input, capabilities });
    expect(pending.approval).toEqual(approval);
    const charged = input.state.toolCalls;
    expect((await runStudioFlowInvocation({ ...input, capabilities })).status).toBe('completed');
    expect(invoke.mock.calls[1]).toEqual(invoke.mock.calls[0]);
    expect(input.state.toolCalls).toBe(charged);
  });
  it('returns typed results, preserving the immutable release and replaying without a second call', async () => {
    const input = harness(); const before = structuredClone(input.release);
    expect(await runStudioFlowInvocation(input)).toMatchObject({ status: 'completed', data: { answer: 'resultado' } });
    await runStudioFlowInvocation(input);
    expect(input.generate).toHaveBeenCalledTimes(1); expect(input.release).toEqual(before);
  });
  it('does not invoke the model or tools when a task is missing required input', async () => {
    const input = harness(); input.release.flowContract!.inputs[0].required = true;
    expect(await runStudioFlowInvocation(input)).toMatchObject({ status: 'needs_input' });
    expect(input.generate).not.toHaveBeenCalled();
  });
  it('resumes a conversational step and retains its accumulated budget', async () => {
    const input = harness(); input.generate.mockResolvedValueOnce({ kind: 'needs_input', response: 'Qual assunto?', data: {} });
    expect(await runStudioFlowInvocation({ ...input, mode: 'conversation' })).toMatchObject({ status: 'needs_input' });
    expect(await runStudioFlowInvocation({ ...input, mode: 'conversation', messageId: 'message-2', message: 'Financeiro' })).toMatchObject({ status: 'completed' });
    expect(input.state.modelCalls).toBe(2); expect(input.state.turns).toHaveLength(4);
  });
  it('reserves and checkpoints a tool call before executing, then gives its evidence to the model', async () => {
    const input = harness();
    input.generate.mockResolvedValueOnce({ kind: 'tool_call', toolName: 'consulta', arguments: {}, response: '', data: {} });
    const invoke = vi.fn(async () => { expect(Object.values(input.state.operations)[0].status).toBe('running'); expect(input.checkpoint).toHaveBeenCalled(); return { status: 'completed' as const, response: '', data: { answer: 'confirmado' } }; });
    await runStudioFlowInvocation({ ...input, capabilities: [{ name: 'consulta', description: 'Consulta', inputSchema: {}, invoke }] });
    expect(invoke).toHaveBeenCalledTimes(1); expect(input.state.observations[0].result.data).toEqual({ answer: 'confirmado' });
    expect(input.budget.toolCalls).toBe(1);
  });
  it('propagates specialist input requirements to the main agent without invoking more tools', async () => {
    const input = harness(); input.generate.mockResolvedValueOnce({ kind: 'tool_call', toolName: 'specialist', arguments: {}, response: '', data: {} });
    const result = await runStudioFlowInvocation({ ...input, capabilities: [{ name: 'specialist', description: '', inputSchema: {}, invoke: async () => ({ status: 'needs_input', response: 'Informe o contrato.', data: {} }) }] });
    expect(result.status).toBe('needs_input'); expect(input.generate).toHaveBeenCalledTimes(1);
  });
  it('rejects unavailable tools and invalid public output instead of reporting success', async () => {
    const input = harness(); input.generate.mockResolvedValueOnce({ kind: 'tool_call', toolName: 'inventada', response: '', data: {} });
    await expect(runStudioFlowInvocation(input)).rejects.toThrow('não está conectada');
    const other = harness(); other.generate.mockResolvedValueOnce({ kind: 'completed', response: 'Pronto', data: { hidden: 'not-authorized' } });
    await expect(runStudioFlowInvocation(other)).rejects.toThrow('contrato'); expect(other.state.status).not.toBe('completed');
  });
  it('resumes the same pending capability with corrected arguments and gives distinct new calls their own operation IDs', async () => {
    const input = harness();
    input.generate.mockResolvedValueOnce({ kind: 'tool_call', toolName: 'consulta', arguments: {}, response: '', data: {} });
    const invoke = vi.fn().mockResolvedValueOnce({ status: 'needs_input', response: 'Informe o contrato.', data: {} }).mockResolvedValue({ status: 'completed', response: '', data: { answer: 'confirmado' } });
    const capabilities = [{ name: 'consulta', description: '', inputSchema: {}, invoke }];
    expect((await runStudioFlowInvocation({ ...input, capabilities, mode: 'conversation' })).status).toBe('needs_input');
    input.generate.mockResolvedValueOnce({ kind: 'tool_call', toolName: 'consulta', arguments: { contract: '123' }, response: '', data: {} });
    input.generate.mockResolvedValueOnce({ kind: 'tool_call', toolName: 'consulta', arguments: { contract: '123' }, response: '', data: {} });
    expect((await runStudioFlowInvocation({ ...input, capabilities, mode: 'conversation', messageId: 'message-2', message: '123' })).status).toBe('completed');
    expect(invoke.mock.calls[0][1]).toBe(invoke.mock.calls[1][1]);
    expect(invoke.mock.calls[1][0]).toEqual({ contract: '123' });
    expect(invoke.mock.calls[2][1]).not.toBe(invoke.mock.calls[1][1]);
    expect(input.state.pendingCapability).toBeUndefined();
  });
  it('returns a request to close as a graph outcome without executing a control action', async () => {
    const input = harness(); input.generate.mockResolvedValueOnce({ kind: 'close_requested', response: 'Até logo.', data: {} });
    expect(await runStudioFlowInvocation(input)).toMatchObject({ status: 'close_requested' });
  });
  it('does not replay uncertain business effects after an interrupted checkpoint', async () => {
    const input = harness(); input.state.operations.previous = { status: 'running' };
    expect(await runStudioFlowInvocation(input)).toMatchObject({ status: 'error' }); expect(input.generate).not.toHaveBeenCalled();
  });
  it('enforces the shared workflow budget and cancellation', async () => {
    const input = harness(); input.budget.maxModelCalls = 0;
    expect(await runStudioFlowInvocation(input)).toMatchObject({ status: 'limit_reached' }); expect(input.generate).not.toHaveBeenCalled();
    const controller = new AbortController(); controller.abort();
    await expect(runStudioFlowInvocation({ ...harness(), signal: controller.signal })).rejects.toThrow();
  });
  it('enforces the published turn limit even after conversation history is compacted', async () => {
    const input = harness(); input.state.userTurns = 100; input.state.turns = [];
    expect((await runStudioFlowInvocation(input)).status).toBe('limit_reached'); expect(input.generate).not.toHaveBeenCalled();
  });
  it('preserves exclusions and prohibited data collection rules', async () => {
    const input = harness(); input.release.agentSnapshot.rules.excludedTopics = ['apostas'];
    expect(await runStudioFlowInvocation({ ...input, message: 'Quero apostas' })).toMatchObject({ status: 'handoff' });
    expect(input.generate).not.toHaveBeenCalled();
    const other = harness(); other.generate.mockResolvedValueOnce({ kind: 'needs_input', response: 'Informe sua senha', data: {} });
    await expect(runStudioFlowInvocation(other)).rejects.toThrow('dados proibidos');
  });
});

describe('published procedures as flow capabilities', () => {
  it('uses the Studio engine and maps verified values without changing the original procedure', async () => {
    const release = studioFlowRelease(); const before = structuredClone(release);
    const execute = vi.fn(async () => ({ values: { answer: 'confirmado', private: 'hidden' } }));
    const result = await runStudioFlowProcedure({ release, procedureId: 'consulta', invocationId: 'invocation', messageId: 'message', message: 'Consultar cadastro', data: {}, dependencies: { execute, knowledge: async () => null, handoff: async () => {} } });
    expect(result.result).toMatchObject({ status: 'completed', data: { answer: 'confirmado' } }); expect(execute).toHaveBeenCalledTimes(1); expect(release).toEqual(before);
  });
  it('requires an exported procedure for direct use by another flow or agent', async () => {
    const release = studioFlowRelease(); release.flowContract!.exposedProcedureIds = [];
    await expect(runStudioFlowProcedure({ release, procedureId: 'consulta', invocationId: 'invocation', messageId: 'message', message: '', data: {}, dependencies: { execute: async () => ({}), knowledge: async () => null, handoff: async () => {} } })).rejects.toThrow('não exportada');
  });
  it('asks for confirmation before a write and executes once after an actual new customer reply', async () => {
    const release = studioFlowRelease(); release.publishedProcedures[0].steps[0].httpRequest!.method = 'POST';
    const execute = vi.fn(async () => ({ values: { answer: 'salvo' } }));
    const dependencies = { execute, knowledge: async () => null, handoff: async () => {} };
    const request = { release, procedureId: 'consulta', invocationId: 'invocation', messageId: 'message-1', message: 'Salvar cadastro', data: {}, dependencies };
    const waiting = await runStudioFlowProcedure(request);
    expect(waiting.result.status).toBe('needs_input'); expect(execute).not.toHaveBeenCalled();
    const done = await runStudioFlowProcedure({ ...request, state: waiting.state, messageId: 'message-2', message: 'sim' });
    expect(done.result.status).toBe('completed'); expect(execute).toHaveBeenCalledTimes(1);
    await runStudioFlowProcedure({ ...request, state: done.state, messageId: 'message-2', message: 'sim' });
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
