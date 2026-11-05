import 'server-only';
import type {PoolClient} from 'pg';
import { db } from '@/lib/db';
import { lockWorkspaceAssignments } from './transfer-operation';
import { recordDirectAssignment, resolveAgentTeam } from './direct-assignment';

export async function claimQueueChat(workspaceId: string, chatId: string, userId: string, name: string, allowUnassignedAi = false, existingClient?:PoolClient) {
  const client = existingClient ?? await db.connect();
  try {
    await client.query('BEGIN');
    await lockWorkspaceAssignments(client,workspaceId);
    const {rows}=await client.query(`SELECT c.agent_id,
      CASE WHEN EXISTS(SELECT 1 FROM team_members tm WHERE tm.team_id=c.team_id AND tm.user_id=$3)
        THEN c.team_id ELSE NULL END AS team_id
      FROM chats c WHERE c.workspace_id=$1 AND c.id=$2 AND
        (c.status='gerais' OR ($4::boolean AND c.agent_id IS NULL AND c.status<>'encerrados'))
        FOR UPDATE OF c`,[workspaceId,chatId,userId,allowUnassignedAi]);
    if (!rows[0]) throw new Error('Este atendimento não está mais na fila geral ou já foi assumido.');
    const teamId=await resolveAgentTeam(client,workspaceId,userId,rows[0].team_id);
    await recordDirectAssignment(client,{workspaceId,chatId,agentId:userId,teamId,
      currentAgentId:null,source:'self_assignment'});
    await client.query(`UPDATE chats SET agent_id=$1,assigned_system_agent_id=NULL,is_autopilot_active=FALSE,
      copilot_mode='off',status='atendimentos',assigned_at=clock_timestamp(),updated_at=clock_timestamp(),team_id=$3
      WHERE id=$2`,[userId,chatId,teamId]);
    const message=await client.query(`INSERT INTO messages(workspace_id,chat_id,type,content,from_me,sender_user_id,created_at,is_read)
      VALUES($1,$2,'system',$3,true,$4,clock_timestamp(),true) RETURNING id,created_at`,
      [workspaceId,chatId,`Atendimento iniciado por ${name}.`,userId]);
    await client.query('COMMIT');
    return message;
  } catch(error) {await client.query('ROLLBACK').catch(()=>undefined);throw error;}
  finally {if(!existingClient)client.release();}
}
