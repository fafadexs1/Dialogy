import { describe, it, expect, vi } from 'vitest';
import { advanceStudioSession, createStudioSession, evaluateStudioCondition, type StudioEngineDependencies, type StudioSession } from '@/services/agent-studio/engine';
import { CollectedFieldDefinitionSchema, createDefaultAgentStudioDocument, HttpRequestStepConfigSchema, ProcedureDocumentSchema, type ProcedureStep } from '@/services/agent-studio/types';
import { isValidStudioCnpj, validateStudioField } from '@/services/agent-studio/collection';

const field = (extra = {}) => CollectedFieldDefinitionSchema.parse({ id: 'cpf', name: 'CPF', variableKey: 'cpf', type: 'cpf', promptMessage: 'Qual seu CPF?', ...extra });
const validCpf = '529.982.247-25';
function fixture(steps?: ProcedureStep[]) {
  const document = createDefaultAgentStudioDocument('agent', 'workspace');
  document.concludeStage.handoffTeam = 'Suporte';
  document.resolveStage.procedures = [ProcedureDocumentSchema.parse({ id: 'billing', name: 'Fatura', triggerKeywords: ['fatura'], updatedAt: '2026-08-27', steps: steps || [
    { id: 'collect', order: 1, title: 'Identificar', type: 'collect_data', collectField: field() },
    { id: 'api', order: 2, title: 'Consultar faturas', type: 'http_request', httpRequest: HttpRequestStepConfigSchema.parse({ name: 'Faturas', url: 'https://example.com/invoices' }) },
    { id: 'reply', order: 3, title: 'Responder', type: 'respond', messageText: 'Resultado da consulta:', messageDataKeys: ['invoice'] },
  ] })];
  let state = createStudioSession(document.id, 'release-1', 'session');
  const deps: StudioEngineDependencies = { execute: vi.fn(async () => ({ values: { invoice: 'Fatura encontrada' } })), knowledge: vi.fn(async () => null), handoff: vi.fn(async () => {}), checkpoint: vi.fn(async () => {}) };
  let turn = 0;
  return { document, deps, get state() { return state; }, setState(next: StudioSession) { state = next; },
    async send(message: string, messageId = String(++turn), suggestionOnly = false) {
      const result = await advanceStudioSession({ document, state, message, messageId, dependencies: deps, suggestionOnly });
      state = result.state; return result;
    } };
}

describe('Studio collection validation', () => {
  it.each([['cpf', validCpf, '52998224725'], ['cnpj', '11.222.333/0001-81', '11222333000181'], ['currency', 'R$ 1.230,50', 1230.5], ['number', '1,5', 1.5], ['boolean', 'não', false], ['date', '29/02/2024', '2024-02-29'], ['email', 'TESTE@EMPRESA.COM', 'teste@empresa.com']])('validates %s', (type, value, expected) => {
    expect(validateStudioField(field({ type }), value)).toEqual({ valid: true, value: expected });
  });
  it.each([['cpf', '123.456.789-00'], ['cpf', '00000000000'], ['date', '31/02/2026'], ['time', '24:59'], ['currency', 'R$ x'], ['url', 'javascript:alert(1)'], ['url', 'https://user:secret@example.com'], ['email', 'a@b'], ['file', 'https://example.com/file.pdf'], ['text', '   ']])('rejects invalid %s', (type, value) => {
    expect(validateStudioField(field({ type }), value).valid).toBe(false);
  });
  it('accepts the Receita Federal alphanumeric CNPJ example and rejects wrong check digits', () => {
    expect(isValidStudioCnpj('12.ABC.345/01DE-35')).toBe(true);
    expect(isValidStudioCnpj('12.ABC.345/01DE-36')).toBe(false);
  });
  it('preserves typed selections and validates limits', () => {
    expect(validateStudioField(field({ type: 'multi_select', options: ['A', 'B'] }), '1, 2')).toEqual({ valid: true, value: ['A', 'B'] });
    expect(validateStudioField(field({ type: 'number', minValue: 1 }), '0').valid).toBe(false);
    expect(validateStudioField(field({ type: 'text', validationRegex: '(a+)+' }), 'aaa').valid).toBe(false);
  });
});

describe('Studio real state machine with injected effects', () => {
  it('ignores an older duplicate message after a later turn without repeating the action', async () => {
    const f = fixture(); await f.send('fatura', 'first'); await f.send(validCpf, 'second');
    const duplicate = await f.send('fatura', 'first');
    expect(duplicate.replay).toBe(true); expect(duplicate.response).toBe(''); expect(f.deps.execute).toHaveBeenCalledOnce();
    expect(duplicate.state.turnCount).toBe(2);
  });
  it('enforces the turn budget without treating duplicate deliveries as new turns', async () => {
    const f = fixture(); f.document.rules.maxTurnsPerSession = 2;
    await f.send('fatura', 'first'); await f.send('fatura', 'first'); await f.send('dado inválido', 'second');
    expect((await f.send('dado inválido', 'third')).state.status).toBe('transferred'); expect(f.deps.execute).not.toHaveBeenCalled();
  });
  it('stops before dispatching an action beyond the session budget', async () => {
    const f = fixture(); f.document.rules.maxToolCallsPerSession = 1;
    f.document.resolveStage.procedures[0].steps.splice(2, 0, { ...f.document.resolveStage.procedures[0].steps[1], id: 'api-second', order: 3 });
    const result = await f.send(`fatura ${validCpf}`);
    expect(result.state.status).toBe('transferred'); expect(result.state.toolCallCount).toBe(1); expect(f.deps.execute).toHaveBeenCalledOnce();
  });
  const addScheduling = (f: ReturnType<typeof fixture>) => f.document.resolveStage.procedures.push(ProcedureDocumentSchema.parse({ id: 'schedule', name: 'Agendamento', triggerKeywords: ['agendar'], updatedAt: '2026-08-27', steps: [
    { id: 'date', order: 1, type: 'collect_data', title: 'Escolher data', collectField: field({ id: 'date', name: 'Data', variableKey: 'date', type: 'date', promptMessage: 'Qual data?' }) },
  ] }));
  it('answers a greeting naturally without exposing the procedure router', async () => {
    const f = fixture(); addScheduling(f);
    f.deps.chooseProcedure = vi.fn().mockResolvedValue({ candidates: ['billing', 'schedule'] });
    const result = await f.send('Olá!');
    expect(result.response).toBe(f.document.understandStage.welcomeMessage);
    expect(result.response).not.toContain('solicitações');
    expect(result.state.status).toBe('waiting_input');
    expect(result.state.procedureId).toBeNull();
    expect(f.deps.chooseProcedure).not.toHaveBeenCalled();
    const repeated = await f.send('Oi');
    expect(repeated.response).toBe(f.document.understandStage.welcomeMessage);
    expect(repeated.response).not.toContain('solicitações');
  });
  it('does not prepend the welcome presentation when the first message already has a clear intent', async () => {
    const f = fixture();
    const result = await f.send('fatura');
    expect(result.response).toContain('Qual seu CPF?');
    expect(result.response).not.toContain(f.document.understandStage.welcomeMessage);
  });
  it('asks which procedure was intended instead of executing an ambiguous match', async () => {
    const f = fixture(); addScheduling(f); f.document.resolveStage.procedures[1].triggerKeywords = ['fatura'];
    const ambiguous = await f.send('Preciso de fatura');
    expect(ambiguous.response).toContain('Só para eu entender melhor');
    expect(ambiguous.response).toContain('“Fatura” ou “Agendamento”'); expect(ambiguous.state.procedureId).toBeNull();
    expect(f.deps.execute).not.toHaveBeenCalled();
    expect((await f.send('Agendamento')).response).toContain('Qual data?');
  });
  it('rechecks eligibility after an explicit choice from model-provided ambiguous candidates', async () => {
    const f = fixture(); addScheduling(f);
    f.deps.chooseProcedure = vi.fn().mockResolvedValueOnce({ candidates: ['billing', 'schedule'] }).mockResolvedValueOnce(null);
    await f.send('Preciso de ajuda'); const result = await f.send('2');
    expect(result.state.procedureId).toBeNull(); expect(f.deps.execute).not.toHaveBeenCalled();
    expect(vi.mocked(f.deps.chooseProcedure).mock.calls[1][0].map((procedure) => procedure.id)).toEqual(['schedule']);
  });
  it('confirms a subject change, discards procedure data and collects the new information', async () => {
    const f = fixture(); addScheduling(f); await f.send(`fatura ${validCpf}`);
    const requested = await f.send('Quero agendar'); expect(requested.response).toContain('Posso seguir com isso?');
    expect(requested.state.procedureId).toBe('billing');
    const switched = await f.send('sim'); expect(switched.state.procedureId).toBe('schedule');
    expect(switched.state.values.cpf).toBeUndefined(); expect(switched.state.values.invoice).toBeUndefined();
    expect(switched.response).toContain('Qual data?'); expect(f.deps.execute).toHaveBeenCalledOnce();
  });
  it('preserves an unambiguous selection offered before confirming a subject change', async () => {
    const f = fixture();
    f.document.resolveStage.procedures.push(ProcedureDocumentSchema.parse({
      id: 'contract', name: 'Iniciar contratação', triggerKeywords: ['contratar'], updatedAt: '2026-08-30', steps: [
        { id: 'plan', order: 1, type: 'collect_data', title: 'Escolher plano', collectField: field({
          id: 'plan', name: 'Plano', variableKey: 'selected_plan', type: 'single_select', promptMessage: 'Qual plano você deseja contratar?',
          options: ['500 MEGA + Wi-Fi 5 — R$ 79,90', '1000 MEGA + Wi-Fi 6 — R$ 109,90'],
        }) },
        { id: 'email', order: 2, type: 'collect_data', title: 'E-mail', collectField: field({ id: 'email', name: 'E-mail', variableKey: 'email', type: 'email', promptMessage: 'Qual e-mail?' }) },
      ],
    }));
    await f.send('fatura');
    f.deps.chooseProcedure = vi.fn().mockResolvedValue('contract');
    const requested = await f.send('Cara, esse de 1000 MEGA, eu quero esse.');
    expect(requested.response).toContain('Posso seguir com isso?');
    const switched = await f.send('Sim.');
    expect(switched.state.values.selected_plan).toBe('1000 MEGA + Wi-Fi 6 — R$ 109,90');
    expect(switched.response).toContain('Qual e-mail?');
    expect(switched.response).not.toContain('Qual plano você deseja contratar?');
  });
  it('discards information offered for a subject change when the change is declined', async () => {
    const f = fixture(); addScheduling(f); await f.send('fatura');
    const requested = await f.send('Quero agendar para 01/09/2026');
    expect(requested.state.values.date).toBe('2026-09-01');
    const declined = await f.send('não');
    expect(declined.state.procedureId).toBe('billing');
    expect(declined.state.values.date).toBeUndefined();
  });
  it('reuses a validated conversational fact in another procedure without asking twice', async () => {
    const f = fixture(); addScheduling(f);
    f.document.resolveStage.procedures[0].steps.unshift({ id: 'email', order: 1, type: 'collect_data', title: 'E-mail', collectField: field({ id: 'email', name: 'E-mail', aliases: ['e-mail para contato'], variableKey: 'billing_email', type: 'email', promptMessage: 'Qual e-mail?' }) });
    f.document.resolveStage.procedures[1].steps.unshift({ id: 'contact', order: 1, type: 'collect_data', title: 'Contato', collectField: field({ id: 'contact', name: 'E-mail', aliases: ['e-mail para contato'], variableKey: 'schedule_email', type: 'email', promptMessage: 'Qual e-mail para o agendamento?' }) });
    expect((await f.send('fatura')).response).toContain('Qual e-mail?');
    expect((await f.send('cliente@example.com')).response).toContain('Qual seu CPF?');
    await f.send('Quero agendar');
    const switched = await f.send('sim');
    expect(switched.state.values.schedule_email).toBe('cliente@example.com');
    expect(switched.response).toContain('Qual data?');
    expect(switched.response).not.toContain('Qual e-mail para o agendamento?');
    expect(switched.state.events.some((event) => event.kind === 'memory_reused')).toBe(true);
  });
  it('keeps the previous collection when a subject change is declined', async () => {
    const f = fixture(); addScheduling(f); await f.send('fatura'); await f.send('Quero agendar');
    const result = await f.send('não'); expect(result.state.procedureId).toBe('billing'); expect(result.response).toContain('Qual seu CPF?');
    expect(f.deps.execute).not.toHaveBeenCalled();
  });
  it('does not repeat an incomplete write when changing subjects', async () => {
    const f = fixture(); addScheduling(f); f.document.resolveStage.procedures[0].steps[1].httpRequest!.method = 'POST';
    f.document.resolveStage.procedures[0].steps.push({ id: 'email', order: 4, title: 'E-mail', type: 'collect_data', collectField: field({ id: 'email', name: 'E-mail', variableKey: 'email', type: 'email' }) });
    await f.send(`fatura ${validCpf}`); await f.send('sim'); await f.send('Quero agendar');
    expect((await f.send('sim')).state.status).toBe('transferred'); expect(f.deps.execute).toHaveBeenCalledOnce();
  });
  it('does not reuse a previous procedure customer identifier for a fresh request', async () => {
    const f = fixture(); await f.send(`fatura ${validCpf}`);
    const result = await f.send('Preciso de outra fatura'); expect(result.response).toContain('Qual seu CPF?');
    expect(f.deps.execute).toHaveBeenCalledOnce();
  });
  it('captures several labelled fields before waiting for another missing field', async () => {
    const f = fixture(); f.document.understandStage.askInitialData = true;
    f.document.understandStage.initialFields = [field({ id: 'name', variableKey: 'name', name: 'Nome', type: 'text', promptMessage: 'Qual nome?' }), field(), field({ id: 'email', variableKey: 'email', name: 'E-mail', type: 'email', promptMessage: 'Qual e-mail?' })];
    const first = await f.send(`Quero fatura; CPF: ${validCpf}; E-mail: teste@example.com`);
    expect(first.response).toContain('Qual nome?'); expect(first.state.values.email).toBe('teste@example.com');
    expect((await f.send('Maria')).response).toContain('Fatura encontrada');
  });
  it('recognizes configured alternative field names in labelled answers and corrections', async () => {
    const f = fixture(); f.document.understandStage.askInitialData = true;
    f.document.understandStage.initialFields = [field({ aliases: ['documento'] })];
    await f.send(`Quero fatura; documento: ${validCpf}`);
    expect(f.state.values.cpf).toBe('52998224725'); expect(f.deps.execute).toHaveBeenCalledOnce();
    await f.send('Quero corrigir documento: 111.444.777-35');
    expect(f.state.values.cpf).toBe('11144477735');
  });
  it('reuses only configured, valid contact information and still confirms it', async () => {
    const f = fixture([{ id: 'email', order: 1, type: 'collect_data', title: 'E-mail', collectField: field({ type: 'email', name: 'E-mail', variableKey: 'email', requiresConfirmation: true, reuseFrom: { sourceType: 'contact_property', sourceValue: 'email' } }) }]);
    const result = await advanceStudioSession({ document: f.document, state: f.state, message: 'fatura', messageId: 'first', context: { contact: { email: 'teste@example.com' } }, dependencies: f.deps });
    expect(result.response).toContain('Confirma E-mail'); expect(result.state.valueOrigins?.email.source).toBe('contact_property'); expect(result.state.valueOrigins?.email.confirmed).toBe(false);
    f.setState(result.state); await f.send('sim'); expect(f.state.valueOrigins?.email.confirmed).toBe(true);
  });
  it('asks again when the configured contact value is invalid', async () => {
    const f = fixture([{ id: 'email', order: 1, type: 'collect_data', title: 'E-mail', collectField: field({ type: 'email', name: 'E-mail', variableKey: 'email', promptMessage: 'Qual e-mail?', reuseFrom: { sourceType: 'contact_property', sourceValue: 'email' } }) }]);
    const result = await advanceStudioSession({ document: f.document, state: f.state, message: 'fatura', messageId: 'first', context: { contact: { email: 'inválido' } }, dependencies: f.deps });
    expect(result.response).toContain('Qual e-mail?'); expect(result.state.values.email).toBeUndefined();
  });
  it('invalidates downstream results on correction and repeats only read operations', async () => {
    const f = fixture(); f.document.resolveStage.procedures[0].steps[1].httpRequest!.outputMappings = [{ chipKey: 'invoice', chipLabel: 'Fatura', jsonPath: 'invoice' }];
    await f.send(`fatura ${validCpf}`);
    const result = await f.send('Quero corrigir CPF: 111.444.777-35');
    expect(result.state.values.cpf).toBe('11144477735'); expect(f.deps.execute).toHaveBeenCalledTimes(2);
    expect(result.state.valueOrigins?.invoice.source).toBe('integration');
  });
  it('hands off corrections after a write instead of repeating an already executed operation', async () => {
    const f = fixture(); f.document.resolveStage.procedures[0].steps[1].httpRequest!.method = 'POST';
    await f.send(`fatura ${validCpf}`); await f.send('sim');
    expect((await f.send('Quero corrigir CPF: 111.444.777-35')).state.status).toBe('transferred');
    expect(f.deps.execute).toHaveBeenCalledOnce();
  });
  it('uses safe fallback for an invalid initial dynamic list', async () => {
    const f = fixture(); f.document.understandStage.askInitialData = true;
    f.document.understandStage.initialFields = [field({ type: 'single_select', optionsSourceKey: 'missing' })];
    expect((await f.send('fatura')).state.status).toBe('transferred'); expect(f.deps.execute).not.toHaveBeenCalled();
  });
  it('does not repeat a transfer whose checkpoint was lost', async () => {
    const f = fixture(); f.setState({ ...f.state, inFlight: { key: 'reserved', stepId: 'handoff' } });
    const result = await f.send('quero atendente');
    expect(result.state.status).toBe('failed'); expect(f.deps.handoff).not.toHaveBeenCalled();
  });
  it('does not dispatch a transfer if its durable reservation fails', async () => {
    const f = fixture(); vi.mocked(f.deps.checkpoint!).mockRejectedValue(new Error('CAS conflict'));
    await expect(f.send('quero atendente')).rejects.toThrow('segurança'); expect(f.deps.handoff).not.toHaveBeenCalled();
  });
  it('uses configured handoff when the model is unavailable', async () => {
    const f = fixture(); f.deps.chooseProcedure = vi.fn().mockRejectedValue(new Error('Model unavailable'));
    expect((await f.send('Preciso da fatura')).state.status).toBe('transferred'); expect(f.deps.execute).not.toHaveBeenCalled();
  });
  it('announces only the team that actually receives the transfer', async () => {
    const f = fixture([
      { id: 'announce', order: 1, title: 'Avisar', type: 'respond', messageText: 'Vou encaminhar você à equipe Financeira.' },
      { id: 'handoff', order: 2, title: 'Transferir', type: 'handoff', handoffTeam: 'Suporte', handoffReason: 'Acompanhamento necessário' },
    ]);
    f.document.concludeStage.handoffMessage = 'Vou transferir você para a equipe Comercial continuar o atendimento.';
    const result = await f.send('fatura');
    expect(result.state.status).toBe('transferred');
    expect(result.response).toContain('Vou encaminhar seu atendimento para a equipe Suporte continuar com você.');
    expect(result.response).not.toContain(f.document.understandStage.welcomeMessage);
    expect(result.response).not.toMatch(/Financeira|Comercial/);
  });
  it('resolves list selection to the original typed API value', async () => {
    const f = fixture([
      { id: 'list', order: 1, type: 'http_request', title: 'Listar', httpRequest: HttpRequestStepConfigSchema.parse({ name: 'Listar', url: 'https://example.com' }) },
      { id: 'choice', order: 2, type: 'collect_data', title: 'Escolher', collectField: field({ type: 'single_select', variableKey: 'choice', optionsSourceKey: 'items', optionLabelPath: 'label', optionValuePath: 'id' }) },
      { id: 'done', order: 3, type: 'respond', title: 'Resultado', messageText: 'Escolhido:', messageDataKeys: ['choice'] },
    ]);
    vi.mocked(f.deps.execute).mockResolvedValue({ values: { items: [{ id: 7, label: 'Maio' }, { id: 8, label: 'Abril' }] } });
    expect((await f.send('fatura')).response).toContain('1. Maio');
    const result = await f.send('2'); expect(result.state.values.choice).toBe(8); expect(f.deps.execute).toHaveBeenCalledOnce();
  });
  it('collects, validates, resumes, executes once and reuses a response on redelivery', async () => {
    const f = fixture();
    expect((await f.send('Preciso da fatura')).response).toContain('Qual seu CPF?');
    expect(f.deps.execute).not.toHaveBeenCalled();
    expect((await f.send('123.456.789-00')).response).toContain('CPF não é válido');
    const result = await f.send(validCpf, 'final');
    expect(result.response).toContain('Fatura encontrada');
    expect(f.deps.execute).toHaveBeenCalledTimes(1);
    expect((await f.send(validCpf, 'final')).replay).toBe(true);
    expect(f.deps.execute).toHaveBeenCalledTimes(1);
    expect((await f.send('sim')).state.status).toBe('resolved');
  });
  it('retains original intent through initial collection', async () => {
    const f = fixture(); f.document.understandStage.askInitialData = true;
    f.document.understandStage.initialFields = [field()];
    await f.send('Quero minha fatura');
    expect((await f.send(validCpf)).response).toContain('Fatura encontrada');
  });
  it('reuses a supplied CPF instead of asking again', async () => {
    const f = fixture();
    expect((await f.send(`Fatura para CPF ${validCpf}`)).response).toContain('Fatura encontrada');
    expect(f.state.values.cpf).toBe('52998224725');
  });
  it('requires a recent confirmation before POST and persists reservation before dispatch', async () => {
    const f = fixture();
    f.document.resolveStage.procedures[0].steps[1].httpRequest!.method = 'POST';
    expect((await f.send(`Fatura ${validCpf}`)).response).toContain('Posso executar');
    expect(f.deps.execute).not.toHaveBeenCalled();
    await f.send('talvez'); expect(f.deps.execute).not.toHaveBeenCalled();
    await f.send('sim'); expect(f.deps.execute).toHaveBeenCalledTimes(1);
    const calls = vi.mocked(f.deps.checkpoint!).mock.calls;
    expect(calls.some(([state]) => state.inFlight?.stepId === 'api')).toBe(true);
  });
  it('does not execute on cancelled confirmation', async () => {
    const f = fixture(); f.document.resolveStage.procedures[0].steps[1].httpRequest!.method = 'DELETE';
    await f.send(`Fatura ${validCpf}`); await f.send('não');
    expect(f.deps.execute).not.toHaveBeenCalled(); expect(f.state.status).toBe('transferred');
  });
  it('does not replay an operation whose outcome was lost in a crash', async () => {
    const f = fixture(); await f.send('fatura');
    f.setState({ ...f.state, inFlight: { key: 'reserved', stepId: 'api' } });
    await f.send(validCpf);
    expect(f.deps.execute).not.toHaveBeenCalled(); expect(f.deps.handoff).toHaveBeenCalledOnce();
  });
  it('does not expose personal values in its event trail or confirmation for sensitive fields', async () => {
    const f = fixture(); Object.assign(f.document.resolveStage.procedures[0].steps[0].collectField!, { requiresConfirmation: true, isSensitive: true });
    const result = await f.send(`fatura ${validCpf}`);
    expect(result.response).not.toContain('529'); expect(JSON.stringify(result.state.events)).not.toContain('529');
    expect(f.deps.execute).not.toHaveBeenCalled(); await f.send('sim'); expect(f.deps.execute).toHaveBeenCalledOnce();
  });
  it('hands off after the configured number of bad answers', async () => {
    const f = fixture(); await f.send('fatura'); await f.send('a'); await f.send('b'); await f.send('c');
    expect(f.state.status).toBe('transferred'); expect(f.deps.execute).not.toHaveBeenCalled();
  });
  it('cannot report success for a failed integration', async () => {
    const f = fixture(); vi.mocked(f.deps.execute).mockRejectedValue(new Error('Timeout'));
    const result = await f.send(`fatura ${validCpf}`);
    expect(result.response).not.toContain('Fatura encontrada'); expect(f.state.status).toBe('transferred');
    expect(f.state.inFlight).not.toBeNull();
  });
  it('honors operating hours without dispatching effects', async () => {
    const f = fixture(); f.document.rules.operatingHoursEnabled = true;
    f.deps.now = () => Date.parse('2026-08-30T12:00:00Z');
    expect((await f.send(`fatura ${validCpf}`)).response).toContain('segunda a sexta');
    expect(f.deps.execute).not.toHaveBeenCalled();
  });
  it('blocks an explicitly excluded topic before routing, knowledge or actions', async () => {
    const f = fixture(); f.document.rules.excludedTopics = ['negociação de dívida'];
    f.deps.chooseProcedure = vi.fn(async () => 'billing');
    const result = await f.send('Quero negociação de dívida e uma fatura');
    expect(result.response).toContain(f.document.understandStage.outOfScopeMessage);
    expect(result.state.events.at(-1)?.kind).toBe('policy_blocked');
    expect(f.deps.chooseProcedure).not.toHaveBeenCalled(); expect(f.deps.knowledge).not.toHaveBeenCalled(); expect(f.deps.execute).not.toHaveBeenCalled();
  });
  it('fails closed if an older published release contains a prohibited collection field', async () => {
    const f = fixture([{
      id: 'password', order: 1, type: 'collect_data', title: 'Senha',
      collectField: CollectedFieldDefinitionSchema.parse({ id: 'password', name: 'Senha', variableKey: 'password', type: 'text', promptMessage: 'Informe sua senha.' }),
    }]);
    const result = await f.send('fatura');
    expect(result.response).not.toContain('Informe sua senha'); expect(result.state.status).toBe('transferred');
    expect(f.deps.execute).not.toHaveBeenCalled();
  });
  it('never executes or transfers in suggestion mode', async () => {
    const f = fixture(); const result = await f.send(`fatura ${validCpf}`, 'suggest', true);
    expect(result.response).toContain('Próximo passo:'); expect(f.deps.execute).not.toHaveBeenCalled(); expect(f.deps.handoff).not.toHaveBeenCalled();
  });
  it('does not let model routing bypass a deterministic condition', async () => {
    const f = fixture([{ id: 'decision', order: 1, title: 'Decidir', type: 'decision', decisionBranches: [
      { id: 'guarded', conditionLabel: 'Autorizado', actionType: 'respond', actionValue: 'ACESSO', condition: { fieldKey: 'allowed', operator: 'equals', value: 'true' } },
      { id: 'model', conditionLabel: 'Outro assunto', actionType: 'respond', actionValue: 'OUTRO' },
      { id: 'fallback', conditionLabel: 'Sem permissão', isDefault: true, actionType: 'respond', actionValue: 'NEGADO' },
    ] }]);
    f.deps.decide = vi.fn(async () => 'guarded');
    const result = await f.send('fatura'); expect(result.response).toContain('NEGADO'); expect(result.response).not.toContain('ACESSO');
  });
  it('supports zero, false and array-count decisions', () => {
    const context = { values: { amount: 0, allowed: false, invoices: [] } };
    expect(evaluateStudioCondition({ fieldKey: 'amount', operator: 'exists' }, context)).toBe(true);
    expect(evaluateStudioCondition({ fieldKey: 'allowed', operator: 'equals', value: 'false' }, context)).toBe(true);
    expect(evaluateStudioCondition({ fieldKey: 'invoices', operator: 'count_equals', value: '0' }, context)).toBe(true);
  });
});
