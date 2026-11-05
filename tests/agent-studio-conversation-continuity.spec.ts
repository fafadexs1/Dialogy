import { describe, expect, it, vi } from 'vitest';
import { advanceStudioSession, createStudioSession, StudioSessionSchema, type StudioEngineDependencies } from '@/services/agent-studio/engine';
import { interpretStudioTurn } from '@/services/agent-studio/turn-interpreter';
import { validateStudioRecoveredFacts } from '@/services/agent-studio/fact-recovery';
import { createDefaultAgentStudioDocument, ProcedureDocumentSchema, CollectedFieldDefinitionSchema } from '@/services/agent-studio/types';

function fixture() {
  const document = createDefaultAgentStudioDocument('agent', 'workspace');
  document.resolveStage.conversationMode = 'adaptive';
  document.concludeStage.confirmResolutionQuestion = 'Essas informações ajudaram? Se quiser contratar, pode me dizer agora.';
  document.concludeStage.successClosingMessage = 'Obrigado, até logo!';
  document.resolveStage.procedures = [
    ProcedureDocumentSchema.parse({ id: 'catalog', name: 'Conhecer planos', updatedAt: '2026-09-06', steps: [
      { id: 'catalog', order: 1, type: 'respond', title: 'Planos', messageText: '500 MEGA e 1000 MEGA' },
    ] }),
    ProcedureDocumentSchema.parse({ id: 'contract', name: 'Iniciar contratação', updatedAt: '2026-09-06', steps: [
      { id: 'intro', order: 1, type: 'message', title: 'Introdução', messageText: 'Vamos iniciar sua contratação.' },
      ...[['plan', 'Plano', 'single_select'], ['name', 'Nome', 'text'], ['address', 'Endereço', 'text']].map(([id, name, type], index) => ({
        id, order: index + 2, type: 'collect_data', title: name,
        collectField: CollectedFieldDefinitionSchema.parse({ id, name, type, variableKey: id,
          promptMessage: `Qual ${name}?`, options: id === 'plan' ? ['500 MEGA — R$ 99,90', '1000 MEGA — R$ 149,90'] : undefined }),
      })),
    ] }),
  ];
  let state = createStudioSession('agent', 'release', 'session'), seq = 0;
  const deps: StudioEngineDependencies = { interpretTurn: vi.fn().mockResolvedValue({ kind: 'answer' }),
    chooseProcedure: vi.fn().mockResolvedValue('contract'), knowledge: vi.fn().mockResolvedValue('Informação verificada.'),
    planAction: vi.fn().mockImplementation(async ({ question }) => question ? 'answer' : 'continue'),
    execute: vi.fn(), handoff: vi.fn(), checkpoint: vi.fn() };
  return { document, deps, get state() { return state; }, async send(message: string, id = String(++seq)) {
    const r = await advanceStudioSession({ document, state: StudioSessionSchema.parse(JSON.parse(JSON.stringify(state))), message, messageId: id, dependencies: deps });
    state = r.state; return r;
  } };
}

describe('conversation and persisted work remain aligned', () => {
  it('routes an offer selection misclassified as resolution to contracting without discarding its words', async () => {
    const f = fixture(); Object.assign(f.state, { phase: 'conclude', procedureId: 'catalog', stepIndex: 1 });
    vi.mocked(f.deps.interpretTurn!).mockResolvedValue({ kind: 'confirm' });
    const message = 'Acho que fico com o de 1000 que eu trabalho home office.';
    f.deps.recoverFacts = vi.fn().mockResolvedValue({ sources: [{ customer: message }], plan: {
      intent: 'contribute', observations: [{ fieldKey: 'plan', status: 'provided', value: '1000', evidence: message }], deferFields: [], nextFieldKey: null,
    } });
    const result = await f.send(message, 'choose');
    expect(f.state.values.plan).toBe('1000 MEGA — R$ 149,90'); expect(f.state.pendingField).toBe('name');
    expect(f.state.status).toBe('waiting_input'); expect(result.response).not.toContain('até logo');
    expect(f.deps.chooseProcedure).toHaveBeenCalledWith(expect.any(Array), message);
    vi.mocked(f.deps.interpretTurn!).mockResolvedValue({ kind: 'answer' });
    const next = await f.send('Ana de Sousa');
    expect(next.state.values.name).toBe('Ana de Sousa'); expect(next.state.pendingField).toBe('address');
    expect(next.response).not.toContain('Qual Plano');
    expect((await f.send('Ana de Sousa', 'choose')).replay).toBe(true);
    expect(f.deps.execute).not.toHaveBeenCalled();
  });

  it('a question-shaped contracting request runs the entry and registers the actual next question', async () => {
    const f = fixture(); vi.mocked(f.deps.interpretTurn!).mockResolvedValue({ kind: 'question' });
    vi.mocked(f.deps.knowledge).mockResolvedValue('Qual seu nome completo?');
    const result = await f.send('Então, não vamos fechar?');
    expect(result.response).toContain('Qual Plano?'); expect(f.state.pendingField).toBe('plan');
    expect(f.deps.knowledge).not.toHaveBeenCalled();
  });

  it('repairs earlier untracked contributions before asking for a plan again', async () => {
    const f = fixture(); Object.assign(f.state, { phase: 'resolve', procedureId: 'contract', stepIndex: 1, pendingField: 'plan' });
    vi.mocked(f.deps.interpretTurn!).mockResolvedValue({ kind: 'continue' });
    f.deps.recoverFacts = vi.fn().mockResolvedValue({ sources: [{ customer: 'Fico com 1000' }, { customer: 'Ana de Sousa' }], plan: {
      intent: 'contribute', observations: [
        { fieldKey: 'plan', status: 'provided', value: '1000', evidence: 'Fico com 1000' },
        { fieldKey: 'name', status: 'provided', value: 'Ana de Sousa', evidence: 'Ana de Sousa' },
      ], deferFields: [], nextFieldKey: null,
    } });
    const result = await f.send('Vamos continuar');
    expect(result.state.values).toMatchObject({ plan: '1000 MEGA — R$ 149,90', name: 'Ana de Sousa' });
    expect(result.state.pendingField).toBe('address'); expect(result.response).not.toContain('Qual Plano');
  });

  it('does not consume an invalid attempt when continuation has no recoverable choice', async () => {
    const f = fixture(); Object.assign(f.state, { phase: 'resolve', procedureId: 'contract', stepIndex: 1, pendingField: 'plan' });
    vi.mocked(f.deps.interpretTurn!).mockResolvedValue({ kind: 'continue' });
    f.deps.recoverFacts = vi.fn().mockResolvedValue({ plan: undefined, sources: [] });
    const result = await f.send('Vamos continuar');
    expect(result.state.pendingField).toBe('plan'); expect(result.state.attempts).toEqual({});
    expect(result.state.values).toEqual({}); expect(f.deps.execute).not.toHaveBeenCalled();
  });

  it('saves another contribution during confirmation without correcting or confirming the pending field', async () => {
    const f = fixture(); const confirmation = { key: 'field:contract:plan', signature: '"1000 MEGA — R$ 149,90"', at: Date.now() };
    Object.assign(f.state, { phase: 'resolve', procedureId: 'contract', stepIndex: 1, confirmation, values: { plan: '1000 MEGA — R$ 149,90' } });
    vi.mocked(f.deps.interpretTurn!).mockResolvedValue({ kind: 'correct', fieldKey: 'plan' });
    f.deps.recoverFacts = vi.fn().mockResolvedValue({ sources: [], plan: { intent: 'contribute', observations: [
      { fieldKey: 'name', status: 'provided', value: 'Ana de Sousa', evidence: 'Meu nome é Ana de Sousa' },
    ], deferFields: [], nextFieldKey: null } });
    const result = await f.send('Meu nome é Ana de Sousa');
    expect(result.state.values).toMatchObject({ plan: '1000 MEGA — R$ 149,90', name: 'Ana de Sousa' });
    expect(result.state.confirmation).toEqual(confirmation); expect(f.deps.execute).not.toHaveBeenCalled();
    expect(f.deps.recoverFacts).toHaveBeenCalledWith(expect.objectContaining({ currentTurnOnly: true }));
  });

  it('does not accept an obsolete resolution confirmation after answering a follow-up question', async () => {
    const f = fixture(); Object.assign(f.state, { phase: 'conclude', procedureId: 'catalog', stepIndex: 1 });
    vi.mocked(f.deps.interpretTurn!).mockResolvedValue({ kind: 'question' });
    await f.send('Esse de 1000 é melhor?'); expect(f.state.resolutionPromptPending).toBe(false);
    vi.mocked(f.deps.interpretTurn!).mockResolvedValue({ kind: 'confirm' });
    const result = await f.send('Sim, quero contratar');
    expect(result.state.procedureId).toBe('contract'); expect(result.state.status).not.toBe('resolved');
  });

  it('still honors an explicit resolution of the pending request', async () => {
    const f = fixture(); Object.assign(f.state, { phase: 'conclude', procedureId: 'catalog', stepIndex: 1 });
    vi.mocked(f.deps.interpretTurn!).mockResolvedValue({ kind: 'confirm' });
    expect((await f.send('sim')).state.status).toBe('resolved');
  });

  it('makes contribution and continuation available while awaiting resolution', async () => {
    const f = fixture(); Object.assign(f.state, { phase: 'conclude', procedureId: 'catalog', stepIndex: 1 });
    await interpretStudioTurn({ document: f.document, state: f.state, message: 'Fico com o de 1000', context: { values: {} } }, async (_, choices) => {
      expect(choices.map((c) => c.id)).toEqual(expect.arrayContaining(['turn_answer', 'turn_continue'])); return 'turn_answer';
    });
  });

  it('rejects invented, assistant-only, sensitive, consent and foreign-field memories', () => {
    const f = fixture(); const procedure = f.document.resolveStage.procedures[1];
    procedure.steps[3].collectField!.isSensitive = true;
    const fields = procedure.steps.flatMap((s) => s.collectField ? [{ field: s.collectField, stepKey: `contract:${s.id}` }] : []);
    const observations = [
      { fieldKey: 'name', value: 'Invented', evidence: 'Ana' },
      { fieldKey: 'plan', value: '1000', evidence: '1000' },
      { fieldKey: 'address', value: 'Rua Azul', evidence: 'Rua Azul' },
      { fieldKey: 'contact_consent', value: 'sim', evidence: 'sim' },
      { fieldKey: 'foreign', value: 'Ana', evidence: 'Ana' },
    ].map((o) => ({ ...o, status: 'provided' }));
    expect(validateStudioRecoveredFacts({ intent: 'contribute', observations, deferFields: [], nextFieldKey: null },
      { document: f.document, state: f.state, fields, message: 'Ana' }, [{ customer: 'Ana Rua Azul sim', assistant: '1000' }])).toEqual([]);
  });

  it('recovers explicit choices without model output, takes the latest choice and honors withdrawal', () => {
    const f = fixture(); const p = f.document.resolveStage.procedures[1];
    const input = { document: f.document, state: f.state, message: 'Ana', fields: p.steps.flatMap((s) => s.collectField ? [{ field: s.collectField, stepKey: `contract:${s.id}` }] : []) };
    const sources = [{ customer: 'Acho que fico com o de 1000 que eu trabalho home office.' }];
    expect(validateStudioRecoveredFacts(undefined, input, sources)[0].value).toContain('1000');
    sources.push({ customer: 'Prefiro o de 500' });
    expect(validateStudioRecoveredFacts(undefined, input, sources)[0].value).toContain('500');
    sources.push({ customer: 'Não quero mais, desisti' });
    const stalePlan = { intent: 'contribute', observations: [{ fieldKey: 'plan', status: 'provided', value: '1000', evidence: sources[0].customer }], deferFields: [], nextFieldKey: null };
    expect(validateStudioRecoveredFacts(stalePlan, input, sources)).toEqual([]);
  });

  it.each(['answer', 'confirm'] as const)('routes a named choice ahead of recommendation when interpreted as %s', async (kind) => {
    const f = fixture(); Object.assign(f.state, { phase: 'conclude', procedureId: 'catalog', stepIndex: 1 });
    const recommendation = ProcedureDocumentSchema.parse({ id: 'recommend', name: 'Recomendar plano', updatedAt: '2026-09-06', steps: [] });
    f.document.resolveStage.procedures.splice(1, 0, recommendation);
    vi.mocked(f.deps.interpretTurn!).mockResolvedValue({ kind });
    vi.mocked(f.deps.chooseProcedure!).mockImplementation(async (procedures) => {
      expect(procedures.map((p) => p.id)).toEqual(['contract']); return 'contract';
    });
    const r = await f.send('Acho que fico com o de 1000 que eu trabalho home office.');
    expect(r.state.values.plan).toContain('1000'); expect(r.state.pendingField).toBe('name');
  });
});
