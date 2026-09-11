import 'server-only';
import { db } from '@/lib/db';

function historyContent(row: Record<string, any>): string {
  const content = typeof row.content === 'string' ? row.content : '';
  const product = row.metadata?.studioPresentedProduct;
  if (row.from_me !== true || row.type !== 'image' || !['SENT', 'DELIVERED', 'READ', 'PLAYED'].includes(row.api_message_status)
    || typeof row.metadata?.studioOperationId !== 'string' || !product
    || !['string', 'number'].includes(typeof product.productId) || typeof product.caption !== 'string') return content;
  const reference = JSON.stringify({ productId: product.productId, caption: product.caption.slice(0, 500), deliveryStatus: row.api_message_status });
  return `${content}\n[Registro de foto enviada pelo agente; não representa escolha do cliente: ${reference}]`;
}

/** Cursor is a message in this chat, constrained to the turn being answered. */
export async function loadStudioOlderConversationPage(workspaceId: string, chatId: string, sourceMessageId: string, beforeMessageId: string) {
  const result = await db.query(`SELECT LEFT(m.content,16000) AS content, m.from_me, m.id, m.type, m.api_message_status, m.metadata
    FROM messages m JOIN chats c ON c.id=m.chat_id AND c.workspace_id=m.workspace_id
    JOIN messages source ON source.id=$3 AND source.chat_id=c.id AND source.workspace_id=c.workspace_id
    JOIN messages boundary ON boundary.id=$4 AND boundary.chat_id=c.id AND boundary.workspace_id=c.workspace_id
    WHERE c.workspace_id=$1 AND c.id=$2 AND m.workspace_id=$1
      AND (m.created_at,m.id)<(source.created_at,source.id)
      AND (m.created_at,m.id)<(boundary.created_at,boundary.id)
      AND m.type<>'system' AND COALESCE(m.metadata->>'isInternalNote','false')<>'true'
      AND m.content IS NOT NULL
    ORDER BY m.created_at DESC,m.id DESC LIMIT 41`, [workspaceId, chatId, sourceMessageId, beforeMessageId]);
  const rows = result.rows.slice(0, 40);
  return { sources: [...rows].reverse().map((row) => ({ content: historyContent(row), fromMe: row.from_me === true, messageId: String(row.id) })),
    nextCursor: result.rows.length > 40 ? String(rows.at(-1)!.id) : null };
}

/** Bound history to tenant, chat and source message; never include private notes or future turns. */
export async function loadStudioConversationTurns(workspaceId: string, chatId: string, messageId: string, includeMessageIds = false): Promise<Array<{ content: string; fromMe: boolean; messageId?: string }>> {
  const result = await db.query(`SELECT content, from_me, id, type, api_message_status, metadata FROM (
    SELECT LEFT(m.content, 16000) AS content, m.from_me, m.created_at, m.id, m.type, m.api_message_status, m.metadata
    FROM messages m JOIN chats c ON c.id=m.chat_id AND c.workspace_id=m.workspace_id
    JOIN messages source ON source.id=$3 AND source.chat_id=c.id AND source.workspace_id=c.workspace_id
    WHERE c.workspace_id=$1 AND c.id=$2 AND m.workspace_id=$1
      AND (m.created_at,m.id)<(source.created_at,source.id)
      AND m.type<>'system' AND COALESCE(m.metadata->>'isInternalNote','false')<>'true'
      AND m.content IS NOT NULL
    ORDER BY m.created_at DESC,m.id DESC LIMIT 80
  ) recent ORDER BY created_at,id`, [workspaceId, chatId, messageId]);
  return result.rows.filter((row) => typeof row.content === 'string').map((row) => ({ content: historyContent(row), fromMe: row.from_me === true,
    ...(includeMessageIds && typeof row.id === 'string' ? { messageId: row.id } : {}) }));
}

export async function loadStudioConversationHistory(workspaceId: string, chatId: string, messageId: string): Promise<string> {
  return (await loadStudioConversationTurns(workspaceId, chatId, messageId)).map((turn) => `${turn.fromMe ? 'Agente' : 'Cliente'}: ${turn.content}`).join('\n');
}
