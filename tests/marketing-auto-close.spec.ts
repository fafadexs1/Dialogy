import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeMarketingAutoClose, getMarketingAutoCloseMs, runDueMarketingAutoCloses } from '@/services/chat/auto-close';
import { scheduleMarketingAutoClose } from '@/services/chat/marketing-auto-close';

const mocks = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn(), broadcast: vi.fn(), enqueue: vi.fn(), queued: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: mocks }));
vi.mock('@/lib/realtime/chat-broadcast', () => ({ broadcastHydratedChatUpdate: mocks.broadcast }));
vi.mock('@/lib/queue', () => ({ enqueueMarketingAutoClose: mocks.enqueue, shouldEnqueueJob: mocks.queued }));

let sql: PGlite;
let anchor: Date;
const chatId = 'chat-1';
const workspaceId = 'workspace-1';

beforeAll(async () => {
  sql = new PGlite();
  await sql.exec(`
    CREATE TABLE workspaces (id text PRIMARY KEY, marketing_auto_close_seconds integer);
    CREATE TABLE chats (
      id text PRIMARY KEY, workspace_id text, status text, agent_id text,
      assigned_system_agent_id text, assigned_at timestamptz, is_autopilot_active boolean,
      copilot_mode text, closed_at timestamptz, updated_at timestamptz
    );
    CREATE TABLE messages (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id text, chat_id text, type text,
      content text, from_me boolean, is_read boolean, api_message_status text, metadata jsonb,
      created_at timestamptz DEFAULT clock_timestamp()
    );
    CREATE TABLE meta_conversations (chat_id text, status text, updated_at timestamptz);
    CREATE TABLE campaign_recipients (message_id uuid, sent_at timestamptz, status text);
    CREATE TABLE workflow_executions (workspace_id text, conversation_id text, session_id text, status text, updated_at timestamptz);
  `);
  mocks.query.mockImplementation(async (query: string, values?: unknown[]) => {
    const result = await sql.query(query, values);
    return { ...result, rowCount: result.rows.length || result.affectedRows || 0 };
  });
  mocks.connect.mockResolvedValue({ query: mocks.query, release: vi.fn() });
});

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.queued.mockReturnValue(true);
  mocks.broadcast.mockResolvedValue(undefined);
  await sql.exec('TRUNCATE workspaces, chats, messages, meta_conversations, workflow_executions, campaign_recipients');
  anchor = new Date(Date.now() - 301_000);
  await sql.query('INSERT INTO workspaces VALUES ($1, NULL)', [workspaceId]);
  await sql.query(`INSERT INTO chats VALUES ($1, $2, 'gerais', NULL, 'robot-1', NOW(), true, 'autopilot', NULL, NOW())`, [chatId, workspaceId]);
  await message(true, { campaignId: 'campaign-old' }, anchor);
  await sql.query(`INSERT INTO meta_conversations VALUES ($1, 'open', NOW())`, [chatId]);
  await sql.query(`INSERT INTO workflow_executions VALUES ($1, $2, NULL, 'waiting', NOW())`, [workspaceId, chatId]);
});

afterAll(async () => { await sql.close(); });

async function message(fromMe: boolean, metadata = {}, at = new Date(), type = 'text', status = 'SENT') {
  await sql.query(`INSERT INTO messages(workspace_id, chat_id, type, from_me, metadata, created_at, api_message_status)
    VALUES ($1, $2, $3, $4, $5, $6, $7)`, [workspaceId, chatId, type, fromMe, JSON.stringify(metadata), at.toISOString(), status]);
}

async function chat() { return (await sql.query<Record<string, unknown>>('SELECT * FROM chats WHERE id = $1', [chatId])).rows[0]; }
function close() { return executeMarketingAutoClose({ chatId, workspaceId, marketingSentAt: anchor, autoCloseMs: 300_000 }); }

describe('marketing close with PostgreSQL queries', () => {
  it('closes unanswered marketing, releases the robot, cancels waiting flows and broadcasts once', async () => {
    await close();
    expect(await chat()).toMatchObject({ status: 'encerrados', assigned_system_agent_id: null, assigned_at: null, is_autopilot_active: false, copilot_mode: 'off' });
    expect((await chat()).closed_at).not.toBeNull();
    expect((await sql.query<{ status: string }>('SELECT status FROM meta_conversations')).rows[0].status).toBe('closed');
    expect((await sql.query<{ status: string }>('SELECT status FROM workflow_executions')).rows[0].status).toBe('cancelled');
    const notes = await sql.query<{ metadata: Record<string, unknown> }>(`SELECT metadata FROM messages WHERE type = 'system'`);
    expect(notes.rows[0].metadata).toMatchObject({ event: 'marketing_auto_close', autoCloseMs: 300_000 });
    await close();
    expect(mocks.broadcast).toHaveBeenCalledExactlyOnceWith(workspaceId, chatId);
  });

  it('keeps the conversation open when the customer replies', async () => {
    await message(false);
    await close();
    expect((await chat()).status).toBe('gerais');
    expect(await runDueMarketingAutoCloses()).toBe(0);
  });

  it('does not close a human attendance', async () => {
    await sql.query(`UPDATE chats SET agent_id = 'human-1', status = 'atendimentos'`);
    await close();
    expect((await chat()).status).toBe('atendimentos');
    expect(await runDueMarketingAutoCloses()).toBe(0);
  });

  it('does not let an older timer close a newer campaign or customer-facing response', async () => {
    await message(true, { isMarketing: true });
    await close();
    expect((await chat()).status).toBe('gerais');
    expect(await runDueMarketingAutoCloses()).toBe(0);
  });

  it('ignores internal notes and system events while awaiting the customer', async () => {
    await message(true, {}, new Date(), 'system');
    await message(true, { isInternalNote: true });
    await message(true, {}, new Date(), 'text', 'INTERNAL');
    expect(await runDueMarketingAutoCloses()).toBe(1);
    expect((await chat()).status).toBe('encerrados');
  });

  it('recovers an overdue campaign without the old marketing flag after a restart', async () => {
    expect(await runDueMarketingAutoCloses()).toBe(1);
    expect((await chat()).status).toBe('encerrados');
    expect(await runDueMarketingAutoCloses()).toBe(0);
  });

  it('preserves the database timestamp precision when recovering a campaign', async () => {
    await sql.query(`UPDATE messages SET created_at = $1::timestamptz + interval '456 microseconds'`, [anchor.toISOString()]);
    expect(await runDueMarketingAutoCloses()).toBe(1);
    expect((await chat()).status).toBe('encerrados');
  });

  it('allows five minutes after a delayed delivery before recovering its close', async () => {
    await sql.query(`INSERT INTO campaign_recipients SELECT id, clock_timestamp() - interval '2 minutes', 'sent' FROM messages`);
    expect(await runDueMarketingAutoCloses()).toBe(0);
    await sql.query(`UPDATE campaign_recipients SET sent_at = clock_timestamp() - interval '301 seconds'`);
    expect(await runDueMarketingAutoCloses()).toBe(1);
    expect((await chat()).status).toBe('encerrados');
  });

  it('ignores old customer messages sent before the current campaign', async () => {
    await message(false, {}, new Date(anchor.getTime() - 1000));
    expect(await runDueMarketingAutoCloses()).toBe(1);
    expect((await chat()).status).toBe('encerrados');
  });

  it.each(['PENDING', 'FAILED', 'SENDING'])('does not recover an unsuccessful %s campaign send', async status => {
    await sql.query('UPDATE messages SET api_message_status = $1', [status]);
    expect(await runDueMarketingAutoCloses()).toBe(0);
    expect((await chat()).status).toBe('gerais');
  });

  it('does not run early or act across workspaces', async () => {
    await executeMarketingAutoClose({ chatId, workspaceId, marketingSentAt: new Date(), autoCloseMs: 300_000 });
    await executeMarketingAutoClose({ chatId, workspaceId: 'other-workspace', marketingSentAt: anchor, autoCloseMs: 300_000 });
    expect((await chat()).status).toBe('gerais');
  });

  it('uses five minutes by default and honors the workspace setting', async () => {
    expect(await getMarketingAutoCloseMs(workspaceId)).toBe(300_000);
    await sql.query('UPDATE workspaces SET marketing_auto_close_seconds = 0');
    expect(await getMarketingAutoCloseMs(workspaceId)).toBe(0);
    expect(await runDueMarketingAutoCloses()).toBe(0);
    await scheduleMarketingAutoClose(chatId, workspaceId, new Date());
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it('queues a durable close five minutes after the message anchor', async () => {
    await scheduleMarketingAutoClose(chatId, workspaceId, anchor);
    expect(mocks.enqueue).toHaveBeenCalledWith(
      { chatId, workspaceId, marketingSentAt: anchor.toISOString(), autoCloseMs: 300_000 },
      { runAt: new Date(anchor.getTime() + 300_000), maxAttempts: 3 },
    );
  });
});
