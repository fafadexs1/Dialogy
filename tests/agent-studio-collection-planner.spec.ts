import { describe, expect, it, vi } from 'vitest';
import { advanceStudioSession, createStudioSession, StudioSessionSchema } from '@/services/agent-studio/engine';
import { CollectedFieldDefinitionSchema, createDefaultAgentStudioDocument, ProcedureDocumentSchema, HttpRequestStepConfigSchema } from '@/services/agent-studio/types';
import { studioCollectionWindow, validateStudioCollectionPlan, type StudioCollectionPlan } from '@/services/agent-studio/collection-planner';
import { suspendStudioProcedure, restoreStudioProcedure } from '@/services/agent-studio/suspension';

const plan = (extra: Partial<StudioCollectionPlan> = {}): StudioCollectionPlan => ({ intent: 'contribute', observations: [], deferFields: [], nextFieldKey: null, ...extra });
function fixture() {
  const document = createDefaultAgentStudioDocument('agent', 'workspace');
  document.resolveStage.conversationMode = 'adaptive';
  document.concludeStage.handoffTeam = 'support';
  document.resolveStage.procedures = [ProcedureDocumentSchema.parse({ id: 'service', name: 'Solicitação', updatedAt: '2026-09-06', objective: 'Resolver o pedido do cliente', steps: [
    ...[['name', 'Nome'], ['postal', 'Código postal'], ['address', 'Endereço']].map(([key, name], index) => ({
      id: key, type: 'collect_data', order: index + 1, title: name,
      collectField: CollectedFieldDefinitionSchema.parse({ id: key, variableKey: key, name, type: key === 'postal' ? 'cep' : 'text', promptMessage: `Informe ${name}` }),
    })),
    { id: 'summary', order: 4, title: 'Resumo', type: 'respond', messageText: 'Contexto:', messageDataKeys: ['name', 'postal', 'address'] },
  ] })];
  let state = createStudioSession('agent', 'release', 'session');
  Object.assign(state, { phase: 'resolve', procedureId: 'service', pendingField: 'name', activeIntent: 'Quero atendimento' });
  const deps = { planCollection: vi.fn(), interpretTurn: vi.fn().mockResolvedValue({ kind: 'answer' }),
    execute: vi.fn().mockResolvedValue({}), knowledge: vi.fn().mockResolvedValue('Informação baseada nas fontes.'), handoff: vi.fn(), checkpoint: vi.fn() };
  let seq = 0;
  return { document, deps, get state() { return state; },
    async send(message: string, output: unknown, id = String(++seq)) {
      deps.planCollection.mockResolvedValue(output);
      const result = await advanceStudioSession({ document, state: StudioSessionSchema.parse(JSON.parse(JSON.stringify(state))),
        message, messageId: id, dependencies: deps });
      state = result.state; return result;
    } };
}

describe('goal-directed collection with bounded effects', () => {
  it('plans the initial qualification instead of imposing the configured field order', async () => {
    const f = fixture();
    f.document.understandStage.askInitialData = true;
    f.document.understandStage.initialFields = f.document.resolveStage.procedures[0].steps.flatMap((s) => s.collectField ? [s.collectField] : []);
    Object.assign(f.state, { phase: 'understand', procedureId: null, pendingField: 'name' });
    await f.send('Vamos começar pela localização', plan({ nextFieldKey: 'address' }));
    expect(f.state.pendingField).toBe('address'); expect(f.state.phase).toBe('understand');
    await f.send('Sou Ana, não sei o CEP', plan({ observations: [
      { fieldKey: 'name', status: 'provided', value: 'Ana', evidence: 'Sou Ana' },
      { fieldKey: 'postal', status: 'unavailable', evidence: 'não sei o CEP' },
    ], nextFieldKey: 'address' }));
    expect(f.state.values.name).toBe('Ana'); expect(f.state.unavailableFields?.['initial:postal']).toBeDefined();
  });
  it('accepts multiple facts and an unknown future field without forcing the original question order', async () => {
    const f = fixture();
    const first = await f.send('Sou Ana. Não sei o CEP.', plan({ observations: [
      { fieldKey: 'name', status: 'provided', value: 'Ana', evidence: 'Sou Ana' },
      { fieldKey: 'postal', status: 'unavailable', evidence: 'Não sei o CEP' },
    ], nextFieldKey: 'address' }));
    expect(first.response).toContain('Informe Endereço');
    expect(first.response).not.toContain('Informe Código postal');
    expect(f.state.values.name).toBe('Ana'); expect(f.state.pendingField).toBe('address');
    const second = await f.send('Rua Azul, 12', plan({ observations: [
      { fieldKey: 'address', status: 'provided', value: 'Rua Azul, 12', evidence: 'Rua Azul, 12' },
    ] }));
    expect(second.response).toContain('Código postal: não informado');
    expect(second.response).toContain('Rua Azul, 12'); expect(f.state.phase).toBe('conclude');
    expect(f.state.values.postal).toBeUndefined(); expect(f.deps.execute).not.toHaveBeenCalled(); expect(f.deps.handoff).not.toHaveBeenCalled();
  });
  it('lets the model ask a later useful field first and returns to other missing data after reload', async () => {
    const f = fixture();
    await f.send('Quero verificar a região primeiro', plan({ nextFieldKey: 'address' }));
    expect(f.state.pendingField).toBe('address'); expect(f.state.stepIndex).toBe(2);
    await f.send('Rua Azul', plan({ observations: [{ fieldKey: 'address', status: 'provided', value: 'Rua Azul', evidence: 'Rua Azul' }], nextFieldKey: 'name' }));
    expect(f.state.pendingField).toBe('name'); expect(f.state.values.address).toBe('Rua Azul');
  });
  it('defers irrelevant information without claiming the customer did not know it', async () => {
    const f = fixture();
    await f.send('Só quero orientação', plan({ deferFields: ['postal', 'name'], nextFieldKey: 'address' }));
    expect(f.state.deferredFields?.['service:postal']).toBeDefined(); expect(f.state.unavailableFields).toBeUndefined();
    expect(f.state.values.postal).toBeUndefined(); expect(f.state.pendingField).toBe('address');
  });
  it('gives an evidenced unknown priority over a redundant model deferral', async () => {
    const f = fixture();
    await f.send('Não sei o CEP', plan({ observations: [{ fieldKey: 'postal', status: 'unavailable', value: null, evidence: 'Não sei o CEP' }],
      deferFields: ['postal'], nextFieldKey: 'address' }));
    expect(f.state.unavailableFields?.['service:postal']).toBeDefined();
    expect(f.state.deferredFields?.['service:postal']).toBeUndefined();
    expect(f.state.pendingField).toBe('address');
  });
  it.each(['foreign', 'invented', 'missing_evidence', 'duplicate', 'missing_next', 'unsafe_defer'])('rejects %s plans without mutating values or dispatching actions', async (mode) => {
    const f = fixture();
    f.document.resolveStage.procedures[0].steps.push({ id: 'lookup', type: 'http_request', title: 'Consulta', order: 5,
      httpRequest: HttpRequestStepConfigSchema.parse({ name: 'Consulta', url: 'https://example.com', method: 'GET',
        sentDataMappings: [{ apiField: 'postal', sourceType: 'collected_field', sourceValue: 'postal' }] }) });
    const item = { fieldKey: 'name', status: 'provided' as const, value: 'Ana', evidence: 'Ana' };
    const proposals = {
      foreign: plan({ observations: [{ ...item, fieldKey: 'contact_other' }], nextFieldKey: 'address' }),
      invented: plan({ observations: [{ ...item, value: 'Maria' }], nextFieldKey: 'address' }),
      missing_evidence: plan({ observations: [{ ...item, evidence: 'Maria' }], nextFieldKey: 'address' }),
      duplicate: plan({ observations: [item, item], nextFieldKey: 'address' }),
      missing_next: plan(), unsafe_defer: plan({ deferFields: ['postal'], nextFieldKey: 'address' }),
    };
    await f.send('Ana', proposals[mode as keyof typeof proposals]);
    expect(f.state.values).toEqual({}); expect(f.state.attempts).toEqual({});
    expect(f.deps.execute).not.toHaveBeenCalled(); expect(f.deps.handoff).not.toHaveBeenCalled();
    expect(f.state.events.some((event) => event.kind === 'collection_plan_unavailable')).toBe(true);
  });
  it('cannot bypass confirmation using a supplied field or authorize the next write', async () => {
    const f = fixture();
    f.document.resolveStage.procedures[0].steps[0].collectField!.requiresConfirmation = true;
    f.document.resolveStage.procedures[0].steps.push({ id: 'write', type: 'native_action', order: 5, title: 'Salvar', nativeActionType: 'update_crm_field' });
    await f.send('Ana', plan({ observations: [{ fieldKey: 'name', status: 'provided', value: 'Ana', evidence: 'Ana' }], deferFields: ['postal', 'address'] }));
    expect(f.state.confirmation?.key).toBe('field:service:name'); expect(f.deps.execute).not.toHaveBeenCalled();
    f.deps.interpretTurn.mockResolvedValue({ kind: 'confirm' });
    await f.send('sim', plan());
    expect(f.state.confirmation?.key).not.toContain('field:'); expect(f.deps.execute).not.toHaveBeenCalled();
  });
  it('answers a doubt without abandoning or filling the pending field', async () => {
    const f = fixture(); const result = await f.send('Para que precisam disso?', plan({ intent: 'question' }));
    expect(result.response).toContain('baseada nas fontes'); expect(f.state.pendingField).toBe('name');
    expect(f.state.values).toEqual({}); expect(f.state.procedureId).toBe('service');
  });
  it('returns to earlier missing fields after confirming a later field', async () => {
    const f = fixture();
    f.document.resolveStage.procedures[0].steps[2].collectField!.requiresConfirmation = true;
    await f.send('Rua Azul', plan({ observations: [{ fieldKey: 'address', status: 'provided', value: 'Rua Azul', evidence: 'Rua Azul' }], nextFieldKey: 'name' }));
    expect(f.state.confirmation?.key).toBe('field:service:address');
    f.deps.interpretTurn.mockResolvedValue({ kind: 'confirm' });
    await f.send('sim', plan({ nextFieldKey: 'name' }));
    expect(f.state.pendingField).toBe('name'); expect(f.state.phase).toBe('resolve');
    expect(f.deps.execute).not.toHaveBeenCalled();
    expect(f.deps.planCollection.mock.calls.at(-1)?.[0].message).toBe('');
  });
  it('keeps indirect choices on the semantic option resolver before planning the next fields', async () => {
    const f = fixture();
    const field = f.document.resolveStage.procedures[0].steps[0].collectField!;
    field.type = 'single_select'; field.options = ['Básico', 'Premium com acompanhamento'];
    const interpretCollection = vi.fn().mockResolvedValue({ kind: 'proposal', label: field.options[1] });
    const result = await advanceStudioSession({ document: f.document, state: f.state, message: 'aquele com acompanhamento', messageId: 'option',
      dependencies: { ...f.deps, interpretCollection } });
    expect(result.state.collectionProposal?.label).toBe(field.options[1]);
    expect(result.state.values.name).toBeUndefined(); expect(interpretCollection).toHaveBeenCalled();
    expect(f.deps.planCollection).not.toHaveBeenCalled();
  });
  it('does not let a model deferral hide a reference to the current contact', async () => {
    const f = fixture();
    const field = f.document.resolveStage.procedures[0].steps[0].collectField!;
    field.type = 'phone'; field.requiresConfirmation = true;
    f.deps.planCollection.mockResolvedValue(plan({ deferFields: ['postal'], nextFieldKey: 'name' }));
    f.deps.interpretTurn.mockResolvedValue({ kind: 'contact_reference', fieldKey: 'name', contactKey: 'phone' });
    const result = await advanceStudioSession({ document: f.document, state: f.state, message: 'o telefone desta conversa', messageId: 'reference',
      context: { contact: { phone: '5561999999999' } }, dependencies: f.deps });
    expect(f.deps.interpretTurn).toHaveBeenCalled();
    expect(result.state.values.name).toBe('5561999999999');
    expect(result.state.confirmation?.key).toBe('field:service:name');
    expect(f.deps.execute).not.toHaveBeenCalled();
  });
  it('preserves confirmed out-of-order facts across a suspended procedure', async () => {
    const f = fixture();
    await f.send('Rua Azul', plan({ observations: [{ fieldKey: 'address', status: 'provided', value: 'Rua Azul', evidence: 'Rua Azul' }], nextFieldKey: 'name' }));
    expect(f.state.stepIndex).toBe(0);
    const at = Date.now(); suspendStudioProcedure(f.document, f.state, at);
    expect(f.state.suspendedProcedures?.[0].values.address).toBe('Rua Azul');
    expect(restoreStudioProcedure(f.document, f.state, 'service', at + 10)).toBe(true);
    expect(f.state.values.address).toBe('Rua Azul'); expect(f.state.pendingField).toBe('name');
  });
  it('does not repeat planning or effects for a duplicate message', async () => {
    const f = fixture(); const p = plan({ nextFieldKey: 'address' });
    await f.send('Oi', p, 'same'); const calls = f.deps.planCollection.mock.calls.length;
    expect((await f.send('Oi', p, 'same')).replay).toBe(true);
    expect(f.deps.planCollection).toHaveBeenCalledTimes(calls);
  });
  it('does not cross operations or explicit branches to collect inaccessible fields', () => {
    const f = fixture(); const steps = f.document.resolveStage.procedures[0].steps;
    steps.splice(1, 0, { id: 'gate', type: 'native_action', order: 2, title: 'Autorização', nativeActionType: 'add_tag' });
    const window = studioCollectionWindow(f.document, f.state)!;
    expect(window.fields.map((entry) => entry.field.variableKey)).toEqual(['name']);
    expect(validateStudioCollectionPlan(plan({ nextFieldKey: 'address' }), { document: f.document, state: f.state, message: 'Oi', window }, Date.now())).toBeNull();
  });
});
