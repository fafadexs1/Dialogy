import { db } from '@/lib/db';
import { buildChatTeamLateralSql } from '@/lib/chat-team-resolution';
import { broadcastRealtimeEvent } from '@/lib/realtime/broadcast';

export async function broadcastChatUpdate(
  workspaceId: string,
  chatId: string,
  updatedFields: Record<string, unknown>,
) {
  // Se o update não traz o status do chat, faz o broadcast hidratado completo
  // para garantir que clientes Realtime nunca recebam um payload esquelético
  // com status indefinido que caia no fallback incorreto.
  if (!updatedFields.status) {
    await broadcastHydratedChatUpdate(workspaceId, chatId);
    return;
  }

  try {
    const topic = `workspace:${workspaceId}:chats`;
    await broadcastRealtimeEvent(topic, 'UPDATE', {
        id: chatId,
        schema: 'public',
        table: 'chats',
        operation: 'UPDATE',
        record: {
          id: chatId,
          workspace_id: workspaceId,
          updated_at: new Date().toISOString(),
          ...updatedFields,
        },
        old_record: { id: chatId },
    });
  } catch (error) {
    console.error('[REALTIME-BROADCAST] Failed to broadcast chat update:', error);
  }
}

export async function broadcastHydratedChatUpdate(workspaceId: string, chatId: string) {
  try {
    const { rows } = await db.query(
      `SELECT
        c.status,
        c.contact_id,
        c.protocol,
        c.agent_id,
        c.assigned_system_agent_id,
        c.is_autopilot_active,
        c.autopilot_config_id,
        c.copilot_mode,
        c.assigned_at,
        c.closed_at,
        c.tag,
        c.color,
        u.full_name AS agent_name,
        u.avatar_url AS agent_avatar_url,
        t.id AS team_id,
        t.name AS team_name,
        t.color AS team_color,
        sa.name AS assigned_system_agent_name,
        sa.avatar_url AS assigned_system_agent_avatar_url,
        sa.type AS assigned_system_agent_type,
        ct.name AS contact_name,
        ct.phone AS contact_phone,
        ct.phone_number_jid AS contact_phone_number_jid,
        ct.avatar_url AS contact_avatar_url
     FROM chats c
     LEFT JOIN contacts ct ON ct.id = c.contact_id
     LEFT JOIN users u ON u.id = c.agent_id
     LEFT JOIN system_agents sa ON sa.id = c.assigned_system_agent_id
     ${buildChatTeamLateralSql({ chatAlias: 'c' })}
     WHERE c.id = $1 AND c.workspace_id = $2
     LIMIT 1`,
      [chatId, workspaceId],
    );

    if (rows[0]) {
      await broadcastChatUpdate(workspaceId, chatId, rows[0]);
    }
  } catch (error) {
    console.error('[REALTIME-BROADCAST] Failed to hydrate chat update:', error);
  }
}
