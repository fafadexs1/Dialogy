import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AutopilotConfig, Contact } from '@/lib/types';
import { createDefaultAgentStudioDocument, ProcedureDocumentSchema, type AgentReleaseManifest } from '@/services/agent-studio/types';
import { createStudioSession, StudioSessionSchema, type StudioSession, type StudioEngineDependencies } from '@/services/agent-studio/engine';
import type { StudioMemoryEvent } from '@/services/agent-studio/durable-memory';
const usage = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const memoryRead = vi.hoisted(() => vi.fn());
vi.mock('@/services/agent-studio/durable-memory-store', () => ({ readStudioDurableMemory: memoryRead }));
const decisions = vi.hoisted(() => [] as unknown[]);
vi.mock('@/services/ai/openai-compatible', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/ai/openai-compatible')>();
  return { ...actual, requestOpenAiCompatibleJson: async (input: Parameters<typeof actual.requestOpenAiCompatibleJson>[0]) => {
    const context = JSON.parse(input.userPrompt);
    const start = Date.now();
    try {
      const result = await actual.requestOpenAiCompatibleJson(input);
      decisions.push({ observations: context.observations, result, ms: Date.now() - start });
      return result;
    } catch (error) {
      decisions.push({ observations: context.observations, error: error instanceof Error ? error.message : String(error), ms: Date.now() - start });
      throw error;
    }
  } };
});
// Real model and real workspace credential resolution. Only accounting writes are captured locally.
vi.mock('@/actions/autopilot', () => ({ logAutopilotUsage: usage }));
const enabled = Boolean(process.env.DIALOGY_STUDIO_LIVE_AGENT && process.env.DIALOGY_STUDIO_LIVE_WORKSPACE);

describe.skipIf(!enabled)('reasoning v2 with a real configured model and synthetic integration samples', () => {
  let release: AgentReleaseManifest;
  let config: AutopilotConfig;
  let pool: typeof import('@/lib/db').db;
  const traces: unknown[] = [];
  beforeAll(async () => {
    pool = (await import('@/lib/db')).db;
    const result = await pool.query('SELECT id, workspace_id, name FROM autopilot_configs WHERE id=$1 AND workspace_id=$2 AND is_active=true',
      [process.env.DIALOGY_STUDIO_LIVE_AGENT, process.env.DIALOGY_STUDIO_LIVE_WORKSPACE]);
    if (!result.rows[0]) throw new Error('Agente ativo não encontrado no workspace solicitado.');
    config = result.rows[0] as AutopilotConfig;
    const published = await (await import('@/services/agent-studio/repository')).loadStudioRelease(config.workspace_id!, config.id);
    if (!published?.runtimeConfig?.aiModel) throw new Error('Modelo publicado não encontrado.');
    const document = createDefaultAgentStudioDocument(config.id, config.workspace_id);
    document.name = 'Atendente de teste';
    document.objective = 'Registrar o plano, a preferência de mesh e o endereço de instalação do cliente. Consultar o catálogo e esclarecer dúvidas. Não contratar nem cobrar.';
    document.resolveStage.conversationMode = 'adaptive';
    document.resolveStage.reasoning = { enabled: true, effort: 'medium', supportModel: null, maxDecisions: 8, maxTurnMs: 180_000 };
    document.resolveStage.procedures = [ProcedureDocumentSchema.parse({ id: 'contract', name: 'Preparar instalação', updatedAt: new Date().toISOString(),
      objective: 'Consultar o catálogo; guardar plano, preferência de mesh e endereço. Enquanto faltar o endereço, manter o pedido aberto. Mesh é uma opção de cobertura, não é obrigatório.',
      steps: [
        { id: 'catalog', order: 1, title: 'Consultar catálogo de planos', type: 'http_request', adaptiveAccess: { enabled: true, requiresSteps: [] },
          httpRequest: { name: 'Catálogo', method: 'GET', url: 'https://simulation.example/catalog', outputMappings: [{ chipKey: 'catalog', chipLabel: 'Planos disponíveis', jsonPath: 'plans' }] } },
        { id: 'plan', order: 2, title: 'Plano', type: 'collect_data', collectField: { id: 'plan', variableKey: 'plan', name: 'Plano escolhido', type: 'single_select', promptMessage: 'Qual plano?', optionsSourceKey: 'catalog', optionLabelPath: 'name', optionValuePath: 'id' } },
        { id: 'mesh', order: 3, title: 'Mesh', type: 'collect_data', collectField: { id: 'mesh', variableKey: 'mesh', name: 'Preferência de mesh', type: 'single_select', promptMessage: 'Deseja mesh?', options: ['Com mesh', 'Sem mesh'] } },
        { id: 'address', order: 4, title: 'Endereço', type: 'collect_data', collectField: { id: 'address', variableKey: 'address', name: 'Endereço de instalação', type: 'text', promptMessage: 'Qual o endereço?' } },
      ] })];
    release = { ...published, agentSnapshot: document, publishedProcedures: document.resolveStage.procedures,
      referencedConnectionIds: [], connectionFingerprints: {}, mcpServerToolFingerprints: {}, knowledgeSnapshot: [] };
  }, 30_000);
  afterAll(async () => {
    if (process.env.DIALOGY_REASONING_EVIDENCE_DIR) {
      mkdirSync(process.env.DIALOGY_REASONING_EVIDENCE_DIR, { recursive: true });
      writeFileSync(join(process.env.DIALOGY_REASONING_EVIDENCE_DIR, 'reasoning-model-live.json'), JSON.stringify({
        at: new Date().toISOString(), model: release?.runtimeConfig?.aiModel, publishedReleaseId: release?.releaseId,
        scope: 'real model; synthetic conversation, memory and integration responses; no publication or customer effects', traces, decisions,
        usage: usage.mock.calls.map(([entry]) => entry),
      }, null, 2));
    }
    await pool?.end();
  });
  it('keeps a mixed choice/question and resumes the same selections after another turn', async () => {
    const run = (await import('@/services/agent-studio/runtime')).runStudioConversation;
    let state: StudioSession | null = null;
    const effects = vi.fn(async () => { throw new Error('Unexpected business effect'); });
    let seq = 0;
    const send = async (message: string) => {
      const start = Date.now();
      const result = await run({ release, config, state, message, messageId: `synthetic-${++seq}`, chatId: 'synthetic-reasoning',
        contact: { id: 'synthetic-contact', name: 'Cliente de teste', phone: '' } as Contact,
        preview: { samples: { catalog: JSON.stringify({ plans: [{ id: 42, name: '700 MEGA' }, { id: 77, name: '1000 MEGA' }] }) } },
        testMode: true, checkpoint: async (next) => { state = StudioSessionSchema.parse(JSON.parse(JSON.stringify(next))); },
        assertCurrent: async () => {}, runNative: effects,
      });
      state = StudioSessionSchema.parse(JSON.parse(JSON.stringify(result.state)));
      traces.push({ message, response: result.response, ms: Date.now() - start, reasoning: state.reasoning, status: state.status });
      return result;
    };
    const first = await send('Quero o de 700 e sem mesh. Dá pra continuar a instalação assim?');
    expect(first.state.reasoning?.requests.some((r) => r.values.plan === 42 && r.values.mesh === 'Sem mesh')).toBe(true);
    expect(first.state.status).toBe('waiting_input');
    const next = await send('Vamos continuar aquela instalação que eu escolhi.');
    expect(next.state.reasoning?.requests.some((r) => r.values.plan === 42 && r.values.mesh === 'Sem mesh')).toBe(true);
    expect(next.state.status).toBe('waiting_input');
    const refreshed = await send('Consulte o catálogo novamente agora e confira se meu plano continua disponível. Mantenha minhas escolhas.');
    expect(refreshed.state.reasoning?.operations.filter((operation) => operation.capabilityId === 'contract:catalog' && operation.status === 'succeeded').length).toBeGreaterThanOrEqual(2);
    expect(refreshed.state.reasoning?.requests.some((request) => request.values.plan === 42 && request.values.mesh === 'Sem mesh')).toBe(true);
    expect(effects).not.toHaveBeenCalled();
  }, 420_000);

  it('selects the requested dress from the catalog and calls its photo tool without extra consent', async () => {
    const tested = structuredClone(release);
    tested.agentSnapshot.objective = 'Ajudar o cliente a encontrar vestidos e mostrar a foto real do produto solicitado. Não comprar nem cobrar.';
    tested.agentSnapshot.resolveStage.procedures = [ProcedureDocumentSchema.parse({ id: 'shop', name: 'Mostrar vestidos', updatedAt: '2026-09-08', objective: 'Consultar catálogo, registrar o vestido solicitado e mostrar sua foto.', steps: [
      { id: 'catalog', order: 1, title: 'Consultar vestidos', type: 'http_request', adaptiveAccess: { enabled: true, requiresSteps: [] }, httpRequest: { name: 'Catálogo', method: 'GET', url: 'https://simulation.example/dresses', outputMappings: [{ chipKey: 'products', chipLabel: 'Vestidos', jsonPath: 'products' }] } },
      { id: 'product', order: 2, title: 'Vestido solicitado', type: 'collect_data', collectField: { id: 'product', variableKey: 'product', name: 'Vestido', type: 'single_select', promptMessage: 'Qual vestido?', optionsSourceKey: 'products', optionLabelPath: 'name', optionValuePath: 'id' } },
      { id: 'photo', order: 3, title: 'Mostrar foto do vestido solicitado', type: 'native_action', nativeActionType: 'show_catalog_image', adaptiveAccess: { enabled: true, requiresSteps: ['catalog'] },
        nativeDataMappings: [{ apiField: 'productId', sourceType: 'collected_field', sourceValue: 'product' }],
        nativeActionPayload: { catalogKey: 'products', productIdPath: 'id', titlePath: 'name', imagePath: 'image', allowedHosts: ['images.store.example'] } },
    ] })];
    tested.publishedProcedures = tested.agentSnapshot.resolveStage.procedures;
    memoryRead.mockResolvedValue({ records: [], nextCursor: null });
    const products = [{ id: 'blue', name: 'Vestido azul', image: 'https://images.store.example/blue.jpg' }, { id: 'red', name: 'Vestido vermelho', image: 'https://images.store.example/red.jpg' }];
    const photos: unknown[] = [];
    const { resolveStudioCatalogImage, StudioCatalogImageSchema } = await import('@/services/agent-studio/catalog-media');
    const execute = vi.fn(async (step, context) => {
      if (step.id === 'catalog') return { values: { products } };
      if (step.id !== 'photo') throw new Error('Unexpected business effect');
      const image = resolveStudioCatalogImage(StudioCatalogImageSchema.parse(step.nativeActionPayload), context.values.product, { products });
      photos.push(image);
      return { presentedProduct: image };
    });
    const handoff = vi.fn(async () => { throw new Error('Unexpected handoff'); });
    // This controlled conversation has no previous sessions or production effects.
    const operationHistory = { priorRequestOperations: async () => [], recallSessionOperations: async () => null };
    const run = (await import('@/services/agent-studio/reasoning-runtime')).runStudioReasoningRuntime;
    const started = Date.now();
    const result = await run({ release: tested, config, message: 'Quero ver a foto do vestido azul.', messageId: 'synthetic-dress', chatId: 'synthetic-reasoning',
      contact: { id: 'synthetic-contact', name: 'Cliente', phone: '' } as Contact, testMode: true, signal: AbortSignal.timeout(180_000),
      operationHistory,
      checkpoint: async () => {}, assertCurrent: async () => {}, runNative: async () => { throw new Error('Unexpected effect'); } },
    createStudioSession(config.id, tested.releaseId, 'synthetic-dress-session'), { execute, handoff, knowledge: async () => 'Sem outras fontes', assertActive: () => {} } as unknown as StudioEngineDependencies, []);
    traces.push({ scenario: 'dress-photo', response: result.response, ms: Date.now() - started, reasoning: result.state.reasoning, photos });
    expect(photos).toEqual([expect.objectContaining({ productId: 'blue', url: 'https://images.store.example/blue.jpg' })]);
    expect(result.state.reasoning?.pendingAction).toBeNull();
    const resumedAt = Date.now();
    const resumed = await run({ release: tested, config, message: 'Vamos continuar com aquele vestido que você mostrou. Qual era a cor mesmo? Não precisa mandar a foto novamente.', messageId: 'synthetic-dress-resume', chatId: 'synthetic-reasoning',
      contact: { id: 'synthetic-contact', name: 'Cliente', phone: '' } as Contact, testMode: true, signal: AbortSignal.timeout(180_000),
      operationHistory,
      checkpoint: async () => {}, assertCurrent: async () => {}, runNative: async () => { throw new Error('Unexpected effect'); } },
    StudioSessionSchema.parse(JSON.parse(JSON.stringify(result.state))), { execute, handoff, knowledge: async () => 'Sem outras fontes', assertActive: () => {} } as unknown as StudioEngineDependencies, []);
    traces.push({ scenario: 'dress-photo-resume', response: resumed.response, ms: Date.now() - resumedAt, reasoning: resumed.state.reasoning, photos: [...photos] });
    expect(resumed.response.toLowerCase()).toContain('azul');
    expect(resumed.state.reasoning?.requests.some((request) => request.values.product === 'blue')).toBe(true);
    expect(photos).toHaveLength(1);
    expect(handoff).not.toHaveBeenCalled();
  }, 240_000);
  it('checks commercial eligibility and concludes with the published denial without a write or handoff', async () => {
    const tested = structuredClone(release);
    tested.agentSnapshot.objective = 'Verificar se o cliente pode contratar a oferta e responder conforme o resultado da consulta.';
    tested.agentSnapshot.resolveStage.procedures = [ProcedureDocumentSchema.parse({ id: 'offer', name: 'Consultar oferta', updatedAt: '2026-09-08', objective: 'Consultar elegibilidade antes de responder se a oferta está disponível.', steps: [
      { id: 'eligibility', order: 1, title: 'Consultar elegibilidade', type: 'http_request', adaptiveAccess: { enabled: true, requiresSteps: [] }, httpRequest: { name: 'Elegibilidade', method: 'GET', url: 'https://simulation.example/eligibility', outputMappings: [{ chipKey: 'eligible', chipLabel: 'Elegível', jsonPath: 'eligible' }] } },
      { id: 'condition', order: 2, title: 'Disponibilidade da oferta', type: 'decision', decisionBranches: [
        { id: 'available', conditionLabel: 'Oferta disponível', condition: { fieldKey: 'eligible', operator: 'equals', value: 'true' }, actionType: 'continue', nextStepId: 'activate' },
        { id: 'unavailable', conditionLabel: 'Caso contrário', isDefault: true, actionType: 'respond', actionValue: 'Esta oferta não está disponível para este contrato.' },
      ] },
      { id: 'activate', order: 3, title: 'Ativar oferta', type: 'http_request', adaptiveAccess: { enabled: true, requiresSteps: ['eligibility'] }, httpRequest: { name: 'Ativar', method: 'POST', url: 'https://simulation.example/activate' } },
    ] })];
    tested.publishedProcedures = tested.agentSnapshot.resolveStage.procedures;
    memoryRead.mockResolvedValue({ records: [], nextCursor: null });
    const execute = vi.fn(async (step) => { if (step.id !== 'eligibility') throw new Error('Unexpected write'); return { values: { eligible: false } }; });
    const handoff = vi.fn(async () => { throw new Error('Unexpected handoff'); });
    const run = (await import('@/services/agent-studio/reasoning-runtime')).runStudioReasoningRuntime;
    const started = Date.now();
    const result = await run({ release: tested, config, message: 'Confira se essa oferta está disponível para mim e me diga o resultado.', messageId: 'synthetic-eligibility', chatId: 'synthetic-reasoning',
      contact: { id: 'synthetic-contact', name: 'Cliente', phone: '' } as Contact, testMode: true, signal: AbortSignal.timeout(180_000),
      checkpoint: async () => {}, assertCurrent: async () => {}, runNative: async () => { throw new Error('Unexpected effect'); } },
    createStudioSession(config.id, tested.releaseId, 'synthetic-eligibility-session'), { execute, handoff, knowledge: async () => 'Sem outras fontes', assertActive: () => {} } as unknown as StudioEngineDependencies, []);
    traces.push({ scenario: 'commercial-eligibility', response: result.response, ms: Date.now() - started, reasoning: result.state.reasoning });
    expect(execute).toHaveBeenCalled();
    expect(execute.mock.calls.every(([step]) => step.id === 'eligibility')).toBe(true);
    expect(result.response).toContain('Esta oferta não está disponível para este contrato.');
    expect(handoff).not.toHaveBeenCalled();
  }, 240_000);
  it.each([1, 2, 3])('uses paginated memory from an older session without an original message or stale consent, run %s', async (runIndex) => {
    memoryRead.mockClear();
    const run = (await import('@/services/agent-studio/reasoning-runtime')).runStudioReasoningRuntime;
    const oldChoice = (key: string, value: string, quote: string): StudioMemoryEvent => ({ version: 1, requestId: 'older-session:installation', kind: 'choice', key,
      label: key, value, status: 'active', sensitive: false, source: { sessionId: 'older-session', releaseId: 'older-release', procedureId: 'contract',
        messageId: 'old-customer-message', quote, at: '2026-01-01T00:00:00.000Z' } });
    memoryRead.mockImplementation(async (_scope, options) => options?.cursor === '41' ? { records: [
      { sequence: '2', eventId: 'old-plan', event: oldChoice('plan','700 MEGA','Quero o plano 700 MEGA') },
      { sequence: '1', eventId: 'old-mesh', event: oldChoice('mesh','Sem mesh','sem mesh') },
    ], nextCursor: null } : { records: [], nextCursor: '41' });
    const journal: StudioMemoryEvent[] = [];
    const execute = vi.fn(async (step) => {
      if (step.id !== 'catalog') throw new Error('Unexpected business effect');
      return { values: { catalog: [{ id: 42, name: '700 MEGA' }, { id: 77, name: '1000 MEGA' }] } };
    });
    const handoff = vi.fn(async () => { throw new Error('Unexpected handoff'); });
    const input = { release, config, message: 'Quero continuar aquela instalação. Já escolhi o plano e o mesh lá atrás.', messageId: 'synthetic-resume', chatId: 'synthetic-reasoning',
      contact: { id: 'synthetic-contact', name: 'Cliente de teste', phone: '' } as Contact,
      runNative: async () => { throw new Error('Unexpected business effect'); },
      testMode: true, signal: AbortSignal.timeout(180_000), checkpoint: async (_next: StudioSession, events: StudioMemoryEvent[] = []) => { journal.push(...events); }, assertCurrent: async () => {} };
    const started = Date.now();
    const result = await run(input, createStudioSession(config.id, release.releaseId, 'synthetic-new-session'), {
      execute, handoff, knowledge: async () => 'Nenhuma fonte disponível', assertActive: () => {},
    } as unknown as StudioEngineDependencies, []);
    traces.push({ scenario: 'older-session-memory', runIndex, response: result.response, ms: Date.now() - started, reasoning: result.state.reasoning, journal });
    expect(memoryRead.mock.calls.some(([, options]) => options?.cursor === '41')).toBe(true);
    expect(result.state.reasoning?.requests.some((request) => request.values.plan === 42 && request.values.mesh === 'Sem mesh')).toBe(true);
    expect(journal.some((event) => event.kind === 'choice' && event.source.messageId === 'old-customer-message')).toBe(true);
    expect(journal.filter((event) => event.kind === 'choice').every((event) => event.requestId === 'older-session:installation')).toBe(true);
    expect(result.state.reasoning?.pendingAction).toBeNull();
    expect(handoff).not.toHaveBeenCalled();
    expect(execute.mock.calls.every(([step]) => step.id === 'catalog')).toBe(true);
  }, 240_000);
});
