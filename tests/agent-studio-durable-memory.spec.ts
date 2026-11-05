import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
const bridge = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { query: bridge.query } }));
import { createStudioSession } from '@/services/agent-studio/engine';
import { studioSessionStore } from '@/services/agent-studio/session-store';
import { readStudioDurableMemory, openStudioMemoryEvent, sealStudioMemoryEvent } from '@/services/agent-studio/durable-memory-store';
import { studioMemoryContext, type StudioMemoryEvent } from '@/services/agent-studio/durable-memory';
import { advanceStudioReasoningSession } from '@/services/agent-studio/reasoning-engine';
import { createDefaultAgentStudioDocument, ProcedureDocumentSchema } from '@/services/agent-studio/types';

const workspaceId = '00000000-0000-4000-8000-000000000001';
const agentId = '00000000-0000-4000-8000-000000000002';
const chatId = '00000000-0000-4000-8000-000000000003';
const releaseId = '00000000-0000-4000-8000-000000000004';
const sessionId = '00000000-0000-4000-8000-000000000005';
const otherChatId = '00000000-0000-4000-8000-000000000006';
const scope = { workspaceId, agentId, chatId };
const choice = (value: unknown = '700 mega sem mesh', overrides: Partial<StudioMemoryEvent> = {}): StudioMemoryEvent => ({
  version: 1, requestId: 'contract-one', kind: 'choice', key: 'plan', label: 'Plano', value,
  status: 'active', sensitive: false, source: { sessionId, releaseId, procedureId: 'contract', messageId: 'choice-message',
    quote: 'Quero 700 mega sem mesh', at: '2026-09-08T12:00:00.000Z' }, ...overrides,
});
let sql: PGlite;
beforeAll(async () => {
  sql = new PGlite();
  bridge.query.mockImplementation((query: string, params?: unknown[]) => sql.query(query, params));
  await sql.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE workspaces(id uuid PRIMARY KEY);
    CREATE TABLE autopilot_configs(id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id));
    CREATE TABLE chats(id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id));
    CREATE TABLE autopilot_conversation_states(chat_id uuid PRIMARY KEY REFERENCES chats(id), workspace_id uuid NOT NULL,
      autopilot_config_id uuid, metadata jsonb, updated_at timestamptz);
    CREATE TABLE agent_studio_sessions(id uuid PRIMARY KEY, workspace_id uuid, agent_id uuid, chat_id uuid,
      release_id uuid, status text, completed_at timestamptz, summary jsonb, updated_at timestamptz);`);
  await sql.exec(await readFile('prisma/migrations/20260908140000_agent_studio_durable_memory/migration.sql', 'utf8'));
  await sql.query('INSERT INTO workspaces VALUES ($1)', [workspaceId]);
  await sql.query('INSERT INTO autopilot_configs VALUES ($1,$2)', [agentId, workspaceId]);
  await sql.query('INSERT INTO chats VALUES ($1,$2),($3,$2)', [chatId, workspaceId, otherChatId]);
}, 30_000);
beforeEach(async () => {
  vi.stubEnv('WORKSPACE_CREDENTIALS_ENCRYPTION_KEY', 'isolated-memory-key-with-32-characters');
  await sql.exec('TRUNCATE agent_studio_memory_events, autopilot_conversation_states, agent_studio_sessions');
});
afterAll(async () => { vi.unstubAllEnvs(); await sql?.close(); });

describe('durable choices with the real checkpoint SQL and encryption', () => {
  it('connects the reasoning loop to persisted choices across a real database reload', async () => {
    const document = createDefaultAgentStudioDocument(agentId, workspaceId);
    document.resolveStage.procedures = [ProcedureDocumentSchema.parse({ id: 'contract', name: 'Contratação', updatedAt: '2026-09-08', steps: [] })];
    const store = await studioSessionStore(scope);
    const decide = vi.fn().mockResolvedValue({ requests: [{ id: 'contract', procedureId: 'contract', objective: 'Contratar', status: 'paused' }],
      choices: [{ requestId: 'contract', key: 'mesh', label: 'Mesh', value: 'sem mesh', status: 'active', sourceMessageId: 'first', quote: 'sem mesh' }],
      action: { kind: 'respond', requestId: null, capabilityId: null, query: null, response: 'Guardei sua preferência.', consent: 'none', consentQuote: null, reason: '' } });
    const dependencies = { decide, checkpoint: store.checkpoint, execute: vi.fn(), handoff: vi.fn(), knowledge: vi.fn(),
      recall: (cursor: string | null) => readStudioDurableMemory(scope, { cursor }) };
    let progress = await advanceStudioReasoningSession({ document, state: createStudioSession(agentId, releaseId, sessionId), messageId: 'first',
      message: 'Quero sem mesh', context: {}, sources: [], memory: await readStudioDurableMemory(scope), dependencies });
    const reloaded = await studioSessionStore(scope);
    expect(reloaded.state?.reasoning?.requests[0].values.mesh).toBe('sem mesh');
    const memory = await readStudioDurableMemory(scope);
    expect(memory.records.some(({ event }) => event.kind === 'choice' && event.value === 'sem mesh')).toBe(true);
    expect(decide).toHaveBeenCalledTimes(1);
    expect(dependencies.execute).not.toHaveBeenCalled();
    for (let i = 0; i < 21; i++) {
      decide.mockResolvedValue({ requests: [{ id: `request-${i}`, procedureId: null, objective: `Outro pedido ${i}`, status: 'paused' }], choices: [],
        action: { kind: 'respond', requestId: null, capabilityId: null, query: null, response: 'Pedido guardado.', consent: 'none', consentQuote: null, reason: '' } });
      progress = await advanceStudioReasoningSession({ document, state: progress.state, messageId: `request-${i}`, message: `Outro pedido ${i}`, context: {}, sources: [], memory: await readStudioDurableMemory(scope), dependencies });
    }
    const afterArchive = await studioSessionStore(scope);
    expect(afterArchive.state?.reasoning?.requests).toHaveLength(20);
    expect(afterArchive.state?.reasoning?.requests.some((request) => request.id === 'contract')).toBe(false);
    expect((await readStudioDurableMemory(scope)).records.some(({ event }) => event.kind === 'choice' && event.requestId === `${sessionId}:contract`)).toBe(true);
    // A new session must revise the same durable choice, not create a second current copy.
    await sql.exec('DELETE FROM agent_studio_sessions; DELETE FROM autopilot_conversation_states');
    const resumedStore = await studioSessionStore(scope);
    decide.mockResolvedValue({ requests: [{ id: 'resumed', procedureId: 'contract', resumeFrom: `${sessionId}:contract`, objective: 'Contratar', status: 'active' }],
      choices: [{ requestId: 'resumed', key: 'mesh', label: 'Mesh', value: 'com mesh', status: 'active', sourceMessageId: 'correction', quote: 'Agora quero com mesh' }],
      action: { kind: 'respond', requestId: null, capabilityId: null, query: null, response: 'Atualizei sua preferência.', consent: 'none', consentQuote: null, reason: '' } });
    await advanceStudioReasoningSession({ document, state: createStudioSession(agentId, releaseId, '00000000-0000-4000-8000-000000000008'), messageId: 'correction',
      message: 'Agora quero com mesh', context: {}, sources: [], memory: await readStudioDurableMemory(scope), dependencies: { ...dependencies, checkpoint: resumedStore.checkpoint } });
    const currentChoices = (await readStudioDurableMemory(scope)).records.filter(({ event }) => event.kind === 'choice');
    expect(currentChoices).toHaveLength(1);
    expect(currentChoices[0].event).toMatchObject({ requestId: `${sessionId}:contract`, value: 'com mesh' });
    expect((await readStudioDurableMemory(scope, { history: true })).records.filter(({ event }) => event.kind === 'choice').map(({ event }) => event.value)).toEqual(['com mesh', 'sem mesh']);
  });

  it('survives a new invocation, finished-session cleanup, and release changes without carrying authorization', async () => {
    const first = await studioSessionStore(scope);
    const state = createStudioSession(agentId, releaseId, sessionId);
    state.phase = 'done'; state.status = 'resolved';
    await first.checkpoint(state, [choice()]);
    await sql.exec('DELETE FROM agent_studio_sessions; DELETE FROM autopilot_conversation_states');
    const second = await studioSessionStore({ ...scope, contextId: 'new-invocation' });
    const newState = createStudioSession(agentId, '00000000-0000-4000-8000-000000000007', '00000000-0000-4000-8000-000000000008');
    await second.checkpoint(newState);
    const memory = await readStudioDurableMemory(scope);
    expect(memory.records.map(({ event }) => event.value)).toEqual(['700 mega sem mesh']);
    expect(newState.values).toEqual({}); expect(newState.confirmation).toBeNull(); expect(newState.inFlight).toBeNull();
    expect(memory.records[0].event.source.releaseId).toBe(releaseId);
  });

  it('preserves revisions, suppresses replay duplicates, and keeps different requests with the same field separate', async () => {
    const store = await studioSessionStore(scope);
    const state = createStudioSession(agentId, releaseId, sessionId);
    await store.checkpoint(state, [choice()]);
    await store.checkpoint(state, [choice()]);
    await store.checkpoint(state, [choice('1000 mega'), choice('500 mega', { requestId: 'contract-two' })]);
    const current = await readStudioDurableMemory(scope);
    expect(current.records.map(({ event }) => event.value)).toEqual(['500 mega', '1000 mega']);
    const history = await readStudioDurableMemory(scope, { history: true });
    expect(history.records.map(({ event }) => event.value)).toEqual(['500 mega', '1000 mega', '700 mega sem mesh']);
  });

  it('retains unavailable and cancelled revisions so old choices cannot reappear as current', async () => {
    const store = await studioSessionStore(scope);
    const state = createStudioSession(agentId, releaseId, sessionId);
    await store.checkpoint(state, [choice()]);
    await store.checkpoint(state, [choice(null, { status: 'unavailable' })]);
    expect((await readStudioDurableMemory(scope)).records[0].event.status).toBe('unavailable');
    await store.checkpoint(state, [choice(null, { status: 'cancelled' })]);
    expect((await readStudioDurableMemory(scope)).records).toHaveLength(1);
    expect((await readStudioDurableMemory(scope, { history: true })).records).toHaveLength(3);
  });

  it('recovers an old choice beyond 100 subsequent choices through pagination', async () => {
    const store = await studioSessionStore(scope);
    const state = createStudioSession(agentId, releaseId, sessionId);
    await store.checkpoint(state, [choice()]);
    for (let page = 0; page < 3; page++) {
      await store.checkpoint(state, Array.from({ length: 40 }, (_, i) => choice(`option-${page}-${i}`, { key: `field-${page}-${i}` })));
    }
    const values: unknown[] = []; let cursor: string | null = null;
    do {
      const page = await readStudioDurableMemory(scope, { cursor, limit: 30 });
      values.push(...page.records.map(({ event }) => event.value)); cursor = page.nextCursor;
    } while (cursor);
    expect(values).toHaveLength(121); expect(values.at(-1)).toBe('700 mega sem mesh');
  });

  it('rolls back both state and history if memory persistence fails', async () => {
    const store = await studioSessionStore(scope);
    const state = createStudioSession(agentId, releaseId, sessionId);
    await store.checkpoint(state, [choice()]);
    await sql.exec("ALTER TABLE agent_studio_memory_events ADD CONSTRAINT injected_failure CHECK (false) NOT VALID");
    try {
      state.status = 'resolved'; state.phase = 'done';
      await expect(store.checkpoint(state, [choice('1000 mega')])).rejects.toThrow();
      expect((await studioSessionStore(scope)).state?.status).toBe('running');
      expect((await sql.query<{ status: string }>('SELECT status FROM agent_studio_sessions')).rows[0].status).toBe('running');
      expect((await readStudioDurableMemory(scope)).records[0].event.value).toBe('700 mega sem mesh');
    } finally { await sql.exec('ALTER TABLE agent_studio_memory_events DROP CONSTRAINT injected_failure'); }
    await store.checkpoint(state, [choice('1000 mega')]);
    expect((await readStudioDurableMemory(scope)).records[0].event.value).toBe('1000 mega');
  });

  it('does not write losing concurrent decisions into memory', async () => {
    const first = await studioSessionStore(scope), second = await studioSessionStore(scope);
    const state = createStudioSession(agentId, releaseId, sessionId);
    await first.checkpoint(state, [choice('accepted')]);
    await expect(second.checkpoint(state, [choice('stale')])).rejects.toThrow('outra execução');
    expect((await readStudioDurableMemory(scope, { history: true })).records.map(({ event }) => event.value)).toEqual(['accepted']);
  });

  it('rejects a source from another execution before advancing the checkpoint', async () => {
    const store = await studioSessionStore(scope);
    await expect(store.checkpoint(createStudioSession(agentId, releaseId, sessionId), [choice('x', {
      source: { ...choice().source, sessionId: 'foreign' },
    })])).rejects.toThrow('origem');
    expect((await sql.query('SELECT * FROM autopilot_conversation_states')).rows).toHaveLength(0);
  });

  it('keeps values encrypted, binds ciphertext to scope, and excludes sensitive entries from model context', async () => {
    const store = await studioSessionStore(scope);
    await store.checkpoint(createStudioSession(agentId, releaseId, sessionId), [choice('private-value', { sensitive: true })]);
    const raw = (await sql.query<{ encrypted: string; event_id: string }>('SELECT encrypted,event_id FROM agent_studio_memory_events')).rows[0];
    expect(JSON.stringify(raw)).not.toContain('private-value');
    expect(() => openStudioMemoryEvent({ ...scope, chatId: otherChatId }, { eventId: raw.event_id, encrypted: raw.encrypted })).toThrow('atendimento');
    expect(() => openStudioMemoryEvent(scope, { eventId: '0'.repeat(64), encrypted: raw.encrypted })).toThrow('origem');
    expect(studioMemoryContext((await readStudioDurableMemory(scope)).records)).toEqual([]);
    expect((await readStudioDurableMemory({ ...scope, chatId: otherChatId })).records).toEqual([]);
    expect((await readStudioDurableMemory({ ...scope, workspaceId: otherChatId })).records).toEqual([]);
    expect((await readStudioDurableMemory({ ...scope, agentId: otherChatId })).records).toEqual([]);
  });

  it.each(['anon', 'authenticated'])('denies direct read and mutations to %s', async (role) => {
    await sql.exec(`SET ROLE ${role}`);
    try {
      for (const query of ['SELECT * FROM agent_studio_memory_events', 'DELETE FROM agent_studio_memory_events',
        "UPDATE agent_studio_memory_events SET encrypted='x'", 'INSERT INTO agent_studio_memory_events DEFAULT VALUES']) {
        await expect(sql.query(query)).rejects.toThrow('permission denied');
      }
    } finally { await sql.exec('RESET ROLE'); }
  });

  it('rejects oversized or non-JSON choices instead of truncating them silently', () => {
    expect(() => sealStudioMemoryEvent(scope, choice('x'.repeat(40_000)))).toThrow('limite');
    expect(() => sealStudioMemoryEvent(scope, choice(Number.NaN))).toThrow();
  });
});
