import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Chat, Message } from '@/lib/types';
import { buildInboxMarketingVisibilitySql, matchesInboxMarketingFilter } from '@/lib/inbox-marketing';
import { isChatInInboxQueueScope, scopeInboxListFilters } from '@/lib/inbox-pagination';

let sql: PGlite;
let sequence = 0;
beforeAll(async () => {
  sql = new PGlite();
  await sql.exec(`
    CREATE TABLE chats (id text PRIMARY KEY, workspace_id text, status text, agent_id text, tag text);
    CREATE TABLE messages (id text PRIMARY KEY, chat_id text, workspace_id text, type text,
      api_message_status text, metadata jsonb, created_at timestamptz);
  `);
});
beforeEach(async () => { sequence = 0; await sql.exec('TRUNCATE chats, messages'); });
afterAll(async () => { await sql.close(); });

async function chat(id: string, scope: 'robo' | 'fila', status: Chat['status'] = 'gerais', agentId?: string): Promise<Chat> {
  const tag = scope === 'fila' ? 'Suporte' : '';
  await sql.query('INSERT INTO chats VALUES ($1, $2, $3, $4, $5)', [id, 'workspace-1', status, agentId || null, tag]);
  return { id, workspace_id: 'workspace-1', status, agentId, tag, messages: [], contact: { id: `contact-${id}`, workspace_id: 'workspace-1', name: id } };
}

async function message(chat: Chat, metadata: Message['metadata'], options: Partial<Message> = {}) {
  const item = {
    id: `message-${String(++sequence).padStart(3, '0')}`, chat_id: chat.id, workspace_id: chat.workspace_id,
    type: 'text', content: 'Mensagem', from_me: true, createdAt: new Date(Date.UTC(2026, 9, 28, 12, 0, sequence)).toISOString(),
    metadata, ...options,
  } as Message;
  chat.messages.push(item);
  await sql.query('INSERT INTO messages VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [item.id, item.chat_id, item.workspace_id, item.type, item.api_message_status || null, metadata ? JSON.stringify(metadata) : null, item.createdAt]);
}

async function visible(scope: 'robo' | 'fila', includeMarketing = false) {
  const { rows } = await sql.query<{ id: string }>(`SELECT c.id FROM chats c
    WHERE c.status = 'gerais' AND c.agent_id IS NULL AND ${scope === 'fila' ? "c.tag <> ''" : "c.tag = ''"}
      ${includeMarketing ? '' : `AND ${buildInboxMarketingVisibilitySql()}`}
    ORDER BY c.id`);
  return rows.map(row => row.id);
}

describe.each(['robo', 'fila'] as const)('marketing visibility in %s', scope => {
  it.each([{ isMarketing: true }, { campaignId: 'legacy-campaign' }])('requires opt-in for %j in both the server and cached/realtime lists', async metadata => {
    const campaign = await chat('campaign', scope);
    await message(campaign, metadata);
    expect(isChatInInboxQueueScope(campaign, scope)).toBe(true);
    expect(await visible(scope)).toEqual([]);
    expect(matchesInboxMarketingFilter(campaign)).toBe(false);
    expect(await visible(scope, true)).toEqual(['campaign']);
    expect(matchesInboxMarketingFilter(campaign, true)).toBe(true);
    expect(await visible(scope, false)).toEqual([]);
    expect(matchesInboxMarketingFilter(campaign, false)).toBe(false);
  });

  it('preserves ordinary conversations with missing metadata or no messages', async () => {
    const empty = await chat('empty', scope);
    const normal = await chat('normal', scope);
    const noMetadata = await chat('no-metadata', scope);
    await message(normal, {});
    await message(noMetadata, undefined);
    expect(await visible(scope)).toEqual(['empty', 'no-metadata', 'normal']);
    for (const item of [empty, normal, noMetadata]) expect(matchesInboxMarketingFilter(item)).toBe(true);
  });

  it('shows a campaign normally after the customer replies', async () => {
    const campaign = await chat('answered', scope);
    await message(campaign, { isMarketing: true });
    await message(campaign, {}, { from_me: false });
    expect(await visible(scope)).toEqual(['answered']);
    expect(matchesInboxMarketingFilter(campaign)).toBe(true);
    campaign.messages.reverse();
    expect(matchesInboxMarketingFilter(campaign)).toBe(true);
  });

  it('keeps unanswered campaigns hidden after internal notes and robot assignment events', async () => {
    const campaign = await chat('campaign', scope);
    await message(campaign, { campaignId: 'campaign-1' });
    await message(campaign, {}, { type: 'system' });
    await message(campaign, { isInternalNote: true });
    await message(campaign, {}, { api_message_status: 'INTERNAL' });
    expect(await visible(scope)).toEqual([]);
    expect(matchesInboxMarketingFilter(campaign)).toBe(false);
  });

  it('passes the selected marketing option to page loading for both queue tabs', () => {
    const tab = scope === 'fila' ? 'gerais' : 'robo';
    expect(scopeInboxListFilters(tab, { includeMarketing: false })).toEqual({ queueScope: scope, includeMarketing: false });
    expect(scopeInboxListFilters(tab, { includeMarketing: true })).toEqual({ queueScope: scope, includeMarketing: true });
  });
});

it('keeps attending and closed conversations visible regardless of their marketing history', async () => {
  for (const status of ['atendimentos', 'encerrados'] as const) {
    const item = await chat(status, 'fila', status, 'human-1');
    await message(item, { isMarketing: true });
    expect(matchesInboxMarketingFilter(item)).toBe(true);
  }
  const { rows } = await sql.query<{ id: string }>(`SELECT c.id FROM chats c WHERE ${buildInboxMarketingVisibilitySql()} ORDER BY c.id`);
  expect(rows.map(row => row.id)).toEqual(['atendimentos', 'encerrados']);
});

it('filters before pagination and counts so campaigns do not leave holes in the page', async () => {
  for (const id of ['a-campaign', 'b-normal', 'c-normal']) {
    const item = await chat(id, 'robo');
    await message(item, id === 'a-campaign' ? { campaignId: 'campaign' } : {});
  }
  const predicate = buildInboxMarketingVisibilitySql();
  const page = await sql.query<{ id: string }>(`SELECT c.id FROM chats c WHERE ${predicate} ORDER BY c.id LIMIT 2`);
  const count = await sql.query<{ total: number }>(`SELECT COUNT(*)::int AS total FROM chats c WHERE ${predicate}`);
  expect(page.rows.map(row => row.id)).toEqual(['b-normal', 'c-normal']);
  expect(count.rows[0].total).toBe(2);
});
