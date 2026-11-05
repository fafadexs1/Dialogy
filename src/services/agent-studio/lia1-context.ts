/** Opt-in by agent for a measured LIA-1 rollout. `*` enables all agents. */
export function lia1CompactContextEnabled(agentId: string): boolean {
  const selected = process.env.LIA1_COMPACT_AGENT_IDS?.split(',').map((id) => id.trim()).filter(Boolean) || [];
  return selected.includes('*') || selected.includes(agentId);
}

const changed = (before: unknown, after: unknown) => JSON.stringify(before) !== JSON.stringify(after);

/** The DeepSeek tool response is a state update; the prior snapshot remains in its conversation. */
export function lia1ContextDelta(previous: Record<string, unknown>, current: Record<string, unknown>) {
  const updates: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(current)) {
    if (!changed(previous[key], value)) continue;
    if (key === 'observations' || key === 'recentMessages') {
      const prior = Array.isArray(previous[key]) ? previous[key] as unknown[] : [];
      const next = Array.isArray(value) ? value as unknown[] : [];
      const prefixUnchanged = prior.length <= next.length && prior.every((item, index) => !changed(item, next[index]));
      updates[key] = prefixUnchanged ? { append: next.slice(prior.length) } : { replace: next };
    } else updates[key] = value;
  }
  for (const key of Object.keys(previous)) if (!(key in current)) updates[key] = null;
  return { kind: 'state_delta', updates };
}

/** Sizes only: never persist prompt contents in usage telemetry. */
export function lia1ContextSizes(context: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(context).map(([key, value]) => [key, JSON.stringify(value)?.length || 0]));
}

const safeOutcomes = new Set([
  'read_failed', 'business_negative', 'effect_outcome_unknown', 'decision_provider_retry',
  'decision_provider_unavailable', 'invalid_decision', 'proposal_rejected', 'suggestion_only',
  'identical_read_retry_blocked', 'operation_outcome_unknown', 'operation_budget_exhausted',
  'confirmation_proposal_required', 'historical_request_outcome_unknown', 'history_temporarily_unavailable',
  'memory_temporarily_unavailable', 'knowledge_unavailable', 'handoff_outcome_unknown',
  'prior_operations_unavailable', 'capability_unavailable', 'business_branch_unavailable',
  'catalog_product_unavailable', 'operation_already_attempted', 'prior_operation_already_attempted',
  'operation_declined', 'history_loaded', 'memory_loaded', 'historical_operation_loaded',
]);
const safeFailureCategories = new Set([
  'temporary_read_failure', 'business_negative', 'access_blocked', 'permanent_read_failure',
  'unknown_effect', 'provider_failure', 'invalid_structure',
]);

/** Only controlled codes can enter usage metadata, never a tool or knowledge result body. */
export function lia1ObservationTelemetry(observation: unknown) {
  const value = observation && typeof observation === 'object' ? observation as Record<string, unknown> : {};
  const candidate = typeof value.error === 'string' ? value.error : typeof value.result === 'string' ? value.result : null;
  const priorOutcome = candidate && safeOutcomes.has(candidate) ? candidate
    : value.kind === 'tool' ? 'tool_result' : value.kind === 'knowledge' ? 'knowledge_result'
      : value.kind === 'advice' ? 'advice_result' : null;
  const category = typeof value.category === 'string' && safeFailureCategories.has(value.category) ? value.category : null;
  return { priorOutcome, priorFailureCategory: category };
}
