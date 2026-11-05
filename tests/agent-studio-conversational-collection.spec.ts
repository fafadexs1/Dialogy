import { describe, expect, it, vi } from 'vitest';
import { resolveStudioOption } from '@/services/agent-studio/option-resolution';
import { advanceStudioSession, createStudioSession, StudioSessionSchema, type StudioEngineDependencies } from '@/services/agent-studio/engine';
import { CollectedFieldDefinitionSchema, createDefaultAgentStudioDocument, ProcedureDocumentSchema } from '@/services/agent-studio/types';
import { isStudioFieldQuestion } from '@/services/agent-studio/collection';

// Anonymized options from the production incident: the customer answered "500".
const plans = [
  '500 MEGA — R$ 99,90 com pontualidade / R$ 109,90 normal',
  '600 MEGA + 60 canais — R$ 109,90 com pontualidade / R$ 119,90 normal',
  '800 MEGA + 75 canais — R$ 125,90 com pontualidade / R$ 135,90 normal',
  '1000 MEGA + 100 canais + Wi-Fi 6 — R$ 149,90 com pontualidade / R$ 159,90 normal',
];

describe('unambiguous selection of offered options', () => {
  it.each(['500', '500 mega', 'quero 500', 'quero o de 500', 'plano de 500', 'Eu quero o plano de 500', '1', 'primeiro', 'a primeira', 'quero o primeiro', '500, por favor'])('resolves %j to the actual published value', (message) => {
    expect(resolveStudioOption(plans, message)).toMatchObject({ kind: 'selected', value: plans[0] });
  });
  it.each(['50', '5000', '99,90', '60', 'Wi-Fi 6', '500 ou 600', 'não quero 500', 'talvez 500', 'se tiver desconto quero 500', '500 tem desconto?', 'Qual a diferença entre 500 e 600?', 'Tem desconto pagando pelo cartão de crédito ?'])('does not guess a selection from %j', (message) => {
    expect(resolveStudioOption(plans, message).kind).toBe('unrecognized');
  });
  it('handles product labels outside telecom', () => {
    expect(resolveStudioOption(['Essencial — suporte por e-mail', 'Premium + atendimento 24h'], 'quero Premium'))
      .toMatchObject({ kind: 'selected', value: 'Premium + atendimento 24h' });
  });
  it('asks for clarification when two products share the same speed', () => {
    const options = ['500 MEGA + TV', '500 MEGA + Música'];
    expect(resolveStudioOption(options, '500')).toEqual({ kind: 'ambiguous', options });
    expect(resolveStudioOption(options, '500 MEGA + Música')).toMatchObject({ kind: 'selected', value: options[1] });
  });
  it('does not confuse a product number with a list position', () => {
    const options = ['2 MEGA', '10 MEGA'];
    expect(resolveStudioOption(options, '2').kind).toBe('ambiguous');
    expect(resolveStudioOption(plans, '1', false).kind).toBe('unrecognized');
  });
  it('preserves valid URLs containing question marks', () => {
    const field = CollectedFieldDefinitionSchema.parse({ id: 'url', name: 'Site', variableKey: 'url', type: 'url', promptMessage: 'Qual site?' });
    expect(isStudioFieldQuestion(field, 'https://example.com/path?item=500')).toBe(false);
    expect(isStudioFieldQuestion(field, 'Como encontro o endereço?')).toBe(true);
  });
  it('does not erase question punctuation to turn a question into a selection', () => {
    expect(resolveStudioOption(['500 MEGA', '600 MEGA'], '500 mega?').kind).toBe('unrecognized');
    expect(resolveStudioOption(['500', '600'], '500?').kind).toBe('unrecognized');
  });
  it.each(['quero Completo desde que tenha entrega gratuita', 'Completo caso inclua suporte', 'depende do prazo do Completo',
    'O Completo parece caro', 'gostei do Completo', 'quero Completo mas somente com desconto', 'quero entender melhor o Completo'])('does not turn a mention or conditional preference into consent: %s', (message) => {
    expect(resolveStudioOption(['Essencial', 'Completo'], message).kind).toBe('unrecognized');
  });
});

function conversation(options = plans, overrides: Partial<StudioEngineDependencies> = {}) {
  const document = createDefaultAgentStudioDocument('agent', 'workspace');
  const planField = CollectedFieldDefinitionSchema.parse({ id: 'plan', name: 'Plano desejado', variableKey: 'plan', type: 'single_select', promptMessage: 'Qual plano você deseja contratar?', options });
  document.resolveStage.procedures = [ProcedureDocumentSchema.parse({ id: 'contract', name: 'Contratar', triggerKeywords: ['contratar'], updatedAt: '2026-09-05', steps: [
    { id: 'plan', order: 1, title: 'Plano', type: 'collect_data', collectField: planField },
    { id: 'phone', order: 2, title: 'Telefone', type: 'collect_data', collectField: CollectedFieldDefinitionSchema.parse({ id: 'phone', name: 'Telefone', variableKey: 'phone', type: 'phone', promptMessage: 'Qual telefone com DDD?' }) },
  ] })];
  let state = createStudioSession('agent', 'published-release', 'session');
  let sequence = 0;
  const dependencies = { knowledge: vi.fn<(...args: unknown[]) => Promise<string | null>>().mockResolvedValue('O desconto publicado é por pontualidade.'), execute: vi.fn().mockResolvedValue({}), handoff: vi.fn().mockResolvedValue(undefined), checkpoint: vi.fn().mockResolvedValue(undefined) };
  return { document, dependencies, get state() { return state; },
    async send(message: string, id = String(++sequence)) {
      // Persist/reload the same schema production uses between turns.
      const result = await advanceStudioSession({ document, state: StudioSessionSchema.parse(JSON.parse(JSON.stringify(state))), message, messageId: id, dependencies: { ...dependencies, ...overrides } });
      state = result.state;
      return result;
    },
  };
}

describe('production incident replay through the shared session engine', () => {
  it('answers a pricing question, accepts 500 and advances without losing the procedure', async () => {
    const f = conversation();
    await f.send('contratar');
    const question = await f.send('Tem desconto pagando pelo cartão de crédito ?');
    expect(question.response).toBe('O desconto publicado é por pontualidade.');
    expect(question.state.pendingField).toBe('plan');
    expect(question.state.attempts).toEqual({});
    const answer = await f.send('500');
    expect(answer.state.values.plan).toBe(plans[0]);
    expect(answer.state.pendingField).toBe('phone');
    expect(answer.response).toBe('Qual telefone com DDD?');
    expect(answer.state.events.some((event) => event.kind === 'validation_failed')).toBe(false);
    expect(answer.state.events.some((event) => event.kind === 'collection_option_matched' && event.label.endsWith('short_answer'))).toBe(true);
    expect(f.dependencies.execute).not.toHaveBeenCalled();
    expect(f.dependencies.handoff).not.toHaveBeenCalled();
  });
  it('keeps values, attempts and the current step while answering repeated doubts', async () => {
    const f = conversation(); await f.send('contratar');
    for (const text of ['500 tem desconto?', 'Como funciona o pagamento', 'Qual é a fidelidade?']) {
      const turn = await f.send(text);
      expect(turn.state.values).toEqual({});
      expect(turn.state.stepIndex).toBe(0);
      expect(turn.state.pendingField).toBe('plan');
      expect(turn.state.attempts).toEqual({});
    }
    expect((await f.send('600')).state.values.plan).toBe(plans[1]);
  });
  it.each(['absent', 'failed'])('preserves collection when knowledge is %s', async (mode) => {
    const f = conversation(); await f.send('contratar');
    if (mode === 'failed') f.dependencies.knowledge.mockRejectedValue(new Error('Provider unavailable'));
    else f.dependencies.knowledge.mockResolvedValue(null);
    const turn = await f.send('Tem desconto?');
    expect(turn.response).toContain('Não tenho informação confirmada');
    expect(turn.state.attempts).toEqual({});
    expect((await f.send('500')).state.pendingField).toBe('phone');
  });
  it('clarifies ambiguous options without spending invalid-answer attempts or renumbering', async () => {
    const f = conversation(['100 MEGA', '500 MEGA + TV', '500 MEGA + Música']); await f.send('contratar');
    const turn = await f.send('500');
    expect(turn.response).toContain('2. 500 MEGA + TV');
    expect(turn.response).toContain('3. 500 MEGA + Música');
    expect(turn.state.attempts).toEqual({});
    expect((await f.send('3')).state.values.plan).toBe('500 MEGA + Música');
  });
  it('does not repeat knowledge calls or advance on duplicate incoming messages', async () => {
    const f = conversation(); await f.send('contratar');
    const original = await f.send('Tem desconto?', 'question');
    const replay = await f.send('Tem desconto?', 'question');
    expect(replay.response).toBe(original.response); expect(replay.replay).toBe(true);
    expect(f.dependencies.knowledge).toHaveBeenCalledOnce();
  });
  it('resumes after a greeting without penalizing the customer', async () => {
    const f = conversation(); await f.send('contratar');
    const turn = await f.send('Bom dia');
    expect(turn.response).toContain('continuar de onde paramos');
    expect(turn.state.attempts).toEqual({});
    expect((await f.send('500')).state.pendingField).toBe('phone');
  });
  it('still honors cancellation and validates personal data strictly', async () => {
    const f = conversation(); await f.send('contratar'); await f.send('500');
    expect((await f.send('123')).state.pendingField).toBe('phone');
    const turn = await f.send('não precisa');
    expect(turn.state.procedureId).toBeNull();
    expect(f.dependencies.execute).not.toHaveBeenCalled();
  });
  it('gives a new answer precedence over a remembered choice from another procedure', async () => {
    const f = conversation(); await f.send('contratar');
    f.state.sessionFacts = { plan: { value: plans[1], fieldType: 'single_select', labels: ['plano desejado'], source: 'customer', confirmed: true, isSensitive: false, at: '2026-09-04T00:00:00Z' } };
    const result = await f.send('500');
    expect(result.state.values.plan).toBe(plans[0]);
  });
  it('does not reroute a clear answer even when the model would choose another procedure', async () => {
    const f = conversation(); await f.send('contratar');
    const chooseProcedure = vi.fn().mockResolvedValue('unrelated');
    const classifyControl = vi.fn().mockResolvedValue('change_intent');
    const result = await advanceStudioSession({ document: f.document, state: f.state, message: 'prefiro o plano de 500', messageId: 'selection',
      dependencies: { ...f.dependencies, chooseProcedure, classifyControl } });
    expect(result.state.values.plan).toBe(plans[0]);
    expect(result.state.pendingField).toBe('phone');
    expect(chooseProcedure).not.toHaveBeenCalled();
    expect(classifyControl).not.toHaveBeenCalled();
  });
  it('maps a shortened dynamic option back to its typed integration ID', async () => {
    const f = conversation();
    const field = f.document.resolveStage.procedures[0].steps[0].collectField!;
    field.options = [];
    field.optionsSourceKey = 'products'; field.optionLabelPath = 'name'; field.optionValuePath = 'id';
    f.state.values.products = [{ id: 712, name: plans[0] }, { id: 930, name: plans[1] }];
    await f.send('contratar');
    const chooseProcedure = vi.fn().mockResolvedValue('unrelated');
    const result = await advanceStudioSession({ document: f.document, state: f.state, message: 'quero o plano de 500', messageId: 'dynamic-choice',
      dependencies: { ...f.dependencies, chooseProcedure } });
    expect(result.state.values.plan).toBe(712);
    expect(result.state.pendingField).toBe('phone');
    expect(chooseProcedure).not.toHaveBeenCalled();
  });
});

describe('contextual collection without guessed consent', () => {
  const options = ['Básico', 'Completo + acompanhamento'];
  const proposal = () => vi.fn().mockResolvedValue({ kind: 'proposal', label: options[1] });
  it('persists a proposal separately from customer facts and confirms it after reload', async () => {
    const interpretCollection = proposal();
    const f = conversation(options, { interpretCollection }); await f.send('contratar');
    const result = await f.send('aquele com acompanhamento', 'proposal');
    expect(result.response).toContain(`Você quer dizer ${options[1]}`);
    expect(result.state.values).toEqual({}); expect(result.state.sessionFacts).toEqual({});
    expect(result.state.attempts).toEqual({}); expect(f.dependencies.execute).not.toHaveBeenCalled();
    expect(interpretCollection).toHaveBeenCalledOnce();
    expect(interpretCollection.mock.calls[0][0].lastAssistantMessage).toContain('Qual plano');
    expect((await f.send('aquele com acompanhamento', 'proposal')).replay).toBe(true);
    expect(interpretCollection).toHaveBeenCalledOnce();
    const confirmed = await f.send('sim');
    expect(confirmed.state.values.plan).toBe(options[1]); expect(confirmed.state.pendingField).toBe('phone');
    expect(confirmed.state.collectionProposal).toBeUndefined();
    expect(interpretCollection).toHaveBeenCalledOnce();
    expect(confirmed.state.events.some((event) => event.kind === 'collection_interpretation_confirmed')).toBe(true);
  });
  it.each(['não', 'Básico', 'não precisa'])('honors correction or withdrawal %s', async (message) => {
    const f = conversation(options, { interpretCollection: proposal() }); await f.send('contratar');
    await f.send('aquele com acompanhamento');
    const result = await f.send(message);
    expect(result.state.values.plan).not.toBe(options[1]);
    expect(result.state.collectionProposal).toBeUndefined();
    expect(result.state.attempts).toEqual({}); expect(f.dependencies.execute).not.toHaveBeenCalled();
    if (message === 'Básico') expect(result.state.values.plan).toBe(options[0]);
    if (message === 'não precisa') expect(result.state.procedureId).toBeNull();
  });
  it('does not call the model for clear selections, explicit questions or greetings', async () => {
    const interpretCollection = proposal(); const f = conversation(options, { interpretCollection });
    await f.send('contratar'); await f.send('Bom dia'); await f.send('Qual inclui acompanhamento?'); await f.send('Básico');
    expect(interpretCollection).not.toHaveBeenCalled();
  });
  it.each(['unclear', 'unavailable', 'bad_proposal', 'error'])('keeps the customer on track when interpretation is %s', async (mode) => {
    const interpretCollection = vi.fn();
    if (mode === 'error') interpretCollection.mockRejectedValue(new Error('provider offline'));
    else interpretCollection.mockResolvedValue(mode === 'bad_proposal' ? { kind: 'proposal', label: 'Inventado' } : { kind: mode });
    const f = conversation(options, { interpretCollection }); await f.send('contratar');
    const result = await f.send('aquele outro');
    expect(result.state.values).toEqual({}); expect(result.state.attempts).toEqual({});
    expect(result.state.pendingField).toBe('plan'); expect(result.state.collectionProposal).toBeUndefined();
    expect(result.response).toContain('com segurança'); expect(interpretCollection).toHaveBeenCalledOnce();
    expect((await f.send('Básico')).state.pendingField).toBe('phone');
  });
  it('recognizes an indirect question without consuming a validation attempt', async () => {
    const interpretCollection = vi.fn().mockResolvedValue({ kind: 'question' });
    const f = conversation(options, { interpretCollection }); await f.send('contratar');
    const result = await f.send('me conta mais sobre esse acompanhamento');
    expect(result.state.pendingField).toBe('plan'); expect(result.state.attempts).toEqual({});
    expect(f.dependencies.knowledge).toHaveBeenCalledOnce(); expect(interpretCollection).toHaveBeenCalledOnce();
  });
  it('routes a genuinely different request through normal eligibility and confirmation', async () => {
    const interpretCollection = vi.fn().mockResolvedValue({ kind: 'different_request' });
    const f = conversation(options, { interpretCollection });
    f.document.resolveStage.procedures.push(ProcedureDocumentSchema.parse({ id: 'delivery', name: 'Consultar entrega', triggerKeywords: ['encomenda'], steps: [], updatedAt: '2026-09-05' }));
    await f.send('contratar');
    const result = await f.send('minha encomenda não chegou');
    expect(result.state.topicChange?.procedureId).toBe('delivery');
    expect(result.state.procedureId).toBe('contract'); expect(result.state.values).toEqual({});
    expect(f.dependencies.execute).not.toHaveBeenCalled();
  });
  it('expires a proposal without accepting a stale yes', async () => {
    let now = 1000;
    const f = conversation(options, { interpretCollection: proposal(), now: () => now }); await f.send('contratar');
    await f.send('aquele com acompanhamento'); now += 600_001;
    const result = await f.send('sim');
    expect(result.state.values).toEqual({}); expect(result.response).toContain('expirou ou mudou');
    expect(result.state.collectionProposal).toBeUndefined(); expect(result.state.attempts).toEqual({});
  });
  it('invalidates a proposal if the underlying integration ID changes', async () => {
    const f = conversation(options, { interpretCollection: proposal() });
    const field = f.document.resolveStage.procedures[0].steps[0].collectField!;
    field.optionsSourceKey = 'products'; field.optionLabelPath = 'name'; field.optionValuePath = 'id';
    f.state.values.products = [{ id: 10, name: options[0] }, { id: 20, name: options[1] }];
    await f.send('contratar'); await f.send('aquele com acompanhamento');
    (f.state.values.products as { id: number; name: string }[])[1].id = 30;
    const result = await f.send('sim');
    expect(result.state.values.plan).toBeUndefined(); expect(result.response).toContain('expirou ou mudou');
  });
  it('does not request the same field confirmation twice', async () => {
    const f = conversation(options, { interpretCollection: proposal() });
    f.document.resolveStage.procedures[0].steps[0].collectField!.requiresConfirmation = true;
    await f.send('contratar'); await f.send('aquele com acompanhamento');
    const result = await f.send('sim');
    expect(result.state.pendingField).toBe('phone');
    expect(result.state.valueOrigins?.plan.confirmed).toBe(true);
  });
  it('keeps the actual confirmation question when a long proposal repeats', async () => {
    const label = `Completo + ${'acompanhamento personalizado '.repeat(5)}`;
    const f = conversation(['Básico', label], { interpretCollection: vi.fn().mockResolvedValue({ kind: 'proposal', label }) });
    await f.send('contratar'); await f.send('aquele com acompanhamento');
    const result = await f.send('aquele com acompanhamento');
    expect(result.response).toContain(`Confirma ${label}?`);
    expect(result.response).not.toContain('vou parar');
    expect(result.state.values.plan).toBeUndefined();
  });
  it('never consults the interpreter for sensitive collection fields', async () => {
    const interpretCollection = proposal(); const f = conversation(options, { interpretCollection });
    f.document.resolveStage.procedures[0].steps[0].collectField!.isSensitive = true;
    await f.send('contratar'); await f.send('aquele com acompanhamento');
    expect(interpretCollection).not.toHaveBeenCalled();
  });
});
