import type { DistributionCandidate, FairAgentSelection } from './fair-distribution';

export const DISTRIBUTION_POLICY_VERSION = 'opportunity-v3';
export const PROJECTED_OCCUPANCY_BAND = 0.25;
const EPSILON = 1e-9;
export type OpportunityCandidate = DistributionCandidate & {
  balance?: number;
  incomingLoad?: number;
  incomingAlreadyOwned?: boolean;
};
export type CandidateDecision = {
  agentId: string;
  reason: 'eligible' | 'sender' | 'capacity' | 'entry_pacing' | 'load_band' | 'offline' | 'not_accepting';
  projectedOccupancy: number;
  balanceBefore: number;
  credit: number;
  balanceAfter: number;
};
export type OpportunityDecision = {
  selection: FairAgentSelection | null;
  candidates: CandidateDecision[];
};
export const clampBalance = (value = 0) => Math.max(-1, Math.min(1, Number.isFinite(value) ? value : 0));

/** Pure, deterministic opportunity accounting. Persist only with the assignment. */
export function decideOpportunity(
  candidates: OpportunityCandidate[],
  options: { excludeAgentId?: string | null; now?: Date; allowOverflow?: boolean } = {},
): OpportunityDecision {
  const now = (options.now ?? new Date()).getTime();
  const rows = candidates.map(candidate => {
    const capacity = Math.max(1, candidate.capacity);
    const projectedOccupancy = (candidate.effectiveLoad +
      (candidate.incomingAlreadyOwned ? 0 : Math.max(1, candidate.incomingLoad ?? 1.25))) / capacity;
    const balanceBefore = clampBalance(candidate.balance);
    return { agentId: candidate.agentId, reason: candidate.availableReason ?? 'eligible',
      projectedOccupancy, balanceBefore, credit: 0, balanceAfter: balanceBefore } as CandidateDecision;
  });
  const available = () => rows.filter(row => row.reason === 'eligible');
  if (available().some(row => row.agentId !== options.excludeAgentId)) {
    for (const row of available()) if (row.agentId === options.excludeAgentId) row.reason = 'sender';
  }
  const underCapacity = available().filter(row => row.projectedOccupancy <= 1 + EPSILON);
  const overflow = underCapacity.length === 0;
  if (overflow && options.allowOverflow === false) return { selection: null, candidates: rows };
  if (!overflow) for (const row of available()) {
    if (row.projectedOccupancy > 1 + EPSILON) row.reason = 'capacity';
  }
  const ready = available().filter(row => {
    const candidate = candidates.find(c => c.agentId === row.agentId)!;
    const online = Date.parse(candidate.onlineSince ?? '');
    const assigned = Date.parse(candidate.lastAssignedAt ?? '');
    return !(now >= online && now - online < 300_000 && now - assigned < 60_000);
  });
  if (ready.length) for (const row of available()) {
    if (!ready.includes(row)) row.reason = 'entry_pacing';
  }
  const lowest = Math.min(...available().map(row => row.projectedOccupancy));
  for (const row of available()) {
    if (row.projectedOccupancy > lowest + (overflow ? 0 : PROJECTED_OCCUPANCY_BAND) + EPSILON) row.reason = 'load_band';
  }
  const eligible = available();
  const totalWeight = eligible.reduce((sum, row) => sum + Math.max(1,candidates.find(c => c.agentId === row.agentId)!.capacity), 0);
  for (const row of eligible) {
    row.credit = Math.max(1,candidates.find(c => c.agentId === row.agentId)!.capacity) / totalWeight;
    row.balanceAfter = row.balanceBefore + row.credit;
  }
  eligible.sort((a, b) => {
    const debt = b.balanceAfter - a.balanceAfter;
    if (Math.abs(debt) > EPSILON) return debt;
    const left = candidates.find(c => c.agentId === a.agentId)!;
    const right = candidates.find(c => c.agentId === b.agentId)!;
    const idle = (Date.parse(left.lastAssignedAt ?? '') || 0) - (Date.parse(right.lastAssignedAt ?? '') || 0);
    return idle || a.projectedOccupancy - b.projectedOccupancy || a.agentId.localeCompare(b.agentId);
  });
  const winner = eligible[0];
  if (!winner) return { selection: null, candidates: rows };
  winner.balanceAfter -= 1;
  const candidate = candidates.find(c => c.agentId === winner.agentId)!;
  return { candidates: rows, selection: { ...candidate, maxPortfolio: null, occupancy: winner.projectedOccupancy,
    fairnessScoreBefore: winner.balanceBefore, fairnessScoreAfter: clampBalance(winner.balanceAfter), overflow } };
}

export type DistributionMode = 'legacy' | 'shadow' | 'active';
/** Stable workspace buckets; never choose a different policy per operator/request. */
export function distributionMode(workspaceId: string): DistributionMode {
  const mode = process.env.CHAT_DISTRIBUTION_MODE;
  const targets = (process.env.CHAT_DISTRIBUTION_WORKSPACES ?? '').split(',').map(x => x.trim()).filter(Boolean);
  if (mode !== 'active' && mode !== 'shadow') return 'legacy';
  if (targets.length && !targets.includes(workspaceId)) return 'legacy';
  const rollout = Math.max(0, Math.min(100, Number(process.env.CHAT_DISTRIBUTION_ROLLOUT ?? 100)));
  let hash = 0;
  for (const character of workspaceId) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
  return Math.abs(hash) % 100 < rollout ? mode : 'legacy';
}
