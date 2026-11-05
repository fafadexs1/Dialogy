import type { PoolClient } from 'pg';
import { readTeamCandidates } from './candidates';
import { decideOpportunity, distributionMode, DISTRIBUTION_POLICY_VERSION } from './policy';

export async function distributionDiagnostics(client: Pick<PoolClient,'query'>, workspaceId: string, teamId: string) {
  const candidates = await readTeamCandidates(client,{workspaceId,teamId});
  const preview = decideOpportunity(candidates);
  const events=await client.query(`SELECT e.selected_agent_id,e.chat_id,e.source,e.policy_version,e.decision_snapshot,e.created_at,
    (SELECT COUNT(*) FROM chat_transfer_operations op WHERE op.event_id=e.id AND op.workspace_id=e.workspace_id AND op.outcome='assigned') AS confirmed_operations
    FROM chat_assignment_events e JOIN workspaces w ON w.id=e.workspace_id
    WHERE e.workspace_id=$1 AND e.team_id=$2 AND e.created_at >=
      (((clock_timestamp() AT TIME ZONE COALESCE(w.timezone,'America/Sao_Paulo') - interval '6 hours')::date + time '06:00')
        AT TIME ZONE COALESCE(w.timezone,'America/Sao_Paulo')) ORDER BY e.created_at DESC,e.id DESC`,[workspaceId,teamId]);
  const repeats=await client.query(`SELECT COALESCE(SUM(replay_count),0)::int AS count FROM chat_transfer_operations
    WHERE workspace_id=$1 AND team_id=$2 AND created_at>=clock_timestamp()-interval '24 hours'`,[workspaceId,teamId]);
  return {mode:distributionMode(workspaceId),repeatedOperations24h:Number(repeats.rows[0]?.count ?? 0),
    members:candidates.map(candidate=>{
      const own=events.rows.filter(event=>event.selected_agent_id===candidate.agentId);
      const eligibility=(event:typeof events.rows[number]) => ['opportunity-v2',DISTRIBUTION_POLICY_VERSION].includes(event.policy_version) &&
        event.decision_snapshot?.candidates?.find((entry:{agentId:string})=>entry.agentId===candidate.agentId)?.reason==='eligible';
      let missed=0;
      for(const event of events.rows) {
        if(event.selected_agent_id===candidate.agentId || !eligibility(event)) break;
        missed++;
      }
      return {...candidate,decision:preview.candidates.find(row=>row.agentId===candidate.agentId),
        assignments:own.length,distinctChats:new Set(own.map(event=>event.chat_id)).size,
        eligibleOpportunities:events.rows.filter(eligibility).length,
        firstAssignments:own.filter(event=>event.decision_snapshot?.assignmentType==='first_assignment').length,
        transfers:own.filter(event=>event.decision_snapshot?.assignmentType==='transfer').length,
        missedConsecutive:missed,alert:distributionMode(workspaceId)==='active' && missed>=5};
    }),previewSelectedAgentId:preview.selection?.agentId ?? null};
}
