import type {PoolClient} from 'pg';
import {relevantMessageSql} from './workload';

export async function distributionRolloutMetrics(client:Pick<PoolClient,'query'>,workspaceId:string,since:Date,until:Date) {
  const {rows}=await client.query(`WITH boundaries AS (
    SELECT $2::timestamptz AS start_at,$3::timestamptz AS end_at,'current' AS period
    UNION ALL SELECT
      (($2::timestamptz AT TIME ZONE COALESCE(timezone,'America/Sao_Paulo'))-interval '7 days') AT TIME ZONE COALESCE(timezone,'America/Sao_Paulo'),
      (($3::timestamptz AT TIME ZONE COALESCE(timezone,'America/Sao_Paulo'))-interval '7 days') AT TIME ZONE COALESCE(timezone,'America/Sao_Paulo'),'baseline'
    FROM workspaces WHERE id=$1
  ), receipts AS (
    SELECT b.period,e.*,response.created_at AS responded_at
    FROM boundaries b JOIN chat_assignment_events e ON e.created_at>=b.start_at AND e.created_at<b.end_at AND e.workspace_id=$1
    LEFT JOIN LATERAL (
      SELECT m.created_at FROM messages m WHERE m.workspace_id=e.workspace_id AND m.chat_id=e.chat_id
        AND m.sender_user_id=e.selected_agent_id AND m.from_me=TRUE AND ${relevantMessageSql()}
        AND m.created_at>=e.created_at AND m.created_at<LEAST(b.end_at,COALESCE((
          SELECT MIN(next.created_at) FROM chat_assignment_events next WHERE next.workspace_id=e.workspace_id
            AND next.chat_id=e.chat_id AND (next.created_at,next.id)>(e.created_at,e.id)
        ),b.end_at)) ORDER BY m.created_at,m.id LIMIT 1
    ) response ON TRUE
  ) SELECT b.period,COUNT(r.id)::int AS assignments,COUNT(r.responded_at)::int AS responded,
    COUNT(r.id) FILTER(WHERE r.responded_at IS NULL)::int AS unresponded,
    percentile_cont(.9) WITHIN GROUP(ORDER BY EXTRACT(EPOCH FROM r.responded_at-r.created_at)) AS p90_seconds,
    COUNT(r.id) FILTER(WHERE r.policy_version='opportunity-v2' AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(r.candidate_snapshot) candidate
      WHERE candidate->>'agentId'=r.selected_agent_id::text
        AND (candidate->>'portfolioCount')::numeric+CASE WHEN (candidate->>'incomingAlreadyOwned')::boolean THEN 0 ELSE 1 END
          >(candidate->>'maxPortfolio')::numeric
    ))::int AS portfolio_violations
  FROM boundaries b LEFT JOIN receipts r ON r.period=b.period GROUP BY b.period`,[workspaceId,since,until]);
  const current=rows.find(row=>row.period==='current');
  const baseline=rows.find(row=>row.period==='baseline');
  const enough=Number(current?.responded)>=30 && Number(baseline?.responded)>=30;
  const regressed=enough && Number(current.p90_seconds)>Number(baseline.p90_seconds)*1.1;
  // Keep v2 violations as historical evidence; the unlimited policy has no
  // portfolio ceiling, so those older counts cannot veto its rollout.
  return {periods:rows,minimumObservations:30,portfolioLimit:null,
    gate:regressed?'stop':enough?'review':'insufficient_volume',
    note:'Also review unresponded assignments, application assignment errors and integrity alerts. This report does not activate rollout.'};
}
