import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
const bridge = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { query: bridge.query } }));
import { loadStudioConversationTurns, loadStudioOlderConversationPage } from '@/services/agent-studio/history';

let sql: PGlite;
beforeAll(async () => {
  sql = new PGlite();
  bridge.query.mockImplementation((query: string, args: unknown[]) => sql.query(query, args));
  await sql.exec(`CREATE TABLE chats(id text PRIMARY KEY,workspace_id text);
    CREATE TABLE messages(id text PRIMARY KEY,chat_id text,workspace_id text,created_at timestamptz,type text,metadata jsonb,content text,from_me boolean);
    INSERT INTO chats VALUES ('chat','workspace'),('other','workspace'),('foreign','foreign-workspace');
    INSERT INTO messages SELECT lpad(i::text,4,'0'),'chat','workspace', '2026-01-01'::timestamptz+i*interval '1 minute','text','{}',
      CASE WHEN i=1 THEN 'Escolho 700 sem mesh' ELSE 'Mensagem '||i END,false FROM generate_series(1,165) i;
    INSERT INTO messages VALUES
      ('note','chat','workspace','2026-01-01 00:02:30','text','{"isInternalNote":true}','Nota privada',false),
      ('system','chat','workspace','2026-01-01 00:02:30','system','{}','Sistema',false),
      ('other-message','other','workspace','2026-01-01 00:02:30','text','{}','Outro contato',false),
      ('foreign-message','foreign','foreign-workspace','2026-01-01 00:02:30','text','{}','Outro workspace',false);
    ALTER TABLE messages ADD COLUMN api_message_status text DEFAULT 'RECEIVED';`);
}, 30000);
afterAll(async () => { await sql?.close(); });

describe('old conversation recovery through real isolated PostgreSQL', () => {
  it('reaches a choice beyond the 80-turn window without future messages, private notes or duplicates', async () => {
    const recent = await loadStudioConversationTurns('workspace','chat','0164',true);
    expect(recent).toHaveLength(80);
    let cursor: string | null = recent[0].messageId!;
    const all = [...recent];
    while (cursor) {
      const page = await loadStudioOlderConversationPage('workspace','chat','0164',cursor);
      all.unshift(...page.sources);
      cursor = page.nextCursor;
    }
    expect(all).toHaveLength(163);
    expect(new Set(all.map((turn) => turn.messageId)).size).toBe(163);
    expect(all[0]).toMatchObject({ content: 'Escolho 700 sem mesh', messageId: '0001', fromMe: false });
    expect(all.at(-1)?.messageId).toBe('0163');
  });
  it('rejects cursors and source messages belonging to other chats or workspaces', async () => {
    for (const boundary of ['other-message','foreign-message','missing']) {
      expect((await loadStudioOlderConversationPage('workspace','chat','0164',boundary)).sources).toEqual([]);
    }
    expect((await loadStudioOlderConversationPage('workspace','chat','other-message','0164')).sources).toEqual([]);
    expect((await loadStudioOlderConversationPage('foreign-workspace','chat','0164','0080')).sources).toEqual([]);
  });
});
