import type { PoolClient } from 'pg';
import type { DistributionCandidate } from './fair-distribution';
import type { OpportunityCandidate } from './policy';
import { distributionMode } from './policy';
import { chatWorkloadSql } from './workload';
import { buildDistributionPresenceSql, DEFAULT_CAPACITY } from './team-availability';
import { getPresenceTtlSeconds, getPresenceRecentActivitySeconds } from '@/lib/presence';
const finiteNumber=(value:unknown,fallback:number)=>Number.isFinite(Number(value))?Number(value):fallback;
function mapCandidate(row: any): DistributionCandidate {
  return {
    agentId: row.agent_id,
    agentName: row.agent_name,
    teamId: row.team_id,
    teamName: row.team_name,
    capacity: Math.max(1, finiteNumber(row.capacity, DEFAULT_CAPACITY)),
    maxPortfolio: null,
    portfolioCount: Math.max(0, finiteNumber(row.portfolio_count, 0)),
    effectiveLoad: Math.max(0, finiteNumber(row.effective_load, 0)),
    fairnessScore:
      row.fairness_score === null || row.fairness_score === undefined
        ? null
        : finiteNumber(row.fairness_score, 0),
    lastAssignedAt: row.last_assigned_at ? new Date(row.last_assigned_at).toISOString() : null,
    onlineSince: row.online_since ? new Date(row.online_since).toISOString() : null,
  };
}

export async function readTeamCandidates(client: Pick<PoolClient,'query'>, input: {
  workspaceId:string;teamId:string;chatId?:string;lockedMemberIds?:string[];
}): Promise<OpportunityCandidate[]> {
  const mode = distributionMode(input.workspaceId);
  const ttlSeconds = getPresenceTtlSeconds();
  const recentActivitySeconds = getPresenceRecentActivitySeconds();
  const presenceSql = buildDistributionPresenceSql('uwp', '$3', '$5').replaceAll('NOW()', 'statement_timestamp()');

  const candidatesRes = await client.query(
    `
      SELECT
        u.id AS agent_id,
        u.full_name AS agent_name,
        t.id AS team_id,
        t.name AS team_name,
        COALESCE(ds.capacity, $4)::int AS capacity,
        CASE
          WHEN ds.fairness_window = (
            NOW() AT TIME ZONE COALESCE(w.timezone, 'America/Sao_Paulo') - interval '6 hours'
          )::date THEN ds.fairness_score
          ELSE NULL
        END AS fairness_score,
        (
          SELECT MAX(shared_state.last_assigned_at)
          FROM team_agent_distribution_state shared_state
          WHERE shared_state.workspace_id = t.workspace_id
            AND shared_state.user_id = u.id
        ) AS last_assigned_at,
        uwp.online_since,
        COALESCE(ds.accepting_assignments, TRUE) AS accepting,
        COALESCE(${presenceSql}, FALSE) AS present,
        CASE WHEN os.turn_date = (clock_timestamp() AT TIME ZONE COALESCE(w.timezone, 'America/Sao_Paulo') - interval '6 hours')::date
          THEN os.balance ELSE 0 END AS balance,
        incoming.weight AS incoming_load,
        (incoming_chat.agent_id = u.id AND incoming_chat.status = 'atendimentos') AS incoming_already_owned,
        COALESCE(workload.portfolio_count, 0)::int AS portfolio_count,
        COALESCE(workload.effective_load, 0)::numeric AS effective_load,
        COALESCE(workload.legacy_status_count,0)::int AS legacy_status_count
      FROM teams t
      JOIN workspaces w ON w.id = t.workspace_id
      JOIN team_members tm ON tm.team_id = t.id
      JOIN users u ON u.id = tm.user_id
      LEFT JOIN user_workspace_presence uwp
        ON uwp.user_id = u.id
       AND uwp.workspace_id = t.workspace_id
      LEFT JOIN team_agent_distribution_state ds
        ON ds.workspace_id = t.workspace_id
       AND ds.team_id = t.id
       AND ds.user_id = u.id
      LEFT JOIN opportunity_distribution_state os ON os.workspace_id = t.workspace_id
        AND os.team_id = t.id AND os.user_id = u.id AND os.phase = $7
      LEFT JOIN chats incoming_chat ON incoming_chat.id = $8 AND incoming_chat.workspace_id = t.workspace_id
      LEFT JOIN LATERAL (${chatWorkloadSql('incoming_chat')}) incoming ON TRUE
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*) AS portfolio_count,
          COALESCE(SUM(chat_load.weight), 0) AS effective_load, COUNT(*) FILTER (WHERE chat_load.legacy_status) AS legacy_status_count
        FROM chats assigned_chat
        LEFT JOIN LATERAL (${chatWorkloadSql()}) chat_load ON TRUE
        WHERE assigned_chat.workspace_id = t.workspace_id
          AND assigned_chat.agent_id = u.id
          AND assigned_chat.status = 'atendimentos'
      ) workload ON TRUE
      WHERE t.id = $1
        AND t.workspace_id = $2
        AND ($6::uuid[] IS NULL OR u.id = ANY($6::uuid[]))
      ORDER BY u.id
    `,
    [
      input.teamId,
      input.workspaceId,
      ttlSeconds,
      DEFAULT_CAPACITY,
      recentActivitySeconds,
      input.lockedMemberIds ?? null,
      mode,
      input.chatId ?? null,
    ]
  );

  const candidates: OpportunityCandidate[] = candidatesRes.rows.map(row => ({ ...mapCandidate(row),
    balance: Number(row.balance ?? 0), incomingLoad: input.chatId ? Math.max(1, Number(row.incoming_load ?? 1.25)) : 1.25,
    incomingAlreadyOwned: row.incoming_already_owned === true,
    availableReason: row.present === false ? 'offline' : row.accepting === false ? 'not_accepting' : undefined,
    legacyStatusCount: Number(row.legacy_status_count ?? 0),
  }));
  return candidates;
}
