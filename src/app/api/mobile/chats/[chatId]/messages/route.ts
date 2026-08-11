import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { db } from '@/lib/db';
import { sendAgentMessageAction } from '@/actions/messages';
import { badRequest, requireMobileAuth } from '@/lib/mobile-api/auth';
import { inferChannel, mapMobileMessage } from '@/lib/mobile-api/mappers';

type Params = {
  params: Promise<{ chatId: string }>;
};

async function getAccessibleChat(chatId: string, userId: string) {
  const { rows } = await db.query(
    `
      SELECT
        c.id,
        c.workspace_id,
        c.instance_type,
        c.source,
        c.contact_id,
        cont.phone_number_jid,
        cont.phone_canonical,
        mc.platform AS meta_platform
      FROM chats c
      JOIN user_workspace_roles uwr
        ON uwr.workspace_id = c.workspace_id
       AND uwr.user_id = $2
      LEFT JOIN contacts cont ON cont.id = c.contact_id
      LEFT JOIN meta_conversations mc ON mc.chat_id = c.id
      WHERE c.id = $1
      LIMIT 1
    `,
    [chatId, userId],
  );

  return rows[0] ?? null;
}

export async function GET(request: NextRequest, { params }: Params) {
  const { chatId } = await params;
  const auth = await requireMobileAuth(request);
  if ('response' in auth) return auth.response;

  const chat = await getAccessibleChat(chatId, auth.context.user.id);
  if (!chat) return NextResponse.json({ error: 'Conversa nao encontrada.' }, { status: 404 });

  const before = request.nextUrl.searchParams.get('before');
  const beforeId = request.nextUrl.searchParams.get('beforeId');
  const limitParam = Number(request.nextUrl.searchParams.get('limit') || 40);
  const limit = Math.min(Math.max(Number.isFinite(limitParam) ? limitParam : 40, 1), 80);
  const queryLimit = limit + 1;
  const paramsList: Array<string | number> = [chatId, chat.workspace_id, queryLimit];
  let beforeClause = '';

  if (before && beforeId) {
    paramsList.push(before, beforeId);
    beforeClause = 'AND (m.created_at, m.id) < ($4::timestamptz, $5::uuid)';
  } else if (before) {
    paramsList.push(before);
    beforeClause = 'AND m.created_at < $4::timestamptz';
  }

  const { rows } = await db.query(
    `
      WITH target_chat AS (
        SELECT
          c.id,
          c.workspace_id,
          c.contact_id,
          cont.phone_canonical
        FROM chats c
        LEFT JOIN contacts cont ON cont.id = c.contact_id
        WHERE c.id = $1
          AND c.workspace_id = $2
      ),
      matching_contacts AS (
        SELECT c.id
        FROM contacts c
        JOIN target_chat tc ON tc.workspace_id = c.workspace_id
        WHERE c.id = tc.contact_id
        UNION
        SELECT c.id
        FROM contacts c
        JOIN target_chat tc ON tc.workspace_id = c.workspace_id
        WHERE tc.phone_canonical IS NOT NULL
          AND c.phone_canonical IS NOT NULL
          AND c.phone_canonical = tc.phone_canonical
      ),
      matching_chats AS (
        SELECT tc.id
        FROM target_chat tc
        UNION
        SELECT c.id
        FROM chats c
        JOIN target_chat tc ON tc.workspace_id = c.workspace_id
        WHERE c.contact_id IN (SELECT id FROM matching_contacts)
      )
      SELECT
        m.id,
        m.chat_id,
        m.workspace_id,
        m.content,
        m.type,
        m.created_at,
        m.from_me,
        m.instance_name,
        m.source_from_api,
        m.platform
      FROM messages m
      JOIN matching_chats mc ON mc.id = m.chat_id
      WHERE m.workspace_id = $2
      ${beforeClause}
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT $3
    `,
    paramsList,
  );

  const channel = inferChannel(chat);
  const pageRows = rows.slice(0, limit);
  const chronologicalRows = pageRows.reverse();
  const oldest = chronologicalRows[0];

  return NextResponse.json({
    messages: chronologicalRows
      .map((row) =>
        ({
          ...mapMobileMessage(
          {
            id: row.id,
            chat_id: chatId,
            workspace_id: row.workspace_id,
            content: row.content || '',
            type: row.type,
            createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
            updatedAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
            from_me: row.from_me,
            instance_name: row.instance_name || undefined,
            source_from_api: row.source_from_api || undefined,
            platform: row.platform || undefined,
          } as any,
          channel,
          ),
          originalChatId: row.chat_id,
        }),
      ),
    hasMore: rows.length > limit,
    oldestCursor: oldest
      ? {
          createdAt: oldest.created_at instanceof Date ? oldest.created_at.toISOString() : String(oldest.created_at),
          id: oldest.id,
        }
      : null,
  });
}

export async function POST(request: NextRequest, { params }: Params) {
  const { chatId } = await params;
  const auth = await requireMobileAuth(request);
  if ('response' in auth) return auth.response;

  const chat = await getAccessibleChat(chatId, auth.context.user.id);
  if (!chat) return NextResponse.json({ error: 'Conversa nao encontrada.' }, { status: 404 });

  const body = await request.json().catch(() => null);
  const content = typeof body?.content === 'string' ? body.content.trim() : '';
  if (!content) return badRequest('Conteudo obrigatorio.');

  const messageId = typeof body?.messageId === 'string' && body.messageId ? body.messageId : randomUUID();
  const result = await sendAgentMessageAction(chatId, content, 'mobile', messageId, auth.context.authUser);

  if (!result.success || !result.message) {
    return NextResponse.json({ error: result.error || 'Falha ao enviar mensagem.' }, { status: 500 });
  }

  return NextResponse.json(mapMobileMessage(result.message, inferChannel(chat)));
}
