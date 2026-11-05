import 'server-only';
import { db } from '@/lib/db';

/** Latest public turns, in chronological order, from exactly one tenant/chat. */
export async function loadCaseMemoryTranscript(workspaceId: string, chatId: string): Promise<string> {
    const { rows } = await db.query(`SELECT content, from_me FROM (
        SELECT m.content, m.from_me, m.created_at, m.id
        FROM messages m
        JOIN chats c ON c.id = m.chat_id AND c.workspace_id = m.workspace_id
        WHERE c.workspace_id = $1 AND c.id = $2 AND m.workspace_id = $1
          AND m.type <> 'system'
          AND COALESCE(m.metadata->>'isInternalNote', 'false') <> 'true'
          AND m.content IS NOT NULL AND btrim(m.content) <> ''
        ORDER BY m.created_at DESC, m.id DESC LIMIT 120
    ) recent ORDER BY created_at, id`, [workspaceId, chatId]);
    return rows.map((row) => `${row.from_me ? 'Agente' : 'Cliente'}: ${row.content}`).join('\n');
}
