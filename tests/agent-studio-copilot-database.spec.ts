import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
const bridge = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { query: bridge.query } }));
import { loadStudioCopilotContext } from '@/services/agent-studio/copilot-context';
let sql: PGlite;
const scope = { workspaceId: 'workspace', chatId: 'chat', agentId: 'agent', messageId: 'inbound' };
beforeAll(async () => {
  sql = new PGlite(); bridge.query.mockImplementation((query, parameters) => sql.query(query, parameters));
  await sql.exec(`CREATE TABLE autopilot_configs(id text, workspace_id text, is_active boolean);
    CREATE TABLE contacts(id text, workspace_id text, name text);
    CREATE TABLE chats(id text, workspace_id text, contact_id text, autopilot_config_id text, copilot_mode text, is_autopilot_active boolean, status text, assigned_system_agent_id text);
    CREATE TABLE messages(id text, chat_id text, workspace_id text, created_at timestamptz, from_me boolean, type text, content text, transcription text, metadata jsonb, api_message_status text);`);
});
afterAll(async () => { await sql.close(); });
beforeEach(async () => {
  await sql.exec(`TRUNCATE messages, chats, contacts, autopilot_configs;
    INSERT INTO autopilot_configs VALUES ('agent', 'workspace', true);
    INSERT INTO contacts VALUES ('contact','workspace','Ana');
    INSERT INTO chats VALUES ('chat','workspace','contact','agent','suggest',true,'atendimentos',null);
    INSERT INTO messages VALUES ('inbound','chat','workspace','2026-09-19 12:00:00Z',false,'audio',null,'Já reiniciei',null,null),
      ('reply','chat','workspace','2026-09-19 12:01:00Z',true,'text','Teste pelo cabo',null,null,'SENT'),
      ('private','chat','workspace','2026-09-19 12:02:00Z',true,'text','Nota interna',null,'{"isInternalNote":true}','internal'),
      ('failed','chat','workspace','2026-09-19 12:03:00Z',true,'text','Não entregue',null,null,'FAILED'),
      ('foreign','chat','other','2026-09-19 12:04:00Z',false,'text','Outro workspace',null,null,null);`);
});
describe('Copilot PostgreSQL context guards', () => {
  it('uses transcriptions and human replies, excluding private, failed and foreign messages', async () => {
    const context = await loadStudioCopilotContext(scope);
    expect(context.history.map((turn) => turn.content)).toEqual(['Já reiniciei', 'Teste pelo cabo']);
    expect(context.contact.name).toBe('Ana'); await expect(context.assertCurrent()).resolves.toBeUndefined();
  });
  it.each(["copilot_mode='off'", "autopilot_config_id='other'", "assigned_system_agent_id='autonomous'", "status='encerrados'", 'is_autopilot_active=false'])('invalidates in-flight drafts after %s', async (update) => {
    const context = await loadStudioCopilotContext(scope);
    await sql.exec(`UPDATE chats SET ${update}`);
    await expect(context.assertCurrent()).rejects.toMatchObject({ code: 'AUTOPILOT_SOURCE_SUPERSEDED' });
  });
  it.each([true, false])('invalidates the draft on new customer/operator messages (fromMe=%s)', async (fromMe) => {
    const context = await loadStudioCopilotContext(scope);
    await sql.query(`INSERT INTO messages(id, chat_id, workspace_id, created_at, from_me, type, content) VALUES ('new','chat','workspace','2026-09-19 13:00:00Z',$1,'text','Nova resposta')`, [fromMe]);
    await expect(context.assertCurrent()).rejects.toMatchObject({ code: 'AUTOPILOT_SOURCE_SUPERSEDED' });
  });
  it('never loads a context for another workspace', async () => {
    await expect(loadStudioCopilotContext({ ...scope, workspaceId: 'other' })).rejects.toMatchObject({ code: 'AUTOPILOT_SOURCE_SUPERSEDED' });
  });
});
