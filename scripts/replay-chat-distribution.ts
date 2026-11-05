import {config} from 'dotenv';
import {Client} from 'pg';
import {decideOpportunity, type OpportunityCandidate} from '../src/services/chat-distribution/policy';

config({quiet:true});
async function main() {
  const args=process.argv.slice(2);
  const workspaceId=args[args.indexOf('--workspace-id')+1];
  const days=Number(args.includes('--days')?args[args.indexOf('--days')+1]:7);
  if(!args.includes('--workspace-id') || !/^[0-9a-f-]{36}$/i.test(workspaceId) || !Number.isInteger(days) || days<1 || days>30)
    throw new Error('Use --workspace-id <uuid> --days <1..30>. Read-only replay.');
  const client=new Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:8000});
  await client.connect();
  try {
    await client.query('BEGIN READ ONLY');
    await client.query("SET LOCAL statement_timeout='30s'");
    const {rows}=await client.query(`SELECT e.team_id,e.chat_id,e.selected_agent_id,e.created_at,e.candidate_snapshot,
      (e.created_at AT TIME ZONE COALESCE(w.timezone,'America/Sao_Paulo') - interval '6 hours')::date::text AS turn,
      CASE WHEN e.source='human_team_transfer' THEN actor.metadata->>'from_agent_id' ELSE NULL END AS actor_id
      FROM chat_assignment_events e JOIN workspaces w ON w.id=e.workspace_id
      LEFT JOIN LATERAL (SELECT m.metadata FROM messages m WHERE m.workspace_id=e.workspace_id AND m.chat_id=e.chat_id
        AND m.type='system' AND m.metadata->>'event'='transfer'
        AND m.metadata->>'to_agent_id'=e.selected_agent_id::text
        AND m.created_at BETWEEN e.created_at-interval '1 second' AND e.created_at+interval '10 seconds'
        ORDER BY ABS(EXTRACT(EPOCH FROM m.created_at-e.created_at)) LIMIT 1) actor ON TRUE
      WHERE e.workspace_id=$1 AND e.created_at>=clock_timestamp()-($2 * interval '1 day')
        AND jsonb_array_length(e.candidate_snapshot)>0 ORDER BY e.created_at,e.id`,[workspaceId,days]);
    const balances=new Map<string,number>();
    const teams:Record<string,{events:number;changed:number;actual:Record<string,number>;proposed:Record<string,number>}>={};
    let skipped=0;
    for(const event of rows) {
      if(!Array.isArray(event.candidate_snapshot)) {skipped++;continue;}
      const candidates:OpportunityCandidate[]=event.candidate_snapshot.map((candidate:OpportunityCandidate)=>({...candidate,
        balance:balances.get(`${event.turn}:${event.team_id}:${candidate.agentId}`) ?? 0}));
      const decision=decideOpportunity(candidates,{excludeAgentId:event.actor_id,now:new Date(event.created_at)});
      const team=teams[event.team_id]??={events:0,changed:0,actual:{},proposed:{}};
      team.events++;team.actual[event.selected_agent_id]=(team.actual[event.selected_agent_id]??0)+1;
      if(decision.selection) {
        const id=decision.selection.agentId;
        team.proposed[id]=(team.proposed[id]??0)+1;
        if(id!==event.selected_agent_id)team.changed++;
        for(const candidate of decision.candidates.filter(row=>row.reason==='eligible'))
          balances.set(`${event.turn}:${event.team_id}:${candidate.agentId}`,candidate.balanceAfter);
      }
    }
    await client.query('ROLLBACK');
    console.log(JSON.stringify({checkedAt:new Date().toISOString(),workspaceId,days,events:rows.length,skipped,teams,
      limitation:'Historical candidate loads follow actual assignments. This comparison does not simulate alternative customer response times or corrected historical message weights.'},null,2));
  } finally {await client.end();}
}
main().catch(error=>{console.error(error instanceof Error?error.message:String(error));process.exitCode=1;});
