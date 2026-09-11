import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
const m = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn(), model: vi.fn(), http: vi.fn(), mcp: vi.fn(), resolveMcp: vi.fn(), close: vi.fn(), transfer: vi.fn(), upload: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { query: m.query, connect: m.connect } }));
vi.mock('@/ai/flows/procedure-runtime', () => ({ generateProcedureRuntimeOutput: m.model }));
vi.mock('@/services/agent-studio/integrations', () => ({ executeStudioHttp: m.http, executeStudioMcp: m.mcp, resolveStudioMcpTool: m.resolveMcp }));
vi.mock('@/actions/chats', () => ({ closeChatAction: m.close, transferChatAction: m.transfer }));
vi.mock('@/lib/storage/private-s3', () => ({ putPrivateObject: m.upload }));
vi.mock('@/lib/security/safe-remote-url', () => ({ validateRemoteUrl: vi.fn(async () => {}) }));
vi.mock('@/lib/realtime/chat-broadcast', () => ({ broadcastHydratedChatUpdate: vi.fn(async () => {}) }));
import { createLiveTest, loadLiveTest, claimLiveTest, decodeLiveTest, readLiveTestView, readLiveTestSessionHistory } from '@/services/agent-studio/live-test-store';
import { sendLiveTestMessage } from '@/services/agent-studio/live-test';
import { createDefaultAgentStudioDocument, ProcedureDocumentSchema, type AgentReleaseManifest } from '@/services/agent-studio/types';
import type { AutopilotConfig } from '@/lib/types';
import { readStudioDurableMemory } from '@/services/agent-studio/durable-memory-store';
import type { StudioMemoryEvent } from '@/services/agent-studio/durable-memory';

const workspaceId = '00000000-0000-4000-8000-000000000001';
const agentId = '00000000-0000-4000-8000-000000000002';
const userId = '00000000-0000-4000-8000-000000000003';
const teamId = '00000000-0000-4000-8000-000000000004';
const tagId = '00000000-0000-4000-8000-000000000005';
const scope = { workspaceId, agentId, userId, sessionId: '00000000-0000-4000-8000-000000000006' };
const config = { id: agentId, workspace_id: workspaceId, ai_model: 'mutable-model' } as AutopilotConfig;
let sql: PGlite;
beforeAll(async () => {
  process.env.WORKSPACE_CREDENTIALS_ENCRYPTION_KEY ||= 'studio-live-test-encryption-key-for-tests-only';
  sql = new PGlite();
  m.query.mockImplementation((query: string, values?: unknown[]) => sql.query(query, values));
  m.connect.mockResolvedValue({ query: m.query, release: vi.fn() });
  await sql.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE workspaces(id uuid PRIMARY KEY); CREATE TABLE users(id uuid PRIMARY KEY);
    CREATE TABLE autopilot_configs(id uuid PRIMARY KEY, workspace_id uuid);
    CREATE TABLE contacts(id uuid PRIMARY KEY, workspace_id uuid, name text, phone text NOT NULL, email text, phone_number_jid text UNIQUE, created_at timestamptz);
    CREATE TABLE chats(id uuid PRIMARY KEY, workspace_id uuid, contact_id uuid, agent_id uuid, assigned_system_agent_id uuid, status text, protocol text, autopilot_config_id uuid,
      is_autopilot_active boolean, copilot_mode text, team_id uuid, assigned_at timestamptz, last_activity_at timestamptz, updated_at timestamptz);
    CREATE TABLE messages(id uuid PRIMARY KEY, workspace_id uuid, chat_id uuid, type text, content text, from_me boolean, is_read boolean, api_message_status text,
      instance_name text, source_from_api text, metadata jsonb, created_at timestamptz);
    CREATE TABLE teams(id uuid PRIMARY KEY, workspace_id uuid, name text);
    CREATE TABLE tags(id uuid PRIMARY KEY, workspace_id uuid);
    CREATE TABLE contact_tags(contact_id uuid, tag_id uuid, PRIMARY KEY(contact_id, tag_id));
    INSERT INTO workspaces VALUES ('${workspaceId}'); INSERT INTO users VALUES ('${userId}');
    INSERT INTO autopilot_configs VALUES ('${agentId}', '${workspaceId}');
    INSERT INTO teams VALUES ('${teamId}', '${workspaceId}', 'Suporte'); INSERT INTO tags VALUES ('${tagId}', '${workspaceId}');`);
  await sql.exec(await readFile('prisma/migrations/20260830210000_agent_studio_live_tests/migration.sql', 'utf8'));
  await sql.exec(await readFile('prisma/migrations/20260908140000_agent_studio_durable_memory/migration.sql', 'utf8'));
  await sql.exec(await readFile('prisma/migrations/20260909150000_agent_studio_live_session_history/migration.sql', 'utf8'));
  await sql.exec('ALTER TABLE messages ADD COLUMN media_url text');
});
afterAll(async () => { await sql.close(); });
beforeEach(async () => {
  await sql.exec('TRUNCATE agent_studio_live_tests, messages, chats, contacts, contact_tags CASCADE');
  for (const mock of [m.model, m.http, m.mcp, m.resolveMcp, m.close, m.transfer, m.upload]) mock.mockReset();
  m.model.mockImplementation(async (request) => request.mode === 'decision' ? { decision: 'invoice' } : { response: 'Resposta do provedor' });
  m.http.mockResolvedValue({ values: { invoice: 'Resultado real da API' } });
  m.close.mockImplementation(async (chatId) => { await sql.query("UPDATE chats SET status='encerrados' WHERE id=$1", [chatId]); return { success: true }; });
  m.transfer.mockImplementation(async ({ chatId, teamId }) => { await sql.query("UPDATE chats SET team_id=$2, agent_id=NULL WHERE id=$1", [chatId, teamId]); return { success: true }; });
});

async function start(steps?: unknown[], contact: { name: string; phone?: string; email?: string } = { name: 'Cliente', phone: '5511999999999' }) {
  const document = createDefaultAgentStudioDocument(agentId, workspaceId);
  document.concludeStage.handoffTeam = 'Suporte';
  document.resolveStage.procedures = [ProcedureDocumentSchema.parse({ id: 'invoice', name: 'Fatura', whenToUse: 'Fatura', updatedAt: '2026-08-30', steps: steps || [
    { id: 'api', order: 1, title: 'Consultar', type: 'http_request', httpRequest: { name: 'Consultar', connectionId: 'connection', url: '/invoice', outputMappings: [{ chipKey: 'invoice', chipLabel: 'Fatura', jsonPath: 'invoice' }] } },
    { id: 'reply', order: 2, title: 'Responder', type: 'respond', messageDataKeys: ['invoice'] },
  ] })];
  const release: AgentReleaseManifest = { releaseId: scope.sessionId, agentId, workspaceId, version: 1, agentSnapshot: document,
    publishedProcedures: document.resolveStage.procedures, runtimeConfig: { aiModel: 'pinned-model' }, referencedConnectionIds: ['connection'],
    connectionFingerprints: { connection: 'pinned-connection' }, mcpServerToolFingerprints: { 'mcp:erp:invoice': 'pinned-tool' }, createdAt: new Date().toISOString(), runtimeVersion: 'studio-v1' };
  return createLiveTest(scope, release, contact, {});
}

describe('persistent live Studio test', () => {
  it('retains encrypted operation evidence across completed execution sessions and isolates the author', async () => {
    await start();
    const lease = await claimLiveTest(scope);
    try {
      const prior = decodeLiveTest(scope, lease.row).state;
      prior.status = 'resolved'; prior.phase = 'done';
      prior.reasoning = { version: 2, requests: [], pendingAction: null, operations: [{
        id: 'confirmed-effect', requestId: 'order', memoryRequestId: `${prior.id}:order`,
        capabilityId: 'invoice:api', signature: 'confirmed-signature', status: 'succeeded', readOnly: false,
        values: { receipt: 'verified-receipt' }, at: new Date().toISOString(),
      }] };
      await lease.checkpoint(prior);
      const next = structuredClone(prior);
      next.id = randomUUID(); next.status = 'running'; next.phase = 'resolve'; next.reasoning!.operations = [];
      await lease.checkpoint(next);
      const history = await readLiveTestSessionHistory(scope);
      expect(history.currentSessionId).toBe(next.id);
      expect(history.sessions).toHaveLength(2);
      expect(history.sessions.find((entry) => entry.id === prior.id)?.reasoning?.operations[0]).toMatchObject({
        id: 'confirmed-effect', status: 'succeeded', values: { receipt: 'verified-receipt' },
      });
      await expect(readLiveTestSessionHistory({ ...scope, userId: randomUUID() })).rejects.toThrow('Teste não encontrado');
      const ciphertext = await sql.query<{ encrypted_state: string }>('SELECT encrypted_state FROM agent_studio_live_session_history');
      expect(ciphertext.rows.every((entry) => !entry.encrypted_state.includes('verified-receipt'))).toBe(true);
      const invalid = structuredClone(next); invalid.id = randomUUID();
      await expect(lease.checkpoint(invalid)).rejects.toThrow('atendimento pendente');
      expect((await readLiveTestSessionHistory(scope)).currentSessionId).toBe(next.id);
    } finally { await lease.release(); }
  });

  it('persists the selected catalog photo in the test chat and does not duplicate it on replay', async () => {
    await start([
      { id: 'api', order: 1, title: 'Catálogo', type: 'http_request', httpRequest: { name: 'Catálogo', connectionId: 'connection', url: '/products', outputMappings: [{ chipKey: 'products', chipLabel: 'Produtos', jsonPath: 'products' }] } },
      { id: 'photo', order: 2, title: 'Mostrar produto', type: 'native_action', nativeActionType: 'show_catalog_image',
        nativeActionPayload: { catalogKey: 'products', productIdPath: 'id', titlePath: 'name', imagePath: 'image', allowedHosts: ['images.store.example'], mimeType: 'image/png' },
        nativeDataMappings: [{ apiField: 'productId', sourceType: 'static_value', sourceValue: 'blue' }] },
    ]);
    m.http.mockResolvedValue({ values: { products: [{ id: 'blue', name: 'Vestido azul', image: 'https://images.store.example/blue.png' }] } });
    await sendLiveTestMessage(scope, config, randomUUID(), 'Quero ver o vestido');
    const confirmationId = randomUUID();
    await sendLiveTestMessage(scope, config, confirmationId, 'sim');
    await sendLiveTestMessage(scope, config, confirmationId, 'sim');
    const images = await sql.query<{ content: string; metadata: Record<string, unknown> }>("SELECT content, metadata FROM messages WHERE type='image' AND from_me=TRUE");
    expect(images.rows).toHaveLength(1);
    expect(images.rows[0]).toMatchObject({ content: 'Vestido azul', metadata: { mediaUrl: 'https://images.store.example/blue.png', mimetype: 'image/png', studioLiveTestId: scope.sessionId } });
    expect((await readLiveTestView(scope)).messages.some((message) => message.attachmentUrl === 'https://images.store.example/blue.png')).toBe(true);
  });
  it('commits choice memory atomically with the live-test lease and rolls back on persistence failure', async () => {
    const row = await start(); const lease = await claimLiveTest(scope);
    const { state } = decodeLiveTest(scope, row);
    const choice: StudioMemoryEvent = { version: 1, requestId: 'contract', kind: 'choice', key: 'plan', label: 'Plano', value: '700 mega',
      status: 'active', sensitive: false, source: { sessionId: state.id, releaseId: state.releaseId, procedureId: null,
        messageId: randomUUID(), quote: '700 mega', at: new Date().toISOString() } };
    await lease.checkpoint(state, [choice]);
    const memoryScope = { workspaceId, agentId, chatId: row.chat_id };
    expect((await readStudioDurableMemory(memoryScope)).records[0].event.value).toBe('700 mega');
    const before = await loadLiveTest(scope);
    await sql.exec('ALTER TABLE agent_studio_memory_events ADD CONSTRAINT injected_memory_failure CHECK (false) NOT VALID');
    try {
      state.status = 'resolved';
      await expect(lease.checkpoint(state, [{ ...choice, value: '1000 mega' }])).rejects.toThrow();
      const after = await loadLiveTest(scope);
      expect(after.revision).toBe(before.revision);
      expect(decodeLiveTest(scope, after).state.status).toBe('running');
      expect((await readStudioDurableMemory(memoryScope)).records[0].event.value).toBe('700 mega');
    } finally { await sql.exec('ALTER TABLE agent_studio_memory_events DROP CONSTRAINT injected_memory_failure'); await lease.release(); }
  });
  it.each([undefined, '', '   '])('creates a contact without an optional phone (%j) under NOT NULL constraints', async (phone) => {
    const row = await start(undefined, { name: 'Sem telefone', phone });
    const retry = await start(undefined, { name: 'Sem telefone', phone });
    expect(retry.chat_id).toBe(row.chat_id);
    const contacts = await sql.query('SELECT name, phone, phone_number_jid FROM contacts');
    expect(contacts.rows).toEqual([{ name: '[Teste IA] Sem telefone', phone: '', phone_number_jid: `webchat:studio:${scope.sessionId}` }]);
    expect((await readLiveTestView(scope)).chat.phone).toBe('');
    await sendLiveTestMessage(scope, config, randomUUID(), 'Quero fatura');
    expect(m.http).toHaveBeenCalledWith(expect.objectContaining({
      context: expect.objectContaining({ contact: expect.objectContaining({ phone: undefined }) }),
    }));
  });
  it('creates a real contact/chat once and blocks browser writes to runtime state', async () => {
    const first = await start(); const second = await start();
    expect(second.chat_id).toBe(first.chat_id);
    const chats = await sql.query('SELECT * FROM chats'); expect(chats.rows).toHaveLength(1);
    expect(chats.rows[0]).toMatchObject({ agent_id: userId, is_autopilot_active: false });
    const privileges = await sql.query<{ allowed: boolean }>("SELECT has_table_privilege('authenticated', 'agent_studio_live_tests', 'UPDATE') AS allowed");
    expect(privileges.rows[0].allowed).toBe(false);
    await expect(loadLiveTest({ ...scope, userId: randomUUID() })).rejects.toThrow('Teste não encontrado');
  });
  it('executes production HTTP adapter, persists messages, preserves the model and never replays writes', async () => {
    await start(); const messageId = randomUUID();
    await sendLiveTestMessage(scope, config, messageId, 'Quero fatura');
    expect(m.http).toHaveBeenCalledWith(expect.objectContaining({ expectedConnectionFingerprint: 'pinned-connection', workspaceId,
      context: expect.objectContaining({ contact: expect.objectContaining({ phone: '5511999999999' }) }) }));
    expect(m.model).toHaveBeenCalledWith(expect.objectContaining({ model: 'pinned-model', fixedModel: true }));
    const view = await readLiveTestView(scope);
    expect(view.messages).toHaveLength(2); expect(view.messages[1].text).toContain('Resultado real da API'); expect(view.state.values.invoice).toBe('Resultado real da API');
    await sendLiveTestMessage(scope, config, messageId, 'Quero fatura');
    expect(m.http).toHaveBeenCalledTimes(1); expect((await readLiveTestView(scope)).messages).toHaveLength(2);
    await expect(sendLiveTestMessage(scope, config, messageId, 'outro texto')).rejects.toThrow('Identificador');
  });
  it('reserves each turn atomically and never repeats an uncertain operation after lease expiry', async () => {
    await start(); const first = await claimLiveTest(scope);
    await expect(claimLiveTest(scope)).rejects.toThrow('outra mensagem');
    const { state } = decodeLiveTest(scope, first.row); state.inFlight = { key: 'operation', stepId: 'api' };
    await first.checkpoint(state); await first.release();
    await expect(sendLiveTestMessage(scope, config, randomUUID(), 'sim')).rejects.toThrow('sem confirmação');
    expect(m.http).not.toHaveBeenCalled();
  });
  it('executes MCP with the pinned contract and waits for confirmation before a real write', async () => {
    await start([{ id: 'mcp', title: 'Gerar', type: 'mcp_tool_call', order: 1, mcpTool: { serverId: 'erp', qualifiedToolName: 'mcp:erp:invoice', friendlyToolName: 'Gerar', requiresConfirmation: true, outputMappings: [{ chipKey: 'invoice', chipLabel: 'Fatura', jsonPath: 'invoice' }] } },
      { id: 'reply', title: 'Responder', type: 'respond', order: 2, messageDataKeys: ['invoice'] }]);
    m.mcp.mockResolvedValue({ values: { invoice: 'Fatura gerada' } });
    await sendLiveTestMessage(scope, config, randomUUID(), 'Fatura'); expect(m.mcp).not.toHaveBeenCalled();
    await sendLiveTestMessage(scope, config, randomUUID(), 'sim');
    expect(m.mcp).toHaveBeenCalledWith(expect.objectContaining({ confirmed: true, expectedFingerprint: 'pinned-tool' }));
    expect((await readLiveTestView(scope)).messages.at(-1)?.text).toContain('Fatura gerada');
  });
  it('updates CRM through the production SQL action and closes the persisted chat', async () => {
    await start([{ id: 'tag', title: 'Etiquetar', type: 'native_action', nativeActionType: 'add_tag', nativeActionPayload: { tagId }, order: 1 },
      { id: 'close', title: 'Encerrar', type: 'native_action', nativeActionType: 'close_chat', order: 2 }]);
    await sendLiveTestMessage(scope, config, randomUUID(), 'Fatura');
    await sendLiveTestMessage(scope, config, randomUUID(), 'sim');
    expect((await sql.query('SELECT * FROM contact_tags')).rows).toHaveLength(1);
    await sendLiveTestMessage(scope, config, randomUUID(), 'sim');
    expect(m.close).toHaveBeenCalledTimes(1); expect((await readLiveTestView(scope)).chat.status).toBe('encerrados');
    await expect(sendLiveTestMessage(scope, config, randomUUID(), 'Olá')).rejects.toThrow('terminou');
  });
  it('transfers through the regular action and shows actual human replies without restarting AI', async () => {
    const row = await start();
    await sendLiveTestMessage(scope, config, randomUUID(), 'quero falar com humano');
    expect(m.transfer).toHaveBeenCalledWith({ chatId: row.chat_id, teamId });
    expect((await readLiveTestView(scope)).messages.at(-1)?.text).toContain('equipe Suporte');
    const before = m.model.mock.calls.length;
    await sendLiveTestMessage(scope, config, randomUUID(), 'Estou aguardando');
    await sql.query("INSERT INTO messages(id,workspace_id,chat_id,type,content,from_me,created_at) VALUES ($1,$2,$3,'text','Olá, sou o atendente',TRUE,clock_timestamp())", [randomUUID(), workspaceId, row.chat_id]);
    expect((await readLiveTestView(scope)).messages.at(-1)?.text).toBe('Olá, sou o atendente'); expect(m.model.mock.calls).toHaveLength(before);
  });
  it('queues the chat and explains the schedule when the destination team is outside business hours', async () => {
    await start([{ id: 'handoff', title: 'Comercial', type: 'handoff', order: 1, handoffTeam: teamId, handoffReason: 'Lead qualificado' }]);
    m.transfer.mockResolvedValue({ success: false, reasonCode: 'outside_business_hours', error: 'Equipe fora do horário.' });
    await sendLiveTestMessage(scope, config, randomUUID(), 'Quero fatura');
    const view = await readLiveTestView(scope);
    expect(view.state.status).toBe('transferred');
    expect(view.chat).toMatchObject({ status: 'gerais', team_id: teamId, agent_id: null });
    expect(view.messages.at(-1)?.text).toContain(view.document.rules.outOfHoursMessage);
  });
  it('does not reuse the synthetic default test name as customer data', async () => {
    await start([
      { id: 'name', title: 'Nome', type: 'collect_data', order: 1, collectField: { id: 'name', name: 'Nome completo', variableKey: 'name', type: 'text', promptMessage: 'Qual é o seu nome completo?', reuseFrom: { sourceType: 'contact_property', sourceValue: 'name' } } },
      { id: 'reply', title: 'Continuar', type: 'respond', order: 2, messageText: 'Obrigado.' },
    ], { name: 'Cliente de teste' });
    await sendLiveTestMessage(scope, config, randomUUID(), 'Quero fatura');
    const view = await readLiveTestView(scope);
    expect(view.messages.at(-1)?.text).toContain('Qual é o seu nome completo?');
    expect(view.state.values.name).toBeUndefined();
  });
  it('keeps a provider failure retryable without checkpointing fake progress or transferring', async () => {
    await start(); m.model.mockResolvedValue({});
    await expect(sendLiveTestMessage(scope, config, randomUUID(), 'Preciso de ajuda')).rejects.toThrow('A IA não retornou');
    const view = await readLiveTestView(scope); expect(view.state.phase).toBe('understand'); expect(view.busy).toBe(false); expect(m.transfer).not.toHaveBeenCalled();
  });
  it('stops dispatching tools after the team manually takes over the test chat', async () => {
    const row = await start();
    await sql.query('UPDATE chats SET agent_id=NULL WHERE id=$1', [row.chat_id]);
    await sendLiveTestMessage(scope, config, randomUUID(), 'Quero fatura');
    expect((await readLiveTestView(scope)).state.status).toBe('transferred');
    expect(m.model).not.toHaveBeenCalled(); expect(m.http).not.toHaveBeenCalled();
  });
  it('persists a real attachment and resumes a file collection step', async () => {
    await start([{ id: 'file', title: 'Documento', type: 'collect_data', order: 1, collectField: { id: 'file', name: 'Documento', variableKey: 'file', type: 'file', promptMessage: 'Envie o documento' } },
      { id: 'reply', title: 'Responder', type: 'respond', order: 2, messageText: 'Documento recebido' }]);
    await sendLiveTestMessage(scope, config, randomUUID(), 'Fatura');
    const id = randomUUID(); await sendLiveTestMessage(scope, config, id, 'Arquivo: teste.pdf', { file: new File(['%PDF-1.7'], 'teste.pdf', { type: 'application/pdf' }) });
    expect(m.upload).toHaveBeenCalledWith(expect.objectContaining({ key: `workspaces/${workspaceId}/message-media/${id}.pdf` }));
    expect((await readLiveTestView(scope)).state.values.file).toMatchObject({ id, name: 'teste.pdf' });
  });
});
