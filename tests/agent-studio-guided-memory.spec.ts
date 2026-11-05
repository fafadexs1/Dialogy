import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AutopilotConfig, Contact } from '@/lib/types';
import { createDefaultAgentStudioDocument, ProcedureDocumentSchema, CollectedFieldDefinitionSchema, HttpRequestStepConfigSchema, type AgentReleaseManifest } from '@/services/agent-studio/types';
import type { StudioSession } from '@/services/agent-studio/engine';
import { suspendStudioProcedure, restoreStudioProcedure } from '@/services/agent-studio/suspension';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  model: vi.fn(),
  rag: vi.fn(),
  http: vi.fn(),
  mcp: vi.fn(),
  resolveMcp: vi.fn(),
  contactAction: vi.fn(),
  memory: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ db: { query: mocks.query } }));
vi.mock('@/ai/flows/procedure-runtime', () => ({ generateProcedureRuntimeOutput: mocks.model }));
vi.mock('@/services/rag/hybrid-retrieval', () => ({ retrieveHybridSupportContext: mocks.rag }));
vi.mock('@/services/agent-studio/integrations', () => ({ executeStudioHttp: mocks.http, executeStudioMcp: mocks.mcp, resolveStudioMcpTool: mocks.resolveMcp }));
vi.mock('@/services/agent-studio/native-actions', () => ({ executeStudioContactAction: mocks.contactAction }));
vi.mock('@/services/agent-studio/durable-memory-store', () => ({ readStudioDurableMemory: mocks.memory }));

import { runStudioConversation, type StudioRuntimeInput } from '@/services/agent-studio/runtime';

function fixtureGuided() {
  const document = createDefaultAgentStudioDocument('agent', 'workspace');
  document.resolveStage.conversationMode = 'guided'; // Strictly guided mode
  document.concludeStage.handoffTeam = 'Support';
  document.resolveStage.procedures = [
    ProcedureDocumentSchema.parse({
      id: 'support',
      name: 'Suporte Técnico',
      whenToUse: 'Problemas de conexão ou suporte',
      whenNotToUse: 'Cancelamento',
      updatedAt: '2026-09-18',
      steps: [
        {
          id: 'step_service',
          order: 1,
          title: 'Serviço',
          type: 'collect_data',
          collectField: CollectedFieldDefinitionSchema.parse({
            id: 'service',
            name: 'Serviço',
            variableKey: 'service',
            type: 'single_select',
            promptMessage: 'Qual serviço você deseja atendimento?',
            options: ['Internet Fibra', 'Telefonia Móvel'],
          }),
        },
        {
          id: 'step_cpf',
          order: 2,
          title: 'CPF',
          type: 'collect_data',
          collectField: CollectedFieldDefinitionSchema.parse({
            id: 'cpf',
            name: 'CPF',
            variableKey: 'cpf',
            type: 'cpf',
            promptMessage: 'Qual seu CPF?',
          }),
        },
        {
          id: 'step_obs',
          order: 3,
          title: 'Observação',
          type: 'collect_data',
          collectField: CollectedFieldDefinitionSchema.parse({
            id: 'obs',
            name: 'Observação',
            variableKey: 'obs',
            type: 'text',
            promptMessage: 'Descreva brevemente o problema.',
          }),
        },
        {
          id: 'step_reply',
          order: 4,
          title: 'Finalizar',
          type: 'message',
          messageText: 'Recebemos sua solicitação com sucesso.',
        },
      ],
    }),
  ];

  const release: AgentReleaseManifest = {
    agentId: document.id,
    workspaceId: document.workspaceId,
    releaseId: 'release-guided-v1',
    version: 1,
    agentSnapshot: document,
    publishedProcedures: document.resolveStage.procedures,
    referencedConnectionIds: [],
    connectionFingerprints: {},
    mcpServerToolFingerprints: {},
    runtimeVersion: 'studio-v1',
    runtimeConfig: { aiModel: 'published-model' },
    createdAt: '2026-09-18',
  };

  const config = {
    id: 'agent',
    workspace_id: 'workspace',
    ai_model: 'published-model',
  } as AutopilotConfig;

  let state: StudioSession | null = null;
  let messageCounter = 0;
  const native = vi.fn(async () => {});
  const assertCurrent = vi.fn(async () => {});
  const checkpoint = vi.fn(async (next: StudioSession) => { state = next; });

  const send = (message: string, signal?: AbortSignal, messageId = String(++messageCounter), overrides: Partial<StudioRuntimeInput> = {}) =>
    runStudioConversation({
      release,
      config,
      state,
      chatId: 'chat-guided-1',
      contact: { id: 'contact-1', name: 'Cliente Teste' } as Contact,
      messageId,
      message,
      signal,
      checkpoint,
      runNative: native,
      assertCurrent,
      ...overrides,
    });

  return { release, config, send, native, assertCurrent, checkpoint, get state() { return state; } };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.query.mockResolvedValue({ rows: [] });
  mocks.memory.mockResolvedValue({ records: [], nextCursor: null });
  mocks.rag.mockImplementation(async ({ staticDocuments }) => ({ knowledgeBaseDocuments: staticDocuments }));
  mocks.model.mockResolvedValue({ decision: 'support' });
});

describe('Guided Mode memory resilience and fact recovery', () => {
  it('recovers previously supplied CPF in history and advances to the next step without asking for CPF again', async () => {
    const f = fixtureGuided();
    mocks.model.mockImplementation(async (req) => {
      if (req.mode === 'decision') return { decision: 'support' };
      return {};
    });

    // Turn 1: customer asks for support
    const first = await f.send('Quero suporte');
    expect(first.response).toContain('Qual serviço você deseja atendimento?');

    // Turn 2: customer specifies service AND supplies their CPF in the same message
    const second = await f.send('Quero Internet Fibra. Meu CPF é 529.982.247-25');
    
    // In guided mode, step 1 (service) accepted 'Internet Fibra'.
    // Step 2 (cpf) recognized CPF from the message.
    // Guided Mode advances past CPF automatically and asks for step 3 (obs)!
    expect(second.state.values.service).toBe('Internet Fibra');
    expect(second.state.values.cpf).toBe('52998224725');
    expect(second.response).toContain('Descreva brevemente o problema.');
    expect(second.response).not.toContain('Qual seu CPF?');
  });

  it('preloads durable memory from previous sessions into Guided Mode state', async () => {
    const f = fixtureGuided();
    mocks.memory.mockResolvedValue({
      records: [
        {
          sequence: '1',
          eventId: 'evt-1',
          event: {
            requestId: 'req-1',
            status: 'resolved',
            kind: 'fact',
            key: 'cpf',
            value: '52998224725',
            label: 'CPF',
            sensitive: false,
            source: { agentId: 'agent', chatId: 'chat-guided-1', turn: 1, at: new Date().toISOString() },
          },
        },
      ],
      nextCursor: null,
    });

    // Turn 1: customer triggers procedure without mentioning CPF
    const result = await f.send('Quero suporte');
    
    // Durable memory preloaded CPF into state.values and state.sessionFacts
    expect(result.state.values.cpf).toBe('52998224725');
    expect(result.state.sessionFacts?.cpf?.value).toBe('52998224725');
    // Still asks for service because service is the pending field not in durable memory
    expect(result.response).toContain('Qual serviço você deseja atendimento?');

    // Customer answers service
    const second = await f.send('Internet Fibra');
    // Because CPF was in durable memory, it advances past CPF directly to obs
    expect(second.state.values.service).toBe('Internet Fibra');
    expect(second.response).toContain('Descreva brevemente o problema.');
    expect(second.response).not.toContain('Qual seu CPF?');
  });

  it('preserves collected and recovered facts when a procedure is suspended and resumed in Guided Mode', () => {
    const f = fixtureGuided();
    const doc = f.release.agentSnapshot;
    const now = Date.now();

    const session: StudioSession = {
      id: 'session-1',
      agentId: doc.id,
      releaseId: f.release.releaseId,
      phase: 'resolve',
      status: 'waiting_input',
      procedureId: 'support',
      stepIndex: 1,
      pendingField: 'cpf',
      confirmation: null,
      inFlight: null,
      values: {
        service: 'Internet Fibra',
        obs: 'Lentidão à noite',
      },
      valueOrigins: {},
      sessionFacts: {
        service: {
          value: 'Internet Fibra',
          fieldType: 'single_select',
          labels: ['Serviço'],
          source: 'customer',
          confirmed: true,
          isSensitive: false,
          at: new Date(now).toISOString(),
        },
        obs: {
          value: 'Lentidão à noite',
          fieldType: 'text',
          labels: ['Observação'],
          source: 'customer',
          confirmed: true,
          isSensitive: false,
          at: new Date(now).toISOString(),
        },
      },
      visits: {},
      attempts: {},
      events: [],
      turnCount: 1,
      conversationMemory: [],
      processedMessageIds: [],
    };

    // Suspend procedure
    suspendStudioProcedure(doc, session, now);
    expect(session.suspendedProcedures).toHaveLength(1);
    expect(session.suspendedProcedures![0].values).toMatchObject({
      service: 'Internet Fibra',
      obs: 'Lentidão à noite',
    });

    // Clear values to simulate fresh continuation
    session.values = {};
    session.procedureId = null;

    // Restore procedure
    const restored = restoreStudioProcedure(doc, session, 'support', now);
    expect(restored).toBe(true);
    expect(session.procedureId).toBe('support');
    expect(session.values.service).toBe('Internet Fibra');
    expect(session.values.obs).toBe('Lentidão à noite');
    expect(session.sessionFacts?.service?.value).toBe('Internet Fibra');
    expect(session.sessionFacts?.obs?.value).toBe('Lentidão à noite');
  });
});
