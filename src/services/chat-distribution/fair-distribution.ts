import type { PoolClient } from 'pg';

import { getPresenceTtlSeconds } from '@/lib/presence';

export type DistributionCandidate = {
  agentId: string;
  agentName: string;
  teamId: string;
  teamName: string;
  capacity: number;
  maxPortfolio: number;
  portfolioCount: number;
  effectiveLoad: number;
  fairnessScore: number | null;
  lastAssignedAt: string | null;
};

export type FairAgentSelection = DistributionCandidate & {
  occupancy: number;
  fairnessScoreBefore: number;
  fairnessScoreAfter: number;
};

type SelectFairAgentInput = {
  workspaceId: string;
  teamId: string;
  chatId: string;
  source: string;
  excludeAgentId?: string | null;
};

const DEFAULT_CAPACITY = 6;
const DEFAULT_MAX_PORTFOLIO = 25;
const LOAD_EPSILON = 0.000_001;

function finiteNumber(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

export function rankDistributionCandidates(
  candidates: DistributionCandidate[],
  excludeAgentId?: string | null
): FairAgentSelection | null {
  const eligible = candidates.filter((candidate) => {
    const capacity = Math.max(1, finiteNumber(candidate.capacity, DEFAULT_CAPACITY));
    const maxPortfolio = Math.max(1, finiteNumber(candidate.maxPortfolio, DEFAULT_MAX_PORTFOLIO));
    return candidate.portfolioCount < maxPortfolio && candidate.effectiveLoad < capacity;
  });

  if (eligible.length === 0) return null;

  const persistedScores = eligible
    .map((candidate) => candidate.fairnessScore)
    .filter((score): score is number => score !== null && Number.isFinite(score));
  // A late arrival starts at the team's median instead of zero. This provides a
  // neutral entry point: no starvation and no burst of assignments on login.
  const neutralEntryScore = median(persistedScores);
  const hasAlternativeToExcluded = Boolean(
    excludeAgentId && eligible.some((candidate) => candidate.agentId !== excludeAgentId)
  );

  const ranked = eligible
    .filter((candidate) => !hasAlternativeToExcluded || candidate.agentId !== excludeAgentId)
    .map((candidate) => {
      const capacity = Math.max(1, finiteNumber(candidate.capacity, DEFAULT_CAPACITY));
      const fairnessScoreBefore = candidate.fairnessScore ?? neutralEntryScore;
      return {
        ...candidate,
        capacity,
        maxPortfolio: Math.max(1, finiteNumber(candidate.maxPortfolio, DEFAULT_MAX_PORTFOLIO)),
        portfolioCount: Math.max(0, finiteNumber(candidate.portfolioCount, 0)),
        effectiveLoad: Math.max(0, finiteNumber(candidate.effectiveLoad, 0)),
        fairnessScoreBefore,
        fairnessScoreAfter: fairnessScoreBefore + 1 / capacity,
        occupancy: Math.max(0, finiteNumber(candidate.effectiveLoad, 0)) / capacity,
      };
    })
    .sort((left, right) => {
      const occupancyDelta = left.occupancy - right.occupancy;
      if (Math.abs(occupancyDelta) > LOAD_EPSILON) return occupancyDelta;

      const fairnessDelta = left.fairnessScoreBefore - right.fairnessScoreBefore;
      if (Math.abs(fairnessDelta) > LOAD_EPSILON) return fairnessDelta;

      const leftLastAssigned = left.lastAssignedAt ? new Date(left.lastAssignedAt).getTime() : 0;
      const rightLastAssigned = right.lastAssignedAt ? new Date(right.lastAssignedAt).getTime() : 0;
      if (leftLastAssigned !== rightLastAssigned) return leftLastAssigned - rightLastAssigned;

      return left.agentId.localeCompare(right.agentId);
    });

  return ranked[0] ?? null;
}

function mapCandidate(row: any): DistributionCandidate {
  return {
    agentId: row.agent_id,
    agentName: row.agent_name,
    teamId: row.team_id,
    teamName: row.team_name,
    capacity: Math.max(1, finiteNumber(row.capacity, DEFAULT_CAPACITY)),
    maxPortfolio: Math.max(1, finiteNumber(row.max_portfolio, DEFAULT_MAX_PORTFOLIO)),
    portfolioCount: Math.max(0, finiteNumber(row.portfolio_count, 0)),
    effectiveLoad: Math.max(0, finiteNumber(row.effective_load, 0)),
    fairnessScore:
      row.fairness_score === null || row.fairness_score === undefined
        ? null
        : finiteNumber(row.fairness_score, 0),
    lastAssignedAt: row.last_assigned_at ? new Date(row.last_assigned_at).toISOString() : null,
  };
}

export async function selectFairAgentForTeam(
  client: PoolClient,
  input: SelectFairAgentInput
): Promise<FairAgentSelection | null> {
  // Serializing by workspace/team makes selection + assignment atomic while the
  // caller's transaction is open. Concurrent requests see the committed load.
  await client.query(
    `SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))`,
    [input.workspaceId, input.teamId]
  );

  const ttlSeconds = getPresenceTtlSeconds();
  const candidatesRes = await client.query(
    `
      SELECT
        u.id AS agent_id,
        u.full_name AS agent_name,
        t.id AS team_id,
        t.name AS team_name,
        COALESCE(ds.capacity, $4)::int AS capacity,
        COALESCE(ds.max_portfolio, $5)::int AS max_portfolio,
        CASE
          WHEN ds.fairness_window = (
            NOW() AT TIME ZONE COALESCE(w.timezone, 'America/Sao_Paulo') - interval '6 hours'
          )::date THEN ds.fairness_score
          ELSE NULL
        END AS fairness_score,
        ds.last_assigned_at,
        COALESCE(workload.portfolio_count, 0)::int AS portfolio_count,
        COALESCE(workload.effective_load, 0)::numeric AS effective_load
      FROM teams t
      JOIN workspaces w ON w.id = t.workspace_id
      JOIN team_members tm ON tm.team_id = t.id
      JOIN users u ON u.id = tm.user_id
      JOIN user_workspace_presence uwp
        ON uwp.user_id = u.id
       AND uwp.workspace_id = t.workspace_id
      LEFT JOIN team_agent_distribution_state ds
        ON ds.workspace_id = t.workspace_id
       AND ds.team_id = t.id
       AND ds.user_id = u.id
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*) AS portfolio_count,
          COALESCE(SUM(
            CASE
              WHEN latest.created_at IS NULL THEN 0.05
              WHEN latest.from_me = FALSE THEN
                CASE
                  WHEN latest.created_at >= NOW() - interval '10 minutes' THEN 1.25
                  ELSE 1.00
                END
              WHEN latest.created_at >= NOW() - interval '10 minutes' THEN 0.25
              WHEN latest.created_at >= NOW() - interval '30 minutes' THEN 0.15
              ELSE 0.05
            END
          ), 0) AS effective_load
        FROM chats assigned_chat
        LEFT JOIN LATERAL (
          SELECT m.from_me, m.created_at
          FROM messages m
          WHERE m.chat_id = assigned_chat.id
            AND m.workspace_id = assigned_chat.workspace_id
            AND m.type <> 'system'
          ORDER BY m.created_at DESC, m.id DESC
          LIMIT 1
        ) latest ON TRUE
        WHERE assigned_chat.workspace_id = t.workspace_id
          AND assigned_chat.agent_id = u.id
          AND assigned_chat.status = 'atendimentos'
      ) workload ON TRUE
      WHERE t.id = $1
        AND t.workspace_id = $2
        AND COALESCE(ds.accepting_assignments, TRUE) = TRUE
        AND uwp.is_online = TRUE
        AND uwp.last_seen > NOW() - ($3 * interval '1 second')
      ORDER BY u.id
    `,
    [input.teamId, input.workspaceId, ttlSeconds, DEFAULT_CAPACITY, DEFAULT_MAX_PORTFOLIO]
  );

  const candidates = candidatesRes.rows.map(mapCandidate);
  const selected = rankDistributionCandidates(candidates, input.excludeAgentId);
  if (!selected) return null;

  await client.query(
    `
      INSERT INTO team_agent_distribution_state (
        workspace_id,
        team_id,
        user_id,
        capacity,
        max_portfolio,
        fairness_score,
        fairness_window,
        last_assigned_at,
        updated_at
      ) VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        (NOW() AT TIME ZONE COALESCE(
          (SELECT timezone FROM workspaces WHERE id = $1),
          'America/Sao_Paulo'
        ) - interval '6 hours')::date,
        clock_timestamp(),
        clock_timestamp()
      )
      ON CONFLICT (workspace_id, team_id, user_id)
      DO UPDATE SET
        fairness_score = EXCLUDED.fairness_score,
        fairness_window = EXCLUDED.fairness_window,
        last_assigned_at = EXCLUDED.last_assigned_at,
        updated_at = EXCLUDED.updated_at
    `,
    [
      input.workspaceId,
      input.teamId,
      selected.agentId,
      selected.capacity,
      selected.maxPortfolio,
      selected.fairnessScoreAfter,
    ]
  );

  await client.query(
    `
      INSERT INTO chat_assignment_events (
        workspace_id,
        chat_id,
        team_id,
        selected_agent_id,
        source,
        effective_load_before,
        portfolio_count_before,
        capacity,
        fairness_score_before,
        fairness_score_after,
        candidate_snapshot,
        decision_reason
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12)
    `,
    [
      input.workspaceId,
      input.chatId,
      input.teamId,
      selected.agentId,
      input.source,
      selected.effectiveLoad,
      selected.portfolioCount,
      selected.capacity,
      selected.fairnessScoreBefore,
      selected.fairnessScoreAfter,
      JSON.stringify(candidates),
      'lowest_effective_occupancy_then_fairness_then_idle_time',
    ]
  );

  return selected;
}
