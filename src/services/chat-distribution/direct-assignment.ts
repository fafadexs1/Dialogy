import type { PoolClient } from 'pg';
import { distributionMode, DISTRIBUTION_POLICY_VERSION } from './policy';
import { chatWorkloadSql } from './workload';

export async function resolveAgentTeam(client: PoolClient,workspaceId:string,agentId:string,currentTeamId:string|null) {
  const {rows}=await client.query(`SELECT id FROM (
    SELECT t.id,COUNT(*) OVER() AS memberships FROM teams t JOIN team_members tm ON tm.team_id=t.id
    WHERE t.workspace_id=$1 AND tm.user_id=$2) membership
    WHERE id=$3 OR memberships=1 ORDER BY (id=$3) DESC NULLS LAST LIMIT 1`,[workspaceId,agentId,currentTeamId]);
  return (rows[0]?.id ?? null) as string|null;
}

/** Caller holds the workspace assignment lock, before taking chat/user locks. */
export async function recordDirectAssignment(client: PoolClient, input: {
  workspaceId: string; teamId: string | null; agentId: string; chatId: string;
  source: string; currentAgentId: string | null;
}) {
  const mode = distributionMode(input.workspaceId);
  await client.query('SELECT id FROM users WHERE id=$1 FOR NO KEY UPDATE', [input.agentId]);
  const { rows } = await client.query(`SELECT COALESCE(ds.capacity,6)::int AS capacity, workload.*,
    EXISTS(SELECT 1 FROM chats owned WHERE owned.id=$4 AND owned.workspace_id=$1 AND owned.agent_id=u.id AND owned.status='atendimentos') AS owns_chat,
    COALESCE((SELECT balance FROM opportunity_distribution_state os WHERE os.workspace_id=$1 AND os.team_id=$2
      AND os.user_id=u.id AND os.phase=$5 AND os.turn_date=(statement_timestamp() AT TIME ZONE COALESCE(
        (SELECT timezone FROM workspaces WHERE id=$1),'America/Sao_Paulo')-interval '6 hours')::date),0) AS balance
    FROM users u LEFT JOIN team_agent_distribution_state ds ON ds.workspace_id=$1 AND ds.team_id=$2 AND ds.user_id=u.id
    LEFT JOIN LATERAL (SELECT COUNT(*)::int AS portfolio_count, COALESCE(SUM(load.weight),0) AS effective_load
      FROM chats assigned_chat LEFT JOIN LATERAL (${chatWorkloadSql()}) load ON TRUE
      WHERE assigned_chat.workspace_id=$1 AND assigned_chat.agent_id=u.id AND assigned_chat.status='atendimentos') workload ON TRUE
    WHERE u.id=$3`, [input.workspaceId,input.teamId,input.agentId,input.chatId,mode]);
  const row = rows[0];
  if (!row) throw new Error('Atendente de destino não encontrado.');
  if (!input.teamId) return;
  const balanceBefore=Number(row.balance);
  const balanceAfter=mode!=='legacy'?Math.max(-1,balanceBefore-1):balanceBefore;
  if (mode !== 'legacy') await client.query(`INSERT INTO opportunity_distribution_state
    (workspace_id,team_id,user_id,phase,turn_date,balance) VALUES ($1,$2,$3,$4,
      (clock_timestamp() AT TIME ZONE COALESCE((SELECT timezone FROM workspaces WHERE id=$1),'America/Sao_Paulo') - interval '6 hours')::date,-1)
    ON CONFLICT (workspace_id,team_id,user_id,phase) DO UPDATE SET
      balance=GREATEST(-1,CASE WHEN opportunity_distribution_state.turn_date=EXCLUDED.turn_date
        THEN opportunity_distribution_state.balance ELSE 0 END - 1),
      turn_date=EXCLUDED.turn_date,updated_at=clock_timestamp()`, [input.workspaceId,input.teamId,input.agentId,mode]);
  await client.query(`INSERT INTO team_agent_distribution_state(workspace_id,team_id,user_id,last_assigned_at)
    VALUES($1,$2,$3,clock_timestamp()) ON CONFLICT(workspace_id,team_id,user_id)
    DO UPDATE SET last_assigned_at=EXCLUDED.last_assigned_at`, [input.workspaceId,input.teamId,input.agentId]);
  await client.query(`INSERT INTO chat_assignment_events(workspace_id,chat_id,team_id,selected_agent_id,source,
    effective_load_before,portfolio_count_before,capacity,fairness_score_before,fairness_score_after,candidate_snapshot,
    decision_reason,policy_version,decision_snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$12,$13,$11,'explicit_destination',$9,$10)`,
    [input.workspaceId,input.chatId,input.teamId,input.agentId,input.source,row.effective_load,row.portfolio_count,row.capacity,
      mode === 'active' ? DISTRIBUTION_POLICY_VERSION : 'legacy',JSON.stringify({phase:mode,version:DISTRIBUTION_POLICY_VERSION,assignmentType:input.currentAgentId?'transfer':'first_assignment',explicit:true,
        balanceBefore,balanceAfter,credit:0}),JSON.stringify([{agentId:input.agentId,portfolioCount:row.portfolio_count-(!input.currentAgentId && row.owns_chat?1:0),
          maxPortfolio:null,effectiveLoad:Number(row.effective_load),capacity:row.capacity,
          incomingAlreadyOwned:Boolean(row.owns_chat && input.currentAgentId)}]),balanceBefore,balanceAfter]);
}
