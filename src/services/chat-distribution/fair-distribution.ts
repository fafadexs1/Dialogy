import type { PoolClient } from 'pg';
import { decideOpportunity, distributionMode, DISTRIBUTION_POLICY_VERSION } from './policy';
import { readTeamCandidates } from './candidates';

import { getPresenceRecentActivitySeconds, getPresenceTtlSeconds } from '@/lib/presence';

import {
  buildDistributionPresenceSql,
  DEFAULT_CAPACITY,
  type TeamAvailabilityReason,
} from './team-availability';

export type DistributionCandidate = {
  agentId: string;
  agentName: string;
  teamId: string;
  teamName: string;
  capacity: number;
  /** Null means there is no conversation-count ceiling. Legacy snapshots may contain a number. */
  maxPortfolio: number | null;
  portfolioCount: number;
  effectiveLoad: number;
  fairnessScore: number | null;
  lastAssignedAt: string | null;
  onlineSince: string | null;
  balance?: number;
  incomingLoad?: number;
  incomingAlreadyOwned?: boolean;
  availableReason?: 'offline' | 'not_accepting';
  legacyStatusCount?: number;
};

export type FairAgentSelection = DistributionCandidate & {
  occupancy: number;
  fairnessScoreBefore: number;
  fairnessScoreAfter: number;
  /** True quando todo mundo já passou da capacidade e o chat foi para o menos ocupado. */
  overflow: boolean;
};

export type TeamDistributionResult = {
  selection: FairAgentSelection | null;
  reason: TeamAvailabilityReason;
  noOp?: boolean;
};

type SelectFairAgentInput = {
  workspaceId: string;
  teamId: string;
  chatId: string;
  source: string;
  currentAgentId?: string | null;
  currentTeamId?: string | null;
  excludeAgentId?: string | null;
  /**
   * Quando todos os agentes estão acima da capacidade sugerida, `true` (padrão)
   * entrega ao menos ocupado em vez de recusar a transferência.
   */
  allowOverflow?: boolean;
};

const LOAD_EPSILON = 0.000_001;
// History can decide among agents within ten percentage points of the least
// occupied agent, without sending work to a substantially busier colleague.
const OCCUPANCY_FAIRNESS_BAND = 0.10;
const ENTRY_WARMUP_MS = 5 * 60_000;
const ENTRY_ASSIGNMENT_INTERVAL_MS = 60_000;

function finiteNumber(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function capacityOf(candidate: DistributionCandidate): number {
  return Math.max(1, finiteNumber(candidate.capacity, DEFAULT_CAPACITY));
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

/**
 * Escolhe o agente que recebe o atendimento.
 *
 * A quantidade de conversas não impede atribuições. A capacidade é a carga
 * desejada; quando todos a ultrapassam, recebe o menos ocupado e a decisão é
 * registrada como overflow. Presença e pausa continuam definindo elegibilidade.
 */
export function rankDistributionCandidates(
  candidates: DistributionCandidate[],
  excludeAgentId?: string | null,
  options?: { allowOverflow?: boolean; now?: Date }
): FairAgentSelection | null {
  const allowOverflow = options?.allowOverflow ?? true;

  const available = candidates.filter((candidate) => !candidate.availableReason);
  if (available.length === 0) return null;

  const underCapacity = available.filter(
    (candidate) => candidate.effectiveLoad < capacityOf(candidate)
  );
  const overflow = underCapacity.length === 0;
  if (overflow && !allowOverflow) return null;

  const eligible = overflow ? available : underCapacity;

  const persistedScores = eligible
    .map((candidate) => candidate.fairnessScore)
    .filter((score): score is number => score !== null && Number.isFinite(score));
  // A late arrival starts at the team's median instead of zero. Pacing during
  // the first minutes online is handled separately from the historical score.
  const neutralEntryScore = median(persistedScores);
  const hasAlternativeToExcluded = Boolean(
    excludeAgentId && eligible.some((candidate) => candidate.agentId !== excludeAgentId)
  );

  const now = options?.now?.getTime() ?? Date.now();
  const candidatesWithScores = eligible
    .filter((candidate) => !hasAlternativeToExcluded || candidate.agentId !== excludeAgentId)
    .map((candidate) => {
      const capacity = capacityOf(candidate);
      const fairnessScoreBefore = candidate.fairnessScore ?? neutralEntryScore;
      return {
        ...candidate,
        capacity,
        maxPortfolio: null,
        portfolioCount: Math.max(0, finiteNumber(candidate.portfolioCount, 0)),
        effectiveLoad: Math.max(0, finiteNumber(candidate.effectiveLoad, 0)),
        fairnessScoreBefore,
        fairnessScoreAfter: fairnessScoreBefore + 1 / capacity,
        occupancy: Math.max(0, finiteNumber(candidate.effectiveLoad, 0)) / capacity,
        overflow,
      };
    });

  const ready = candidatesWithScores.filter((candidate) => {
    const onlineSince = candidate.onlineSince ? Date.parse(candidate.onlineSince) : NaN;
    const lastAssigned = candidate.lastAssignedAt ? Date.parse(candidate.lastAssignedAt) : NaN;
    const warmingUp = Number.isFinite(onlineSince)
      && now >= onlineSince && now - onlineSince < ENTRY_WARMUP_MS;
    return !warmingUp || !Number.isFinite(lastAssigned)
      || now - lastAssigned >= ENTRY_ASSIGNMENT_INTERVAL_MS;
  });
  // Keep the team available when the only candidates are warming up. Otherwise
  // give a new arrival time to start their chat before assigning another one.
  const paced = ready.length > 0 ? ready : candidatesWithScores;
  const lowestOccupancy = Math.min(...paced.map((candidate) => candidate.occupancy));
  // Filter against a fixed minimum instead of using a pairwise tolerance in
  // sort: pairwise "close enough" comparisons can be non-transitive.
  const ranked = paced
    .filter((candidate) => candidate.occupancy <= lowestOccupancy + OCCUPANCY_FAIRNESS_BAND + LOAD_EPSILON)
    .sort((left, right) => {
      const fairnessDelta = left.fairnessScoreBefore - right.fairnessScoreBefore;
      if (Math.abs(fairnessDelta) > LOAD_EPSILON) return fairnessDelta;

      const leftLastAssigned = left.lastAssignedAt ? new Date(left.lastAssignedAt).getTime() : 0;
      const rightLastAssigned = right.lastAssignedAt ? new Date(right.lastAssignedAt).getTime() : 0;
      if (leftLastAssigned !== rightLastAssigned) return leftLastAssigned - rightLastAssigned;

      const occupancyDelta = left.occupancy - right.occupancy;
      if (Math.abs(occupancyDelta) > LOAD_EPSILON) return occupancyDelta;

      return left.agentId.localeCompare(right.agentId);
    });

  return ranked[0] ?? null;
}

/**
 * Descobre *por que* a equipe ficou sem candidatos. Só roda quando a seleção
 * falha, então o custo fica fora do caminho quente — e sem isso todo motivo
 * diferente vira a mesma mensagem genérica na tela do operador.
 */
async function diagnoseEmptyTeam(
  client: PoolClient,
  input: { workspaceId: string; teamId: string }
): Promise<TeamAvailabilityReason> {
  const presenceSql = buildDistributionPresenceSql('uwp', '$3', '$4');

  const { rows } = await client.query(
    `
      SELECT
        COUNT(*)::int AS members,
        COUNT(*) FILTER (WHERE ${presenceSql})::int AS online,
        COUNT(*) FILTER (
          WHERE ${presenceSql}
            AND COALESCE(ds.accepting_assignments, TRUE) = TRUE
        )::int AS accepting
      FROM team_members tm
      JOIN teams t ON t.id = tm.team_id
      LEFT JOIN user_workspace_presence uwp
        ON uwp.user_id = tm.user_id
       AND uwp.workspace_id = t.workspace_id
      LEFT JOIN team_agent_distribution_state ds
        ON ds.workspace_id = t.workspace_id
       AND ds.team_id = t.id
       AND ds.user_id = tm.user_id
      WHERE t.id = $1
        AND t.workspace_id = $2
    `,
    [input.teamId, input.workspaceId, getPresenceTtlSeconds(), getPresenceRecentActivitySeconds()]
  );

  const stats = rows[0] ?? { members: 0, online: 0, accepting: 0 };
  if ((stats.members ?? 0) === 0) return 'no_members';
  if ((stats.online ?? 0) === 0) return 'all_offline';
  if ((stats.accepting ?? 0) === 0) return 'not_accepting';
  return 'load_protected';
}

export async function selectFairAgentForTeam(
  client: PoolClient,
  input: SelectFairAgentInput
): Promise<TeamDistributionResult> {
  // Serializing by workspace/team makes selection + assignment atomic while the
  // caller's transaction is open. Concurrent requests see the committed load.
  await client.query(
    `SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))`,
    [input.workspaceId, input.teamId]
  );

  // A person can belong to several teams. Team locks alone don't coordinate
  // their shared portfolio. Lock member rows in a stable order, then read the
  // workload in a separate statement so READ COMMITTED sees assignments that
  // committed while we were waiting. NO KEY UPDATE preserves FK key-share
  // locks used when inserting assignment state and events.
  const lockedMembers = await client.query<{ id: string }>(
    `SELECT u.id
     FROM users u
     JOIN team_members tm ON tm.user_id = u.id
     JOIN teams t ON t.id = tm.team_id
     WHERE t.id = $1 AND t.workspace_id = $2
     ORDER BY u.id
     FOR NO KEY UPDATE OF u`,
    [input.teamId, input.workspaceId]
  );

  const mode = distributionMode(input.workspaceId);
  const candidates = await readTeamCandidates(client,{...input,lockedMemberIds:lockedMembers.rows.map(member=>member.id)});
  const opportunity = decideOpportunity(candidates, { excludeAgentId: input.excludeAgentId,
    allowOverflow: input.allowOverflow ?? true });
  const legacy = rankDistributionCandidates(candidates, input.excludeAgentId, {
    allowOverflow: input.allowOverflow ?? true,
  });

  const existingOwnerNoOp = opportunity.selection?.agentId === input.currentAgentId && input.teamId === input.currentTeamId;
  const selected = mode === 'active' ? opportunity.selection : legacy ?? (existingOwnerNoOp ? opportunity.selection : null);

  if (!selected) {
    return {
      selection: null,
      reason:
        candidates.some(candidate=>!candidate.availableReason)
          ? 'load_protected'
          : await diagnoseEmptyTeam(client, {
              workspaceId: input.workspaceId,
              teamId: input.teamId,
            }),
    };
  }

  // A request which keeps the same owner/team is not a new opportunity.
  if (selected.agentId === input.currentAgentId && input.teamId === input.currentTeamId) {
    return { selection: selected, reason: 'available', noOp: true };
  }
  const shadowNoOp = mode === 'shadow' && opportunity.selection?.agentId === input.currentAgentId && input.teamId === input.currentTeamId;
  if (mode !== 'legacy' && !shadowNoOp) {
    for (const row of opportunity.candidates.filter(row => row.reason === 'eligible')) {
      await client.query(`INSERT INTO opportunity_distribution_state
        (workspace_id, team_id, user_id, phase, turn_date, balance, updated_at)
        VALUES ($1,$2,$3,$4,(clock_timestamp() AT TIME ZONE COALESCE(
          (SELECT timezone FROM workspaces WHERE id=$1),'America/Sao_Paulo') - interval '6 hours')::date,$5,clock_timestamp())
        ON CONFLICT (workspace_id,team_id,user_id,phase) DO UPDATE SET
          turn_date=EXCLUDED.turn_date, balance=EXCLUDED.balance, updated_at=EXCLUDED.updated_at`,
        [input.workspaceId,input.teamId,row.agentId,mode,Math.max(-1, Math.min(1,row.balanceAfter))]);
    }
  }

  await client.query(
    `
      INSERT INTO team_agent_distribution_state (
        workspace_id,
        team_id,
        user_id,
        capacity,
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
        (NOW() AT TIME ZONE COALESCE(
          (SELECT timezone FROM workspaces WHERE id = $1),
          'America/Sao_Paulo'
        ) - interval '6 hours')::date,
        clock_timestamp(),
        clock_timestamp()
      )
      ON CONFLICT (workspace_id, team_id, user_id)
      DO UPDATE SET
        fairness_score = CASE WHEN team_agent_distribution_state.fairness_window = EXCLUDED.fairness_window
          THEN team_agent_distribution_state.fairness_score + 1.0 / EXCLUDED.capacity
          ELSE 1.0 / EXCLUDED.capacity END,
        fairness_window = EXCLUDED.fairness_window,
        last_assigned_at = EXCLUDED.last_assigned_at,
        updated_at = EXCLUDED.updated_at
    `,
    [
      input.workspaceId,
      input.teamId,
      selected.agentId,
      selected.capacity,
      (candidates.find(c => c.agentId === selected.agentId)?.fairnessScore ?? 0) + 1 / selected.capacity,
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
        decision_reason, policy_version, decision_snapshot
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13, $14::jsonb)
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
      mode === 'active' ? (selected.overflow ? 'projected_overflow_then_credit' : 'protected_opportunity_credit') : selected.overflow
        ? 'overflow_entry_pacing_then_occupancy_band_then_fairness_then_idle_time'
        : 'entry_pacing_then_occupancy_band_then_fairness_then_idle_time',
      mode === 'active' ? DISTRIBUTION_POLICY_VERSION : 'legacy',
      JSON.stringify({ phase: mode, version: DISTRIBUTION_POLICY_VERSION, decidedAt: new Date().toISOString(),
        shadowSelectedAgentId: mode === 'shadow' ? opportunity.selection?.agentId : undefined,
        shadowNoOp,
        candidates: opportunity.candidates,
        assignmentType: input.currentAgentId ? 'transfer' : 'first_assignment' }),
    ]
  );

  return { selection: selected, reason: 'available' };
}
