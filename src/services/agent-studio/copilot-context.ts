import 'server-only';
import { db } from '@/lib/db';
import type { Contact } from '@/lib/types';
import { AutopilotSourceSupersededError } from '@/services/autopilot/runtime/stale-source-guard';

type Scope = { workspaceId: string; chatId: string; agentId: string; messageId: string };

// This history includes the human's replies, even when regenerating for an older inbound message.
const visible = `COALESCE(m.type, '') <> 'system'
  AND COALESCE(m.metadata->>'isInternalNote', 'false') <> 'true'
  AND LOWER(COALESCE(m.api_message_status, '')) NOT IN ('internal', 'failed', 'error')`;

export async function loadStudioCopilotContext(scope: Scope) {
  const { rows } = await db.query(`SELECT m.id, m.from_me, LEFT(COALESCE(NULLIF(m.transcription, ''), m.content, ''), 16000) AS content
    FROM messages m JOIN chats c ON c.id = m.chat_id AND c.workspace_id = m.workspace_id
    WHERE c.id = $1 AND c.workspace_id = $2 AND ${visible}
    ORDER BY m.created_at DESC, m.id DESC LIMIT 80`, [scope.chatId, scope.workspaceId]);
  const contactResult = await db.query(`SELECT ct.id, ct.name FROM chats c
    JOIN contacts ct ON ct.id = c.contact_id AND ct.workspace_id = c.workspace_id
    WHERE c.id = $1 AND c.workspace_id = $2`, [scope.chatId, scope.workspaceId]);
  const anchorId = rows[0]?.id;
  const assertCurrent = async () => {
    const current = await db.query(`SELECT c.id FROM chats c
      JOIN autopilot_configs ac ON ac.id = c.autopilot_config_id AND ac.workspace_id = c.workspace_id AND ac.is_active = TRUE
      JOIN messages source ON source.id = $4 AND source.chat_id = c.id AND source.workspace_id = c.workspace_id AND source.from_me = FALSE
      WHERE c.id = $1 AND c.workspace_id = $2 AND c.autopilot_config_id = $3
        AND c.is_autopilot_active = TRUE AND c.copilot_mode = 'suggest' AND c.status <> 'encerrados'
        AND c.assigned_system_agent_id IS NULL
        AND (SELECT m.id FROM messages m WHERE m.chat_id = c.id AND m.workspace_id = c.workspace_id AND ${visible}
          ORDER BY m.created_at DESC, m.id DESC LIMIT 1) = $5
        AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.chat_id = c.id AND m.workspace_id = c.workspace_id
          AND m.from_me = FALSE AND ${visible} AND (m.created_at, m.id) > (source.created_at, source.id))`,
    [scope.chatId, scope.workspaceId, scope.agentId, scope.messageId, anchorId || null]);
    if (!current.rows.length) throw new AutopilotSourceSupersededError(scope.chatId, scope.messageId);
  };
  await assertCurrent();
  return { history: [...rows].reverse().map((row) => ({ messageId: String(row.id), content: String(row.content || ''), fromMe: row.from_me === true })),
    contact: (contactResult.rows[0] || {}) as Contact, assertCurrent };
}
