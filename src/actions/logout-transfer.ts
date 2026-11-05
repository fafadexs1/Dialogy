'use server';

import { z } from 'zod';
import { db } from '@/lib/db';
import { createClient } from '@/lib/supabase/server';
import { hasWorkspacePermission } from '@/lib/workspace-permissions';
import { broadcastHydratedChatUpdate } from '@/lib/realtime/chat-broadcast';
import { transferChatAction } from '@/actions/chats';

async function identity() {
  const { data: { user } } = await (await createClient()).auth.getUser();
  if (!user) throw new Error('Entre na sua conta novamente.');
  const result = await db.query('SELECT last_active_workspace_id FROM users WHERE id=$1', [user.id]);
  const workspaceId = result.rows[0]?.last_active_workspace_id;
  if (!workspaceId || !await hasWorkspacePermission(user.id, workspaceId, 'inbox:access')) throw new Error('Workspace indisponível.');
  return { userId: user.id, workspaceId: String(workspaceId) };
}
export async function getLogoutTransferSettings() {
  const { userId, workspaceId } = await identity();
  const result = await db.query('SELECT enabled FROM logout_transfer_settings WHERE user_id=$1 AND workspace_id=$2', [userId, workspaceId]);
  return { enabled: Boolean(result.rows[0]?.enabled) };
}
export async function saveLogoutTransferSettings(input: {enabled: boolean}) {
  const { userId, workspaceId } = await identity();
  const { enabled } = z.object({ enabled: z.boolean() }).parse(input);
  if (enabled && !await hasWorkspacePermission(userId, workspaceId, 'teams:view')) throw new Error('Você não tem permissão para transferir conversas.');
  await db.query(`INSERT INTO logout_transfer_settings(workspace_id,user_id,enabled,destination,destination_id)
    VALUES($1,$2,$3,'same_team',NULL) ON CONFLICT(workspace_id,user_id) DO UPDATE
    SET enabled=EXCLUDED.enabled,destination='same_team',destination_id=NULL,updated_at=clock_timestamp()`, [workspaceId,userId,enabled]);
  return { success: true };
}

async function moveToQueue(workspaceId: string, userId: string, chatId: string, expectedTeamId: string | null) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const changed = await client.query(`UPDATE chats SET agent_id=NULL,assigned_at=NULL,assigned_system_agent_id=NULL,
      is_autopilot_active=false,copilot_mode='off',team_id=NULL,status='gerais',updated_at=clock_timestamp()
      WHERE id=$1 AND workspace_id=$2 AND agent_id=$3 AND status='atendimentos'
      AND team_id IS NOT DISTINCT FROM $4::uuid RETURNING id`, [chatId,workspaceId,userId,expectedTeamId]);
    if (!changed.rowCount) {
      const stillAssigned = await client.query(`SELECT 1 FROM chats WHERE id=$1 AND workspace_id=$2 AND agent_id=$3 AND status='atendimentos'`, [chatId,workspaceId,userId]);
      await client.query('ROLLBACK');
      if (stillAssigned.rowCount) throw new Error('A equipe da conversa mudou.');
      return false;
    }
    await client.query(`INSERT INTO messages(workspace_id,chat_id,type,content,from_me,is_read,metadata)
      VALUES($1,$2,'system','Atendimento devolvido à fila quando o responsável saiu da plataforma.',true,true,$3)`,
      [workspaceId,chatId,{event:'logout_transfer',from_agent_id:userId,destination:'queue'}]);
    await client.query('COMMIT');
    try { await broadcastHydratedChatUpdate(workspaceId,chatId); } catch(error) { console.error('[LOGOUT_TRANSFER] Falha no aviso da conversa',error); }
    return true;
  } catch(error) { await client.query('ROLLBACK').catch(()=>undefined); throw error; } finally { client.release(); }
}

export async function processLogoutTransferAction() {
  try {
    const { userId, workspaceId } = await identity();
    const settings = await getLogoutTransferSettings();
    if (!settings.enabled) return {success:true as const,transferred:0,queued:0};
    if (!await hasWorkspacePermission(userId,workspaceId,'teams:view')) return {success:false as const,error:'Você não tem permissão para transferir conversas. Desative a opção ou solicite acesso.'};
    // Prefer the conversation's team when the user belongs to it. For older
    // conversations without a matching team, use their sole team only; when
    // multiple teams make the choice ambiguous, return the chat to the queue.
    const chats = await db.query(`SELECT c.id,c.assigned_at,c.team_id AS original_team_id,
      CASE WHEN c.team_id=ANY(memberships.team_ids) THEN c.team_id
           WHEN cardinality(memberships.team_ids)=1 THEN memberships.team_ids[1]
           ELSE NULL END AS destination_team_id
      FROM chats c LEFT JOIN LATERAL (
        SELECT COALESCE(array_agg(DISTINCT t.id),ARRAY[]::uuid[]) AS team_ids
        FROM team_members tm JOIN teams t ON t.id=tm.team_id
        WHERE tm.user_id=c.agent_id AND t.workspace_id=c.workspace_id
      ) memberships ON true
      WHERE c.workspace_id=$1 AND c.agent_id=$2 AND c.status='atendimentos' ORDER BY c.id LIMIT 501`, [workspaceId,userId]);
    if (chats.rows.length>500) return {success:false as const,error:'Há mais de 500 conversas atribuídas. Transfira uma parte em lote antes de sair.'};
    let transferred=0,queued=0,failed=0;
    for (const row of chats.rows) {
      try {
        let fallback = !row.destination_team_id;
        if (row.destination_team_id) {
          const result = await transferChatAction({chatId:row.id,teamId:row.destination_team_id,operationId:`logout:${row.id}:${String(row.assigned_at)}`,expectedAgentId:userId,
            expectedTeamId:row.original_team_id || null,sourceTeamId:row.destination_team_id,suppressTransferNotice:true});
          if (result.success) { transferred++; continue; }
          if (result.error==='O responsável pela conversa mudou. Atualize a lista.') continue;
          fallback = Boolean(result.reasonCode && result.reasonCode !== 'available');
          if (!fallback) { failed++; continue; }
        }
        if (fallback && await moveToQueue(workspaceId,userId,row.id,row.original_team_id || null)) queued++;
      } catch { failed++; }
    }
    if (failed) return {success:false as const,error:`${failed} conversa(s) não puderam ser transferidas. Atualize o Inbox antes de sair.`,transferred,queued};
    return {success:true as const,transferred,queued};
  } catch(error) { console.error('[LOGOUT_TRANSFER] Falha',error); return {success:false as const,error:'Não foi possível verificar a transferência automática. Tente novamente.'}; }
}
