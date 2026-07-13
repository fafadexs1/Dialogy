import { db } from '@/lib/db';
import { getSupabaseAdmin } from '@/lib/supabase';

export async function broadcastChatUpdate(
  workspaceId: string,
  chatId: string,
  updatedFields: Record<string, unknown>,
) {
  try {
    const topic = `workspace:${workspaceId}:chats`;
    await getSupabaseAdmin().channel(topic).httpSend('UPDATE', {
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
        COALESCE(system_team.id, human_team.id) AS team_id,
        COALESCE(system_team.name, human_team.name) AS team_name,
        COALESCE(system_team.color, human_team.color) AS team_color,
        sa.name AS assigned_system_agent_name,
        sa.avatar_url AS assigned_system_agent_avatar_url,
        sa.type AS assigned_system_agent_type
     FROM chats c
     LEFT JOIN users u ON u.id = c.agent_id
     LEFT JOIN system_agents sa ON sa.id = c.assigned_system_agent_id
     LEFT JOIN LATERAL (
       SELECT t.id, t.name, t.color
       FROM team_members tm
       JOIN teams t ON t.id = tm.team_id AND t.workspace_id = c.workspace_id
       WHERE tm.user_id = c.agent_id
       ORDER BY t.name ASC, t.id ASC
       LIMIT 1
     ) human_team ON TRUE
     LEFT JOIN teams system_team
       ON system_team.id = sa.team_id
      AND system_team.workspace_id = c.workspace_id
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
