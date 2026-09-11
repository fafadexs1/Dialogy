import { PGlite } from '@electric-sql/pglite';
import type { PoolClient } from 'pg';
import { beforeEach, describe, expect, it } from 'vitest';

import { syncLegacyChatQueueTag } from '@/services/chat/chat-tag-routing-compat';

describe('chat tag queue routing compatibility', () => {
  let sql: PGlite;

  beforeEach(async () => {
    sql = new PGlite();
    await sql.exec(`
      CREATE TABLE chats (
        id uuid PRIMARY KEY,
        workspace_id uuid NOT NULL,
        tag text,
        color text,
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE tags (
        id uuid PRIMARY KEY,
        workspace_id uuid NOT NULL,
        label text NOT NULL,
        color text NOT NULL,
        is_close_reason boolean NOT NULL DEFAULT false,
        sort_order integer
      );
      CREATE TABLE chat_tags (
        chat_id uuid NOT NULL,
        tag_id uuid NOT NULL,
        workspace_id uuid NOT NULL,
        created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        PRIMARY KEY (chat_id, tag_id)
      );
    `);
  });

  it('moves a newly classified conversation from the Robot bucket to the queue bucket', async () => {
    const workspaceId = '00000000-0000-0000-0000-000000000001';
    const chatId = '00000000-0000-0000-0000-000000000002';
    const tagId = '00000000-0000-0000-0000-000000000003';
    await sql.query('INSERT INTO chats (id, workspace_id) VALUES ($1, $2)', [chatId, workspaceId]);
    await sql.query(
      'INSERT INTO tags (id, workspace_id, label, color) VALUES ($1, $2, $3, $4)',
      [tagId, workspaceId, 'Suporte', '#2563eb']
    );
    await sql.query(
      'INSERT INTO chat_tags (chat_id, tag_id, workspace_id) VALUES ($1, $2, $3)',
      [chatId, tagId, workspaceId]
    );

    await syncLegacyChatQueueTag(sql as unknown as Pick<PoolClient, 'query'>, {
      chatId,
      tagId,
      workspaceId,
    });

    const result = await sql.query<{ tag: string | null; color: string | null }>(
      'SELECT tag, color FROM chats WHERE id = $1',
      [chatId]
    );
    expect(result.rows[0]).toEqual({ tag: 'Suporte', color: '#2563eb' });
  });

  it('falls back to another classification, then clears the queue bucket when none remain', async () => {
    const workspaceId = '00000000-0000-0000-0000-000000000011';
    const chatId = '00000000-0000-0000-0000-000000000012';
    const firstTagId = '00000000-0000-0000-0000-000000000013';
    const secondTagId = '00000000-0000-0000-0000-000000000014';
    await sql.query('INSERT INTO chats (id, workspace_id, tag, color) VALUES ($1, $2, $3, $4)', [
      chatId,
      workspaceId,
      'Suporte',
      '#2563eb',
    ]);
    await sql.query(
      `INSERT INTO tags (id, workspace_id, label, color, sort_order)
       VALUES ($1, $3, 'Suporte', '#2563eb', 1), ($2, $3, 'Financeiro', '#16a34a', 2)`,
      [firstTagId, secondTagId, workspaceId]
    );
    await sql.query(
      `INSERT INTO chat_tags (chat_id, tag_id, workspace_id, created_at)
       VALUES ($1, $2, $4, now() - interval '1 minute'), ($1, $3, $4, now())`,
      [chatId, firstTagId, secondTagId, workspaceId]
    );

    await sql.query('DELETE FROM chat_tags WHERE chat_id = $1 AND tag_id = $2', [chatId, firstTagId]);
    await syncLegacyChatQueueTag(sql as unknown as Pick<PoolClient, 'query'>, {
      chatId,
      tagId: firstTagId,
      workspaceId,
    });
    let result = await sql.query<{ tag: string | null }>('SELECT tag FROM chats WHERE id = $1', [chatId]);
    expect(result.rows[0]?.tag).toBe('Financeiro');

    await sql.query('DELETE FROM chat_tags WHERE chat_id = $1', [chatId]);
    await syncLegacyChatQueueTag(sql as unknown as Pick<PoolClient, 'query'>, {
      chatId,
      tagId: secondTagId,
      workspaceId,
    });
    result = await sql.query<{ tag: string | null }>('SELECT tag FROM chats WHERE id = $1', [chatId]);
    expect(result.rows[0]?.tag).toBeNull();
  });
});
