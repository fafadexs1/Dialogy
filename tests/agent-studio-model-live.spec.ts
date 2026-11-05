import { afterAll, beforeAll, describe, expect, it, onTestFinished, vi } from 'vitest';
import { writeFileSync } from 'node:fs';
import type { AutopilotConfig } from '@/lib/types';
import { interpretStudioCollection } from '@/services/agent-studio/collection-interpreter';
import { interpretStudioTurn } from '@/services/agent-studio/turn-interpreter';
import { advanceStudioSession, createStudioSession } from '@/services/agent-studio/engine';
import { studioCollectionPlanningPrompt } from '@/services/agent-studio/collection-planner';
import { createDefaultAgentStudioDocument, ProcedureDocumentSchema, CollectedFieldDefinitionSchema, HttpRequestStepConfigSchema } from '@/services/agent-studio/types';

// The only replaced service is the usage writer. Model, credentials, prompt and provider are real.
vi.mock('@/actions/autopilot', () => ({ logAutopilotUsage: vi.fn().mockResolvedValue(undefined) }));
const enabled = Boolean(process.env.DIALOGY_STUDIO_LIVE_AGENT && process.env.DIALOGY_STUDIO_LIVE_WORKSPACE);
const cases = [
  { id: 'commerce-delivery', options: ['Retirada na loja', 'Entrega em casa'], message: 'prefiro receber na minha casa', kind: 'proposal', index: 1 },
  { id: 'hotel-balcony', options: ['Quarto simples', 'Quarto com varanda'], message: 'aquele que tem varanda', kind: 'proposal', index: 1 },
  { id: 'appointment-afternoon', options: ['Segunda às 09h', 'Terça às 14h'], message: 'prefiro o horário da tarde', kind: 'proposal', index: 1 },
  { id: 'software-support', options: ['Mensal', 'Anual + suporte prioritário'], message: 'aquele com atendimento prioritário', kind: 'proposal', index: 1 },
  { id: 'education-remote', options: ['Presencial', 'Online ao vivo'], message: 'quero assistir de casa', kind: 'proposal', index: 1 },
  { id: 'ambiguous-benefit', options: ['Essencial + suporte', 'Completo + suporte'], message: 'aquele com suporte', kind: 'unclear' },
  { id: 'conditional', options: ['Essencial — R$ 100', 'Completo — R$ 200'], message: 'só quero o completo se ficar por cem reais', kind: 'unclear' },
  { id: 'not-consent', options: ['Essencial', 'Completo'], message: 'o completo parece bom mas ainda não decidi', kind: 'unclear' },
  { id: 'indirect-question', options: ['Essencial', 'Completo + acompanhamento'], message: 'me conta mais sobre esse acompanhamento', kind: 'question' },
  { id: 'different-request', options: ['Essencial', 'Completo'], message: 'preciso consultar onde está minha encomenda', kind: 'different_request' },
  { id: 'price-reference', options: ['Essencial — R$ 100', 'Completo — R$ 200'], message: 'quero o mais barato', kind: 'proposal', index: 0 },
  { id: 'missing-antecedent', options: ['Essencial', 'Completo'], message: 'aquele que conversamos ontem', kind: 'unclear' },
  { id: 'text-response', options: [], fieldType: 'text', fieldName: 'Preferências de recebimento', prompt: 'Quais são suas preferências para receber?', message: 'Prefiro receber somente aos sábados pela manhã', kind: 'answer' },
  { id: 'number-doubt', options: [], fieldType: 'number', fieldName: 'Quantidade', prompt: 'Qual quantidade você precisa?', message: 'me explica como calcular essa quantidade', kind: 'question' },
  { id: 'date-response', options: [], fieldType: 'date', fieldName: 'Data', prompt: 'Para qual data deseja marcar?', message: 'Quero marcar para amanhã', kind: 'answer' },
] as const;

describe.skipIf(!enabled)('real published model, synthetic multi-domain evaluation', () => {
  let config: AutopilotConfig;
  let model: string;
  let generate: typeof import('@/ai/flows/procedure-runtime').generateProcedureRuntimeOutput;
  let pool: typeof import('@/lib/db').db;
  const samples: { id: string; ok: boolean; ms: number; result: string }[] = [];
  beforeAll(async () => {
    pool = (await import('@/lib/db')).db;
    const row = await pool.query('SELECT id,workspace_id,name,gemini_api_key FROM autopilot_configs WHERE id=$1 AND workspace_id=$2 AND is_active=true',
      [process.env.DIALOGY_STUDIO_LIVE_AGENT, process.env.DIALOGY_STUDIO_LIVE_WORKSPACE]);
    if (!row.rows[0]) throw new Error('Configured active agent not found in the specified workspace.');
    const release = await (await import('@/services/agent-studio/repository')).loadStudioRelease(row.rows[0].workspace_id, row.rows[0].id);
    if (!release?.runtimeConfig?.aiModel) throw new Error('No explicitly published model. Evaluation will not substitute another model.');
    model = release.runtimeConfig.aiModel;
    config = { ...row.rows[0], ai_model: model };
    generate = (await import('@/ai/flows/procedure-runtime')).generateProcedureRuntimeOutput;
    console.log(JSON.stringify({ evaluation: 'studio-synthetic-v1', model, releaseId: release.releaseId, businessWrites: false }));
  }, 30_000);
  it.each(['fresh', 'legacy'] as const)('production runtime continuity: %s survives reload', async (scenario) => {
    const { runStudioConversation } = await import('@/services/agent-studio/runtime');
    const { StudioSessionSchema } = await import('@/services/agent-studio/engine');
    const release = await (await import('@/services/agent-studio/repository')).loadStudioRelease(config.workspace_id!, config.id);
    if (!release) throw new Error('Published release missing');
    // This case intentionally exercises the real commercial release that failed.
    const planField = release.agentSnapshot.resolveStage.procedures.flatMap((p) => p.steps).find((s) => s.collectField?.variableKey === 'selected_plan')?.collectField;
    if (!planField?.options?.some((o) => o.includes('1000'))) throw new Error('This continuity case requires the published Velpro catalog.');
    let state: import('@/services/agent-studio/engine').StudioSession | null = null;
    let sequence = 0;
    const trace: unknown[] = [];
    const realQuery = pool.query.bind(pool);
    const telemetry = vi.spyOn(pool, 'query').mockImplementation(((query: string, ...args: unknown[]) => {
      if (/^\s*INSERT INTO rag_retrieval_logs/i.test(query)) return Promise.resolve({ rows: [], rowCount: 0 });
      return (realQuery as (...args: unknown[]) => unknown)(query, ...args);
    }) as typeof pool.query);
    onTestFinished(() => telemetry.mockRestore());
    const providerModule = await import('@/ai/flows/procedure-runtime');
    const realGenerate = providerModule.generateProcedureRuntimeOutput;
    const observer = vi.spyOn(providerModule, 'generateProcedureRuntimeOutput').mockImplementation(async (request) => {
      const result = await realGenerate(request);
      if (request.procedure?.prompt?.startsWith('Recupere apenas')) trace.push({ recovery: result });
      if (request.mode === 'decision') trace.push({ decision: result.decision });
      return result;
    });
    onTestFinished(() => observer.mockRestore());
    onTestFinished(() => {
      const evidence = { evaluation: 'production-runtime-continuity', scenario, model, releaseId: release.releaseId, trace };
      console.log(JSON.stringify(evidence));
      if (process.env.DIALOGY_STUDIO_CONTINUITY_EVIDENCE) writeFileSync(`${process.env.DIALOGY_STUDIO_CONTINUITY_EVIDENCE}-${scenario}.json`, JSON.stringify(evidence, null, 2));
    });
    const send = async (message: string) => {
      const result = await runStudioConversation({ release, config, chatId: 'synthetic-studio-continuity', messageId: `continuity-${++sequence}`,
        message, state, preview: { samples: {} }, testMode: true, signal: AbortSignal.timeout(120_000),
        contact: { id: 'synthetic-contact', name: '', phone: '5561999999999' } as import('@/lib/types').Contact,
        checkpoint: async (next) => { state = StudioSessionSchema.parse(JSON.parse(JSON.stringify(next))); },
        assertCurrent: async () => {},
        runNative: async () => { throw new Error('Unexpected effect in continuity test'); },
      });
      state = StudioSessionSchema.parse(JSON.parse(JSON.stringify(result.state)));
      trace.push({ customer: message, response: result.response, phase: state.phase, pending: state.pendingField, values: state.values });
      return result;
    };
    if (scenario === 'fresh') {
      await send('Quais planos vocês tem?');
      await send('Esse de 500 MEGA é bom?');
      await send('Não sei. Esse de 1000 é melhor?');
      const selected = await send('Acho que fico com o de 1000 que eu trabalho home office.');
      expect(selected.state.status).toBe('waiting_input');
      expect(selected.state.values.selected_plan).toContain('1000 MEGA');
      expect(selected.state.pendingField).not.toBe('selected_plan');
      expect(selected.response).not.toContain(release.agentSnapshot.concludeStage.successClosingMessage);
    } else {
      const contract = release.agentSnapshot.resolveStage.procedures.find((p) => p.steps.some((s) => s.collectField?.variableKey === 'selected_plan'))!;
      state = createStudioSession(config.id, release.releaseId, 'synthetic-legacy');
      Object.assign(state, { phase: 'resolve', procedureId: contract.id, stepIndex: 1, pendingField: 'selected_plan', activeIntent: 'Então, não vamos fechar?',
        conversationMemory: [
          { messageId: 'old-choice', customer: 'Acho que fico com o de 1000 que eu trabalho home office.', assistant: 'Até logo!' },
          { messageId: 'old-restart', customer: 'Então, não vamos fechar?', assistant: 'Qual é o seu nome completo?' },
          { messageId: 'old-name', customer: 'Ana de Sousa', assistant: 'Qual plano você deseja contratar?' },
        ], lastTurn: { messageId: 'old-name', response: 'Qual plano você deseja contratar?', outcome: 'waiting_input' } });
    }
    const named = await send(scenario === 'legacy' ? 'Vamos continuar' : 'Meu nome é Ana de Sousa.');
    expect(named.state.values.selected_plan).toContain('1000 MEGA');
    expect(named.state.values.lead_name).toBe('Ana de Sousa');
    expect(named.state.pendingField).not.toBe('selected_plan');
    expect(named.state.pendingField).not.toBe('lead_name');
    expect(named.state.status).toBe('waiting_input');
  }, 240_000);
  it.each([
    { id: 'delivery', name: 'Nome', location: 'Endereço', unknown: 'Código postal', message: 'Meu nome é Ana. Não sei o código postal, mas moro na Rua Azul, 12.', value: 'Rua Azul, 12' },
    { id: 'support', name: 'Área afetada', location: 'Descrição do problema', unknown: 'Quando começou', message: 'A área afetada é Agenda. Não sei quando começou, mas o problema é que o evento não salva.', value: 'evento' },
  ])('goal planning: $id with several facts and unknown data', async (sample) => {
    const document = createDefaultAgentStudioDocument('synthetic-agent', config.workspace_id);
    document.resolveStage.conversationMode = 'adaptive';
    document.resolveStage.procedures = [ProcedureDocumentSchema.parse({ id: 'request', name: 'Resolver solicitação', updatedAt: '2026-09-06',
      objective: `Registrar ${sample.name} e ${sample.location}, sem insistir em ${sample.unknown} se a pessoa não souber.`,
      steps: [['name', sample.name], ['unknown', sample.unknown], ['location', sample.location]].map(([key, label], index) => ({
        id: key, type: 'collect_data', order: index + 1, title: label,
        collectField: CollectedFieldDefinitionSchema.parse({ id: key, variableKey: key, name: label, type: 'text', promptMessage: `Qual ${label}?` }),
      })),
    })];
    const state = createStudioSession(document.id, 'synthetic-release', `synthetic-${sample.id}`);
    Object.assign(state, { phase: 'resolve', procedureId: 'request', pendingField: 'name', activeIntent: document.resolveStage.procedures[0].objective });
    const execute = vi.fn(), handoff = vi.fn();
    const result = await advanceStudioSession({ document, state, message: sample.message, messageId: 'synthetic-1',
      dependencies: { execute, handoff, knowledge: vi.fn().mockResolvedValue(null),
        planCollection: async (planning) => {
          const result = await generate({ config, model, fixedModel: true, chatId: 'synthetic-studio-evaluation', mode: 'collection_plan',
            customerMessage: planning.message, procedure: { name: 'Avaliação de planejamento por objetivo', prompt: studioCollectionPlanningPrompt(planning) } });
          console.log(JSON.stringify({ syntheticPlanningCase: sample.id, output: result }));
          return result.collectionPlan;
        },
      } });
    expect(result.state.values.name).toBeTruthy();
    expect(String(result.state.values.location)).toContain(sample.value);
    expect(result.state.unavailableFields?.['request:unknown']).toBeDefined();
    expect(result.state.values.unknown).toBeUndefined();
    expect(result.state.phase).toBe('conclude');
    expect(execute).not.toHaveBeenCalled(); expect(handoff).not.toHaveBeenCalled();
  }, 60_000);
  it.each(cases)('$id', async (sample) => {
    const started = Date.now();
    const result = await interpretStudioCollection({ fieldName: 'fieldName' in sample ? sample.fieldName : 'Escolha',
      prompt: 'prompt' in sample ? sample.prompt : 'Qual opção você prefere?',
      fieldType: 'fieldType' in sample ? sample.fieldType : undefined,
      options: [...sample.options], message: sample.message, lastAssistantMessage: 'prompt' in sample ? sample.prompt : sample.options.join('\n') }, async (prompt, choices) => {
      const output = await generate({ config, model, fixedModel: true, chatId: 'synthetic-studio-evaluation', mode: 'decision', customerMessage: sample.message,
        persona: 'Assistente de atendimento. Siga as regras e opções configuradas pela empresa.',
        procedure: { name: 'Avaliação de escolha', prompt, branchOptions: choices.map((choice) => ({ condition: choice.id, nextStepId: choice.id })) } });
      return output.decision || null;
    });
    const ok = result.kind === sample.kind && (!('index' in sample) || (result.kind === 'proposal' && result.label === sample.options[sample.index]));
    samples.push({ id: sample.id, ok, ms: Date.now() - started, result: result.kind });
    expect(result.kind).toBe(sample.kind);
    if ('index' in sample) expect(result).toMatchObject({ label: sample.options[sample.index] });
  }, 45_000);
  it('chooses a lookup to recover an unknown field through the shared runtime with real planning and a controlled tool result', async () => {
    onTestFinished(() => { vi.restoreAllMocks(); });
    const provider = await import('@/ai/flows/procedure-runtime');
    const realGenerate = provider.generateProcedureRuntimeOutput;
    vi.spyOn(provider, 'generateProcedureRuntimeOutput').mockImplementation(async (request) => {
      const output = await realGenerate(request);
      console.log(JSON.stringify({ syntheticCapabilityDecision: { mode: request.mode, output } }));
      return output;
    });
    const { runStudioConversation } = await import('@/services/agent-studio/runtime');
    const document = createDefaultAgentStudioDocument(config.id, config.workspace_id!);
    document.resolveStage.conversationMode = 'adaptive';
    document.resolveStage.procedures = [ProcedureDocumentSchema.parse({ id: 'location', name: 'Verificar localização',
      objective: 'Obter o código postal pelo endereço usando a consulta disponível quando o cliente não souber; apresentar o código verificado.', updatedAt: '2026-09-06', steps: [
        ...[['postal', 'Código postal'], ['address', 'Endereço']].map(([key, name], i) => ({ id: key, title: name, order: i + 1, type: 'collect_data',
          collectField: CollectedFieldDefinitionSchema.parse({ id: key, variableKey: key, name, type: key === 'postal' ? 'cep' : 'text', promptMessage: `Qual ${name}?` }) })),
        { id: 'lookup', order: 3, type: 'http_request', title: 'Consultar código postal pelo endereço',
          httpRequest: HttpRequestStepConfigSchema.parse({ name: 'Consulta de localização', method: 'GET', url: 'https://example.com/location',
            sentDataMappings: [{ apiField: 'address', sourceType: 'collected_field', sourceValue: 'address' }],
            outputMappings: [{ chipKey: 'postal', chipLabel: 'Código postal', jsonPath: 'postal' }] }) },
        { id: 'reply', order: 4, type: 'respond', title: 'Informar código', messageText: 'Código verificado:', messageDataKeys: ['postal'] },
      ] })];
    const state = createStudioSession(config.id, 'synthetic-capabilities', 'synthetic-capabilities');
    Object.assign(state, { phase: 'resolve', procedureId: 'location', pendingField: 'postal', activeIntent: 'Verificar localização' });
    const native = vi.fn();
    const result = await runStudioConversation({ config, state, chatId: 'synthetic-capabilities', messageId: '1',
      message: 'Não sei o código postal. Meu endereço é Rua Azul, 12.',
      release: { releaseId: 'synthetic-capabilities', agentId: config.id, workspaceId: config.workspace_id!, version: 1, agentSnapshot: document,
        publishedProcedures: document.resolveStage.procedures, referencedConnectionIds: [], mcpServerToolFingerprints: {},
        runtimeVersion: 'studio-v1', runtimeConfig: { aiModel: model }, createdAt: new Date().toISOString() },
      contact: { id: 'synthetic-contact', name: 'Cliente de teste', phone: '5561999999999' } as import('@/lib/types').Contact,
      preview: { samples: { lookup: '{"postal":"72800000"}' } }, checkpoint: async () => {}, assertCurrent: async () => {}, runNative: native,
    });
    console.log(JSON.stringify({ syntheticCapabilityRuntime: { response: result.response, values: result.state.values,
      selected: result.state.events.filter((e) => e.kind === 'adaptive_action_selected').map((e) => e.stepId) } }));
    expect(result.state.adaptiveCompletedSteps?.['location:lookup']).toBe(true);
    expect(result.state.values.postal).toBe('72800000');
    expect(result.state.unavailableFields?.['location:postal']).toBeUndefined();
    expect(result.response).toContain('Código verificado:\n72800000');
    expect(result.state.visits['location:lookup']).toBe(1); expect(native).not.toHaveBeenCalled();
  }, 60_000);
  it.each([
    { id: 'contact-reference', message: 'Esse mesmo que estou falando contigo', kind: 'contact_reference', field: 'phone', last: 'Qual telefone com DDD?' },
    { id: 'semantic-yes', message: 'positivo', kind: 'confirm', field: 'phone', last: 'Confirma seu telefone?', confirmation: true },
    { id: 'unknown-data', message: 'Não sei o código postal, me mudei recentemente', kind: 'unable', field: 'postal', last: 'Qual código postal?' },
    { id: 'keep-objective', message: 'Uai, vamos continuar', kind: 'continue', field: 'postal', last: 'Você pode conferir o código postal no comprovante de endereço.' },
    { id: 'accepted-transfer', message: 'Tá bom, encaminha', kind: 'handoff', field: 'postal', last: 'Posso encaminhar você para uma pessoa ajudar com esse dado.' },
    { id: 'conditional-consent', message: 'Só confirmo se não cobrar nada', kind: 'unclear', field: 'phone', last: 'Confirma seu telefone?', confirmation: true, notConfirm: true },
    { id: 'unknown-not-rejection', message: 'Não sei se esse é o telefone certo', kind: 'unable', field: 'phone', last: 'Confirma seu telefone?', confirmation: true },
  ])('interprets a contextual turn: $id', async (sample) => {
    const document = createDefaultAgentStudioDocument(config.id, config.workspace_id!);
    document.resolveStage.conversationMode = 'adaptive';
    const field = CollectedFieldDefinitionSchema.parse({ id: sample.field, name: sample.field === 'phone' ? 'Telefone' : 'Código postal',
      variableKey: sample.field, type: sample.field === 'phone' ? 'phone' : 'cep', promptMessage: sample.last });
    document.resolveStage.procedures = [ProcedureDocumentSchema.parse({ id: 'service', name: 'Contratar serviço', objective: 'Concluir a contratação solicitada', updatedAt: '2026-09-05',
      steps: [{ id: 'collect', title: 'Dados necessários', order: 1, type: 'collect_data', collectField: field }] })];
    const state = createStudioSession(config.id, 'synthetic-release', 'synthetic-session');
    Object.assign(state, { phase: 'resolve', procedureId: 'service', pendingField: sample.confirmation ? null : sample.field,
      activeIntent: 'Contratar o serviço escolhido', lastTurn: { messageId: 'previous', response: sample.last, outcome: 'waiting_input' } });
    if (sample.confirmation) state.confirmation = { key: 'field:service:collect', signature: '"5561999999999"', at: Date.now() };
    const result = await interpretStudioTurn({ document, state, message: sample.message, context: { values: {}, contact: { phone: '5561999999999' } } }, async (prompt, choices) => {
      const output = await generate({ config, model, fixedModel: true, chatId: 'synthetic-studio-evaluation', mode: 'decision', customerMessage: sample.message,
        persona: 'Assistente de atendimento. Siga as regras e opções configuradas pela empresa.',
        procedure: { name: 'Interpretação contextual', prompt, branchOptions: choices.map((choice) => ({ condition: choice.id, nextStepId: choice.id })) } });
      return output.decision || null;
    });
    if (sample.notConfirm) expect(result?.kind).not.toBe('confirm');
    else expect(result?.kind).toBe(sample.kind);
    expect(result).not.toBeNull();
  }, 45_000);
  it('does not rewrite a business identifier or infer pediatrics from a name', async () => {
    const result = await generate({ config, model, fixedModel: true, chatId: 'synthetic-studio-evaluation', mode: 'response', customerMessage: 'Qual o status do pedido?',
      persona: 'Roberta, atendente de uma loja de móveis.', procedure: { name: 'Consultar pedido', prompt: 'Fonte autorizada: pedido 193, status confirmado. Responda exatamente: Seu pedido 193 está confirmado.' } });
    expect(result.response).toContain('193'); expect(result.response).not.toMatch(/triagem|criança|pediatr|pronto atendimento/i);
  }, 45_000);
  it('executes the bounded history query against the configured workspace without exposing content', async () => {
    const source = await pool.query("SELECT id,chat_id FROM messages WHERE workspace_id=$1 AND from_me=false ORDER BY created_at DESC LIMIT 1", [config.workspace_id]);
    expect(source.rows.length).toBe(1);
    const history = await (await import('@/services/agent-studio/history')).loadStudioConversationHistory(config.workspace_id!, source.rows[0].chat_id, source.rows[0].id);
    expect(typeof history).toBe('string'); expect(history.length).toBeLessThanOrEqual(80 * 16010);
  }, 15_000);
  it('completes a contextual choice through the real shared runtime without business effects', async () => {
    const provider = await import('@/ai/flows/procedure-runtime');
    const realGenerate = provider.generateProcedureRuntimeOutput;
    vi.spyOn(provider, 'generateProcedureRuntimeOutput').mockImplementation(async (request) => {
      const output = await realGenerate(request);
      if (request.mode === 'collection_plan') console.log(JSON.stringify({ syntheticRuntimePlan: output }));
      return output;
    });
    const { createDefaultAgentStudioDocument, ProcedureDocumentSchema, CollectedFieldDefinitionSchema } = await import('@/services/agent-studio/types');
    const { runStudioConversation } = await import('@/services/agent-studio/runtime');
    const document = createDefaultAgentStudioDocument(config.id, config.workspace_id!);
    document.resolveStage.conversationMode = 'adaptive';
    document.concludeStage.handoffTeam = 'Support';
    document.resolveStage.procedures = [ProcedureDocumentSchema.parse({ id: 'service', name: 'Contratar serviço', triggerKeywords: ['contratar'], updatedAt: '2026-09-05', steps: [
      { id: 'choice', title: 'Modalidade', order: 1, type: 'collect_data', collectField: CollectedFieldDefinitionSchema.parse({ id: 'choice', name: 'Modalidade', variableKey: 'choice', type: 'single_select', promptMessage: 'Qual modalidade?', options: ['Essencial', 'Completo + acompanhamento'] }) },
      { id: 'phone', title: 'Telefone', order: 2, type: 'collect_data', collectField: CollectedFieldDefinitionSchema.parse({ id: 'phone', name: 'Telefone', variableKey: 'phone', type: 'phone', promptMessage: 'Qual telefone com DDD?', requiresConfirmation: true }) },
      { id: 'postal', title: 'Código postal', order: 3, type: 'collect_data', collectField: CollectedFieldDefinitionSchema.parse({ id: 'postal', name: 'Código postal', variableKey: 'postal', type: 'cep', promptMessage: 'Qual código postal?' }) },
    ] })];
    const release = { releaseId: 'synthetic-release', agentId: config.id, workspaceId: config.workspace_id!, version: 1, agentSnapshot: document,
      publishedProcedures: document.resolveStage.procedures, referencedConnectionIds: [], mcpServerToolFingerprints: {}, runtimeVersion: 'studio-v1' as const, runtimeConfig: { aiModel: model }, createdAt: new Date().toISOString() };
    let state: import('@/services/agent-studio/engine').StudioSession | null = null;
    const native = vi.fn(); let sequence = 0;
    const send = async (message: string) => {
      const result = await runStudioConversation({ release, config, state, chatId: 'synthetic-runtime-eval', messageId: String(++sequence), message,
        contact: { id: 'synthetic-contact', name: 'Cliente de teste', phone: '5561999999999' } as import('@/lib/types').Contact, preview: { samples: {} },
        checkpoint: async (next) => { state = next; }, assertCurrent: async () => {}, runNative: native });
      state = result.state;
      console.log(JSON.stringify({ syntheticTurn: sequence, message, response: result.response, meaning: state.events.filter((e) => e.kind === 'turn_interpreted').at(-1)?.label,
        pending: state.pendingField, proposal: state.collectionProposal?.label, status: state.status }));
      return result;
    };
    expect((await send('Quero contratar serviço')).state.pendingField).toBe('choice');
    expect((await send('Qual inclui acompanhamento?')).state.pendingField).toBe('choice');
    const proposed = await send('aquele com acompanhamento');
    expect(proposed.state.collectionProposal?.label).toBe('Completo + acompanhamento');
    expect(proposed.state.values.choice).toBeUndefined();
    const confirmed = await send('sim');
    expect(confirmed.state.values.choice).toBe('Completo + acompanhamento');
    // The model may ask either independent field first, or omit the nonessential
    // postal code. Test the conversational contract, not the former array order.
    let current = confirmed;
    for (let turn = 0; turn < 3 && current.state.phase === 'resolve'; turn++) {
      expect(['phone', 'postal']).toContain(current.state.pendingField);
      if (current.state.pendingField === 'phone') {
        const referenced = await send('Esse mesmo que estou falando contigo');
        expect(referenced.state.confirmation?.key).toBe('field:service:phone');
        current = await send('positivo');
      } else {
        current = await send('Não sei o código postal, me mudei recentemente');
        expect(current.state.unavailableFields?.['service:postal'].fieldKey).toBe('postal');
      }
    }
    expect(current.state.procedureId).toBe('service'); expect(current.state.pendingField).toBeNull();
    expect(current.state.values.phone).toBe('5561999999999');
    expect(current.state.valueOrigins?.phone.confirmed).toBe(true);
    expect(current.state.values.postal).toBeUndefined();
    expect(current.state.unavailableFields?.['service:postal'] || current.state.deferredFields?.['service:postal']).toBeDefined();
    expect(current.state.phase).toBe('conclude');
    expect(current.state.events.some((e) => e.kind === 'procedure_cancelled')).toBe(false);
    const transferred = await send('Tá bom, encaminha');
    expect(transferred.state.status).toBe('transferred'); // Preview only: no real assignment or delivery.
    expect(native).not.toHaveBeenCalled();
  }, 120_000);
  afterAll(async () => {
    vi.restoreAllMocks();
    if (samples.length) console.log(JSON.stringify({ model, evaluated: samples.length, passed: samples.filter((s) => s.ok).length, samples }));
    await pool?.end();
  });
});
