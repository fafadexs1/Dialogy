import 'server-only';
import { db } from '@/lib/db';
import { broadcastHydratedChatUpdate } from '@/lib/realtime/chat-broadcast';

// Only customer-facing messages reset the clock. The automatic notice itself
// is excluded so the same inactivity episode cannot send a second notice.
const lastActivity = `GREATEST(c.created_at, COALESCE(c.assigned_at,c.created_at), COALESCE(latest.created_at,c.created_at))`;
const membership = `EXISTS (SELECT 1 FROM workspaces w LEFT JOIN users u ON u.id=c.agent_id LEFT JOIN user_workspace_roles r ON r.user_id=c.agent_id AND r.workspace_id=w.id WHERE w.id=c.workspace_id AND (w.owner_id=c.agent_id OR r.user_id IS NOT NULL OR COALESCE(u.is_superadmin,false)))`;
const latestJoin = `LEFT JOIN LATERAL (SELECT m.created_at FROM messages m
  WHERE m.chat_id=c.id AND m.workspace_id=c.workspace_id AND m.type <> 'system'
  AND LOWER(COALESCE(m.api_message_status,'')) <> 'internal'
  AND COALESCE(m.metadata->>'isInternalNote','false') <> 'true'
  AND COALESCE(m.metadata->>'event','') <> 'personal_inactivity_notice'
  ORDER BY m.created_at DESC, m.id DESC LIMIT 1) latest ON true`;

export async function claimDueInactivity() {
  const result=await db.query(`WITH candidate AS (
    SELECT c.id AS chat_id,c.workspace_id,c.agent_id AS user_id,${lastActivity} AS anchor_at
    FROM agent_inactivity_settings s JOIN chats c ON c.workspace_id=s.workspace_id AND c.agent_id=s.user_id
    ${latestJoin}
    WHERE s.timeout_minutes > 0 AND c.status='atendimentos' AND ${membership}
      AND ${lastActivity} + s.timeout_minutes * interval '1 minute' <= clock_timestamp()
      AND NOT EXISTS (SELECT 1 FROM agent_inactivity_attempts a WHERE a.chat_id=c.id AND a.user_id=c.agent_id AND a.anchor_at=${lastActivity})
    ORDER BY ${lastActivity} ASC LIMIT 1
  ) INSERT INTO agent_inactivity_attempts(workspace_id,user_id,chat_id,anchor_at,status)
    SELECT workspace_id,user_id,chat_id,anchor_at,'sending' FROM candidate
    ON CONFLICT(chat_id,user_id,anchor_at) DO NOTHING
    RETURNING id,workspace_id,user_id,chat_id,anchor_at::text`, []);
  return result.rows[0] as {id:string;workspace_id:string;user_id:string;chat_id:string;anchor_at:string}|undefined;
}
async function validAttempt(attempt: NonNullable<Awaited<ReturnType<typeof claimDueInactivity>>>) {
  const result=await db.query(`SELECT s.message FROM chats c JOIN agent_inactivity_settings s ON s.workspace_id=c.workspace_id AND s.user_id=c.agent_id
    ${latestJoin} WHERE c.id=$1 AND c.workspace_id=$2 AND c.agent_id=$3 AND c.status='atendimentos'
      AND s.timeout_minutes>0 AND ${membership} AND ${lastActivity}=$4::timestamptz
      AND ${lastActivity} + s.timeout_minutes * interval '1 minute' <= clock_timestamp()`,
    [attempt.chat_id,attempt.workspace_id,attempt.user_id,attempt.anchor_at]);
  return result.rows[0] as {message:string}|undefined;
}
async function mark(id:string,status:'sent'|'cancelled'|'failed') {
  await db.query("UPDATE agent_inactivity_attempts SET status=$2,updated_at=clock_timestamp() WHERE id=$1 AND status IN ('sending','sent')",[id,status]);
}
export async function processInactivityAttempt(attempt: NonNullable<Awaited<ReturnType<typeof claimDueInactivity>>>, alreadySent=false) {
  const settings=await validAttempt(attempt);
  if (!settings) { await mark(attempt.id,'cancelled'); return; }
  if (!alreadySent && settings.message.trim()) {
    try {
      const {sendAutomatedMessageAction}=await import('@/actions/messages');
      const result=await sendAutomatedMessageAction(attempt.chat_id,settings.message,attempt.user_id,false,undefined,{
        event:'personal_inactivity_notice', skipUserSignature:true, deliveryGuarantee:'ordered', nexusDeliveryId:`inactivity:${attempt.id}`,
      });
      if (!result.success || !result.providerAccepted) { await mark(attempt.id,'failed'); return; }
    } catch (error) {
      // A timeout can mean the provider accepted the notice. Do not blindly retry.
      console.error('[INACTIVITY] Envio não confirmado', error);
      await mark(attempt.id,'failed'); return;
    }
  }
  if (!alreadySent) await mark(attempt.id,'sent');
  const client=await db.connect();
  try {
    await client.query('BEGIN');
    const update=await client.query(`UPDATE chats c SET status='encerrados',closed_at=clock_timestamp(),assigned_at=NULL,
      assigned_system_agent_id=NULL,is_autopilot_active=false,copilot_mode='off',updated_at=clock_timestamp()
      FROM agent_inactivity_settings s WHERE c.id=$1 AND c.workspace_id=$2 AND c.agent_id=$3 AND c.status='atendimentos'
      AND s.workspace_id=c.workspace_id AND s.user_id=c.agent_id AND s.timeout_minutes>0 AND ${membership}
      AND GREATEST(c.created_at, COALESCE(c.assigned_at,c.created_at),COALESCE((SELECT m.created_at FROM messages m
        WHERE m.chat_id=c.id AND m.workspace_id=c.workspace_id AND m.type<>'system'
        AND LOWER(COALESCE(m.api_message_status,''))<>'internal' AND COALESCE(m.metadata->>'isInternalNote','false')<>'true'
        AND COALESCE(m.metadata->>'event','')<>'personal_inactivity_notice' ORDER BY m.created_at DESC,m.id DESC LIMIT 1),c.created_at))=$4::timestamptz
      AND $4::timestamptz+s.timeout_minutes*interval '1 minute'<=clock_timestamp()
      RETURNING c.id`,[attempt.chat_id,attempt.workspace_id,attempt.user_id,attempt.anchor_at]);
    if (!update.rowCount) {await client.query("UPDATE agent_inactivity_attempts SET status='cancelled',updated_at=clock_timestamp() WHERE id=$1 AND status='sent'",[attempt.id]);await client.query('COMMIT');return;}
    await client.query("UPDATE meta_conversations SET status='closed',updated_at=clock_timestamp() WHERE chat_id=$1",[attempt.chat_id]);
    await client.query("UPDATE workflow_executions SET status='cancelled',updated_at=clock_timestamp() WHERE workspace_id=$1 AND (conversation_id=$2 OR session_id=$2) AND status IN ('waiting','queued')",[attempt.workspace_id,attempt.chat_id]);
    await client.query(`INSERT INTO messages(workspace_id,chat_id,type,content,from_me,is_read,metadata) VALUES($1,$2,'system',$3,true,true,$4)`,[attempt.workspace_id,attempt.chat_id,'Atendimento encerrado automaticamente por inatividade.',{event:'personal_inactivity_close',closed_by:attempt.user_id,attemptId:attempt.id}]);
    await client.query("UPDATE agent_inactivity_attempts SET status='closed',updated_at=clock_timestamp() WHERE id=$1",[attempt.id]);
    await client.query('COMMIT');
    await broadcastHydratedChatUpdate(attempt.workspace_id,attempt.chat_id);
  } catch(error) {await client.query('ROLLBACK').catch(()=>undefined);throw error;} finally {client.release();}
}
export async function runDuePersonalInactivity(limit=20) {
  const pending=await db.query("SELECT id,workspace_id,user_id,chat_id,anchor_at::text FROM agent_inactivity_attempts WHERE status='sent' ORDER BY updated_at LIMIT $1",[limit]);
  for (const attempt of pending.rows) {
    try {await processInactivityAttempt(attempt,true);} catch(error) {console.error('[INACTIVITY] Falha ao retomar encerramento',error);}
  }
  for (let i=0;i<limit;i++) {
    const attempt=await claimDueInactivity();
    if (!attempt) break;
    try {await processInactivityAttempt(attempt);} catch(error) {console.error('[INACTIVITY] Falha ao processar',error);}
  }
}
