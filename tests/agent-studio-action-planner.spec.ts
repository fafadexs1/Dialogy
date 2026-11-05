import { describe, expect, it, vi } from 'vitest';
import { advanceStudioSession, createStudioSession, StudioSessionSchema } from '@/services/agent-studio/engine';
import { availableStudioActions, studioVerifiedEvidence } from '@/services/agent-studio/action-planner';
import { CollectedFieldDefinitionSchema, createDefaultAgentStudioDocument, ProcedureDocumentSchema, HttpRequestStepConfigSchema } from '@/services/agent-studio/types';

function fixture() {
  const document = createDefaultAgentStudioDocument('agent', 'workspace');
  document.resolveStage.conversationMode = 'adaptive'; document.concludeStage.handoffTeam = 'Support';
  document.resolveStage.procedures = [ProcedureDocumentSchema.parse({ id: 'request', name: 'Solicitação', objective: 'Validar localização', updatedAt: '2026-09-06', steps: [
    ...['postal', 'address'].map((key, index) => ({ id: key, title: key, order: index + 1, type: 'collect_data',
      collectField: CollectedFieldDefinitionSchema.parse({ id: key, name: key, variableKey: key, type: key === 'postal' ? 'cep' : 'text', promptMessage: `Informe ${key}` }) })),
    { id: 'lookup', type: 'http_request', title: 'Consultar localização pelo endereço', order: 3,
      httpRequest: HttpRequestStepConfigSchema.parse({ name: 'Localização', method: 'GET', url: 'https://example.com/location',
        sentDataMappings: [{ apiField: 'address', sourceType: 'collected_field', sourceValue: 'address' }],
        outputMappings: [{ chipKey: 'postal', chipLabel: 'Código postal', jsonPath: 'postal' }] }) },
    { id: 'reply', title: 'Resposta configurada', type: 'respond', order: 4, messageText: 'Resultado verificado:', messageDataKeys: ['postal'] },
  ] })];
  let state = createStudioSession('agent', 'release', 'session');
  Object.assign(state, { phase: 'resolve', procedureId: 'request', pendingField: 'postal', activeIntent: 'Validar localização' });
  const deps = { planAction: vi.fn().mockImplementation(async ({ capabilities, question }) => capabilities[0]?.id || (question ? 'answer' : 'continue')),
    planCollection: vi.fn().mockImplementation(async ({ state: current, message }) => ({ intent: 'contribute',
      observations: message.includes('Rua Azul') ? [
        { fieldKey: 'postal', status: 'unavailable', value: null, evidence: 'Não sei o CEP' },
        { fieldKey: 'address', status: 'provided', value: 'Rua Azul', evidence: 'Rua Azul' },
      ] : [], deferFields: [], nextFieldKey: message.includes('Rua Azul') ? null
        : ['postal', 'address'].find((key) => !Object.hasOwn(current.values, key) && !current.unavailableFields?.[`request:${key}`]) || null })),
    interpretTurn: vi.fn().mockResolvedValue({ kind: 'answer' }), execute: vi.fn().mockResolvedValue({ values: { postal: '72800000' } }),
    knowledge: vi.fn().mockResolvedValue('Fonte autorizada.'), answerFromEvidence: vi.fn().mockResolvedValue('O código consultado é 72800000.'),
    handoff: vi.fn(), checkpoint: vi.fn() };
  let sequence = 0;
  return { document, deps, get state() { return state; }, async send(message: string, id = String(++sequence)) {
    const result = await advanceStudioSession({ document, state: StudioSessionSchema.parse(JSON.parse(JSON.stringify(state))),
      message, messageId: id, dependencies: deps }); state = result.state; return result;
  } };
}

describe('adaptive capability planning and controlled execution', () => {
  it('uses a ready lookup to obtain an unknown field instead of asking again, then preserves the configured response', async () => {
    const f = fixture(); const result = await f.send('Não sei o CEP, moro na Rua Azul');
    expect(f.deps.execute).toHaveBeenCalledTimes(1);
    expect(f.state.values).toMatchObject({ address: 'Rua Azul', postal: '72800000' });
    expect(f.state.unavailableFields?.['request:postal']).toBeUndefined();
    expect(f.state.adaptiveCompletedSteps?.['request:lookup']).toBe(true);
    expect(result.response).toContain('Resultado verificado:\n72800000');
    expect(result.response).not.toContain('Informe postal'); expect(f.state.phase).toBe('conclude');
  });
  it('accepts no next question only when validated facts make a read available, without dropping supplied information', async () => {
    const f = fixture();
    f.deps.planCollection.mockResolvedValue({ intent: 'contribute', observations: [
      { fieldKey: 'address', status: 'provided', value: 'Rua Azul', evidence: 'Rua Azul' },
    ], deferFields: [], nextFieldKey: null });
    await f.send('Rua Azul'); expect(f.deps.execute).toHaveBeenCalledTimes(1);
    expect(f.state.values).toMatchObject({ address: 'Rua Azul', postal: '72800000' });
  });
  it('does not treat a missing next question as permission to skip data for a write', async () => {
    const f = fixture(); f.document.resolveStage.procedures[0].steps[2].httpRequest!.method = 'POST';
    f.deps.planCollection.mockResolvedValue({ intent: 'contribute', observations: [
      { fieldKey: 'address', status: 'provided', value: 'Rua Azul', evidence: 'Rua Azul' },
    ], deferFields: [], nextFieldKey: null });
    await f.send('Rua Azul'); expect(f.deps.execute).not.toHaveBeenCalled(); expect(f.state.phase).toBe('resolve');
  });
  it('consults to answer a doubt without filling a field from the question or abandoning the request', async () => {
    const f = fixture(); f.state.values.address = 'Rua Azul';
    f.deps.planCollection.mockResolvedValue({ intent: 'question', observations: [], deferFields: [], nextFieldKey: null });
    f.deps.interpretTurn.mockResolvedValue({ kind: 'question' });
    const result = await f.send('Pode consultar meu código?');
    expect(result.response).toContain('código consultado'); expect(f.deps.execute).toHaveBeenCalledTimes(1);
    expect(f.deps.answerFromEvidence).toHaveBeenCalledWith({ question: 'Pode consultar meu código?', values: { postal: '72800000' } });
    expect(f.state.procedureId).toBe('request'); expect(f.state.phase).toBe('resolve');
  });
  it('never repeats a dispatched lookup for a duplicate message or after persisted continuation', async () => {
    const f = fixture(); f.state.values.address = 'Rua Azul';
    f.deps.planCollection.mockResolvedValue({ intent: 'question', observations: [], deferFields: [], nextFieldKey: null });
    f.deps.interpretTurn.mockResolvedValue({ kind: 'question' });
    await f.send('Consulte para mim', 'same'); expect((await f.send('Consulte para mim', 'same')).replay).toBe(true);
    f.deps.interpretTurn.mockResolvedValue({ kind: 'answer' });
    f.deps.planCollection.mockResolvedValue({ intent: 'contribute', observations: [], deferFields: [], nextFieldKey: null });
    await f.send('Vamos continuar'); expect(f.deps.execute).toHaveBeenCalledTimes(1);
  });
  it('proposes a ready write but dispatches only after scoped confirmation, then does not repeat it', async () => {
    const f = fixture(); const step = f.document.resolveStage.procedures[0].steps[2];
    step.httpRequest!.method = 'POST'; f.state.values = { postal: '72800000', address: 'Rua Azul' };
    await f.send('Pode prosseguir'); expect(f.state.confirmation?.key).toBe('request:lookup');
    expect(f.deps.execute).not.toHaveBeenCalled();
    f.deps.interpretTurn.mockResolvedValue({ kind: 'confirm' });
    await f.send('sim'); expect(f.deps.execute).toHaveBeenCalledTimes(1);
    expect(f.deps.execute.mock.calls[0][2].confirmed).toBe(true); expect(f.state.phase).toBe('conclude');
  });
  it('rejects an invented capability without effects or claims of success', async () => {
    const f = fixture(); f.state.values.address = 'Rua Azul';
    f.deps.planAction.mockResolvedValue('step:delete_other_contact');
    const result = await f.send('Siga'); expect(f.deps.execute).not.toHaveBeenCalled();
    expect(result.response).toContain('segurança'); expect(f.state.events.some((e) => e.kind === 'adaptive_action_rejected')).toBe(true);
  });
  it('never claims success or retries a tool with an unknown outcome', async () => {
    const f = fixture(); f.state.values.address = 'Rua Azul'; f.deps.execute.mockRejectedValue(new Error('timeout'));
    const result = await f.send('Consulte');
    expect(result.response).not.toContain('Resultado verificado'); expect(f.deps.execute).toHaveBeenCalledTimes(1);
    expect(f.state.events.some((e) => e.kind === 'outcome_unknown')).toBe(true);
    await f.send('Tente novamente'); expect(f.deps.execute).toHaveBeenCalledTimes(1);
  });
  it('does not silently overwrite customer facts with a conflicting tool result', async () => {
    const f = fixture(); f.state.values = { postal: '72800001', address: 'Rua Azul' };
    f.state.valueOrigins = { postal: { source: 'customer', confirmed: true, stepId: 'request:postal', at: new Date().toISOString() } };
    await f.send('Confira'); expect(f.state.values.postal).toBe('72800001');
    expect(f.state.events.some((e) => e.kind === 'adaptive_evidence_conflict')).toBe(true);
    expect(f.state.adaptiveCompletedSteps?.['request:lookup']).toBe(true);
  });
  it('does not expose sensitive, unconfigured, oversized or wrong-source values as answer evidence', () => {
    const f = fixture(); f.state.values = { postal: '72800000', secret: 'private' };
    f.state.valueOrigins = { postal: { source: 'integration', confirmed: false, stepId: 'lookup', at: '' },
      secret: { source: 'integration', confirmed: false, stepId: 'lookup', at: '' } };
    expect(studioVerifiedEvidence(f.document, f.state)).toEqual({ postal: '72800000' });
    f.document.resolveStage.procedures[0].steps[2].httpRequest!.outputMappings[0].sensitive = true;
    expect(studioVerifiedEvidence(f.document, f.state)).toEqual({});
    f.document.resolveStage.procedures[0].steps[2].httpRequest!.outputMappings[0].sensitive = false;
    f.state.values.postal = 'x'.repeat(9000); expect(studioVerifiedEvidence(f.document, f.state)).toEqual({});
    f.state.values.postal = '72800000'; f.state.valueOrigins.postal.stepId = 'foreign';
    expect(studioVerifiedEvidence(f.document, f.state)).toEqual({});
  });
  it.each(['missing', 'unconfirmed', 'branch', 'message', 'terminal', 'write_question'])('does not expose capabilities across %s constraints', (mode) => {
    const f = fixture(); const steps = f.document.resolveStage.procedures[0].steps;
    f.state.values.address = 'Rua Azul';
    if (mode === 'missing') delete f.state.values.address;
    if (mode === 'unconfirmed') steps[1].collectField!.requiresConfirmation = true;
    if (mode === 'branch') steps[0].nextStepId = 'lookup';
    if (mode === 'message') steps.splice(1, 0, { id: 'terms', title: 'Termos', order: 2, type: 'message', messageText: 'Condições obrigatórias' });
    if (mode === 'terminal') steps[0].nextStepId = null;
    if (mode === 'write_question') steps[2].httpRequest!.method = 'POST';
    expect(availableStudioActions(f.document, f.state, { values: f.state.values }, mode === 'write_question')).toEqual([]);
  });
  it('exposes read capabilities across cosmetic message steps', () => {
    const f = fixture(); const steps = f.document.resolveStage.procedures[0].steps;
    f.state.values.address = 'Rua Azul';
    steps.splice(1, 0, { id: 'info', title: 'Aviso', order: 2, type: 'message', messageText: 'Aguarde um instante...' });
    const actions = availableStudioActions(f.document, f.state, { values: f.state.values }, false);
    expect(actions.some((a) => a.id === 'step:lookup')).toBe(true);
  });
  it('exposes read capabilities from other procedures when answering a customer question', () => {
    const f = fixture();
    f.document.resolveStage.procedures.push(ProcedureDocumentSchema.parse({
      id: 'coverage', name: 'Consulta de Cobertura', objective: 'Verificar viabilidade', updatedAt: '2026-09-06',
      steps: [
        { id: 'check_cov', type: 'http_request', title: 'Verificar viabilidade no endereço', order: 1,
          httpRequest: HttpRequestStepConfigSchema.parse({ name: 'Viabilidade', method: 'GET', url: 'https://example.com/coverage',
            sentDataMappings: [{ apiField: 'address', sourceType: 'collected_field', sourceValue: 'address' }],
            outputMappings: [{ chipKey: 'has_coverage', chipLabel: 'Possui cobertura', jsonPath: 'coverage' }] }) },
      ],
    }));
    f.state.values.address = 'Rua Azul';
    const actions = availableStudioActions(f.document, f.state, { values: f.state.values }, true);
    expect(actions.some((a) => a.id === 'step:check_cov')).toBe(true);
  });
});
