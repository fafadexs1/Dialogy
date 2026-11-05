import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { advanceStudioSession, createStudioSession, StudioSessionSchema, type StudioEngineDependencies } from '@/services/agent-studio/engine';
import { createDefaultAgentStudioDocument, ProcedureDocumentSchema, CollectedFieldDefinitionSchema } from '@/services/agent-studio/types';
import { buildStudioConversationContext } from '@/services/agent-studio/conversation-context';

function fixture(sensitive = false) {
  const document = createDefaultAgentStudioDocument('agent', 'workspace');
  document.resolveStage.procedures = ['compra', 'entrega'].map((id) => ProcedureDocumentSchema.parse({ id, name: id, triggerKeywords: [id], updatedAt: '2026-09-05', steps: [
    { id: 'option', order: 1, type: 'collect_data', title: 'Opção', collectField: CollectedFieldDefinitionSchema.parse({ id: `${id}-option`, name: 'Opção', variableKey: `${id}_option`, type: 'single_select', options: ['Essencial', 'Completo'], promptMessage: `Qual opção de ${id}?`, isSensitive: sensitive }) },
    { id: 'phone', order: 2, type: 'collect_data', title: 'Telefone', collectField: CollectedFieldDefinitionSchema.parse({ id: `${id}-phone`, name: 'Telefone', variableKey: `${id}_phone`, type: 'phone', promptMessage: `Qual telefone para ${id}?` }) },
  ] }));
  let state = createStudioSession('agent', 'release', 'session'), now = Date.now(), sequence = 0;
  const deps: StudioEngineDependencies = { execute: vi.fn().mockResolvedValue({}), handoff: vi.fn().mockResolvedValue(undefined), knowledge: vi.fn().mockResolvedValue(null), now: () => now };
  return { document, deps, get state() { return state; }, advanceTime: (ms: number) => { now += ms; },
    async send(message: string, id = String(++sequence)) {
      const result = await advanceStudioSession({ document, state: StudioSessionSchema.parse(JSON.parse(JSON.stringify(state))), message, messageId: id, dependencies: deps });
      state = result.state; return result;
    } };
}

describe('safe task resumption', () => {
  it('allows resumption after completing the intervening task', async () => {
    const f = fixture(); await f.send('compra'); await f.send('Completo'); await f.send('na verdade quero entrega');
    await f.send('Essencial'); await f.send('61999999999'); await f.send('sim');
    expect(f.state.status).toBe('resolved');
    await f.send('voltar ao assunto anterior'); await f.send('sim');
    expect(f.state.procedureId).toBe('compra'); expect(f.state.pendingField).toBe('compra_phone');
  });
  it('honors cancellation even when a pending resume proposal expires', async () => {
    const f = fixture(); await f.send('compra'); await f.send('na verdade quero entrega'); await f.send('voltar ao assunto anterior');
    f.advanceTime(31 * 60_000); await f.send('não precisa');
    expect(f.state.procedureId).toBeNull(); expect(f.state.resumeProposal).toBeUndefined();
  });
  it('restores a confirmed choice and the pending step only after explicit consent', async () => {
    const f = fixture(); await f.send('compra'); await f.send('Completo');
    await f.send('na verdade quero entrega');
    expect(f.state.suspendedProcedures?.[0].values).toEqual({ compra_option: 'Completo' });
    const proposal = await f.send('voltar ao assunto anterior');
    expect(proposal.state.procedureId).toBe('entrega'); expect(proposal.state.resumeProposal?.procedureId).toBe('compra');
    const restored = await f.send('sim', 'resume');
    expect(restored.state.procedureId).toBe('compra'); expect(restored.state.pendingField).toBe('compra_phone');
    expect(restored.state.values.compra_option).toBe('Completo'); expect(restored.state.confirmation).toBeNull();
    expect((await f.send('sim', 'resume')).replay).toBe(true);
    expect(f.deps.execute).not.toHaveBeenCalled(); expect(f.deps.handoff).not.toHaveBeenCalled();
  });
  it('suspends on a confirmed topic switch, not on the topic proposal', async () => {
    const f = fixture(); await f.send('compra'); await f.send('Completo'); await f.send('entrega');
    expect(f.state.suspendedProcedures).toBeUndefined();
    await f.send('sim'); expect(f.state.suspendedProcedures?.[0].procedureId).toBe('compra');
  });
  it.each([true, false])('recollects sensitive or stale values (sensitive=%s)', async (sensitive) => {
    const f = fixture(sensitive); await f.send('compra'); await f.send('Completo');
    if (!sensitive) f.advanceTime(31 * 60_000);
    await f.send('na verdade quero entrega'); await f.send('retomar o pedido anterior');
    const restored = await f.send('sim');
    expect(restored.state.pendingField).toBe('compra_option'); expect(restored.state.values.compra_option).toBeUndefined();
  });
  it('does not create a resumable snapshot on cancellation', async () => {
    const f = fixture(); await f.send('compra'); await f.send('não precisa');
    expect(f.state.suspendedProcedures?.length || 0).toBe(0);
    expect((await f.send('retomar o pedido anterior')).response).toContain('Não há um pedido anterior');
  });
  it('expires suspended work and rejects a stale confirmation', async () => {
    const f = fixture(); await f.send('compra'); await f.send('na verdade quero entrega');
    await f.send('voltar ao assunto anterior'); f.advanceTime(31 * 60_000);
    expect((await f.send('sim')).response).toContain('Não há um pedido anterior');
    expect(f.state.procedureId).toBe('entrega');
  });
  it('rejects snapshots from another immutable release', async () => {
    const f = fixture(); await f.send('compra'); await f.send('na verdade quero entrega');
    f.state.suspendedProcedures![0].releaseId = 'other';
    expect((await f.send('voltar ao assunto anterior')).state.resumeProposal).toBeUndefined();
  });
  it('does not resume after an operation in the current unfinished task', async () => {
    const f = fixture(); await f.send('compra'); await f.send('na verdade quero entrega');
    f.document.resolveStage.procedures[1].steps.push({ id: 'write', order: 3, title: 'Alterar', type: 'native_action', nativeActionType: 'add_tag' } as never);
    f.state.visits['entrega:write'] = 1;
    expect((await f.send('voltar ao assunto anterior')).response).toContain('operação executada');
    expect(f.state.resumeProposal).toBeUndefined(); expect(f.deps.execute).not.toHaveBeenCalled();
  });
  it('keeps a declined resume on the current task', async () => {
    const f = fixture(); await f.send('compra'); await f.send('na verdade quero entrega'); await f.send('voltar ao assunto anterior');
    await f.send('não'); expect(f.state.procedureId).toBe('entrega'); expect(f.state.resumeProposal).toBeUndefined();
  });
});

describe('context fidelity', () => {
  it('answers a doubt about a non-selection field and accepts a natural date without another model call', async () => {
    const f = fixture(); const definition = f.document.resolveStage.procedures[0].steps[0].collectField!;
    definition.type = 'date';
    f.deps.interpretCollection = vi.fn().mockResolvedValue({ kind: 'question' });
    await f.send('compra');
    const doubt = await f.send('fiquei com dúvida sobre esse dado');
    expect(doubt.state.attempts).toEqual({}); expect(f.deps.knowledge).toHaveBeenCalledOnce();
    const result = await f.send('quero marcar para amanhã');
    expect(result.state.values.compra_option).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.state.pendingField).toBe('compra_phone'); expect(f.deps.interpretCollection).toHaveBeenCalledOnce();
  });
  it('keeps an accepted choice outside the recent-history window', async () => {
    const f = fixture(); await f.send('compra'); await f.send('Completo');
    const history = Array.from({ length: 80 }, (_, i) => `Cliente: mensagem ${i} ${'x'.repeat(400)}`).join('\n');
    const context = buildStudioConversationContext({ document: f.document, state: f.state, history, message: 'Qual foi minha escolha?' });
    expect(context).toContain('Completo'); expect(context).toContain('compra_phone'); expect(context.length).toBeLessThan(32_000);
  });
  it('selects older relevant turns without cutting them in half', () => {
    const f = fixture();
    const important = 'Cliente: Minha preferência de entrega é somente aos sábados.';
    const history = [important, ...Array.from({ length: 50 }, (_, i) => `Agente: atualização ${i} ${'texto '.repeat(100)}`)].join('\n');
    expect(buildStudioConversationContext({ document: f.document, state: f.state, history, message: 'Qual minha preferência de entrega?' })).toContain(important);
  });
  it('has a persisted fallback when no adapter supplies history', async () => {
    const f = fixture(); await f.send('compra');
    expect(buildStudioConversationContext({ document: f.document, state: f.state, message: 'Continuar' })).toContain('Cliente: compra');
  });
  it('does not place sensitive values in the fact summary', async () => {
    const f = fixture(true); await f.send('compra'); await f.send('Completo');
    f.state.conversationMemory = [];
    expect(buildStudioConversationContext({ document: f.document, state: f.state, message: 'Continuar' })).not.toContain('Completo');
  });
  it('removes cross-domain rewriting and fixed medical instructions from the shared response flow', () => {
    const source = readFileSync('src/ai/flows/procedure-runtime.ts', 'utf8');
    for (const text of ['repairPediatric', 'sanitizeProcedureRuntimeResponse', 'applyStudioResponseSafety', 'Nunca prescreva', 'Nunca cite SAMU']) expect(source).not.toContain(text);
    expect(source).toContain('formatCustomerFacingAiResponse(output.response.trim())');
  });
});
