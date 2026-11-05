import type { AgentDecisionType, DecisionLedgerEntry } from '@/services/autopilot/decision-ledger';
import type { StudioSession } from './engine';

/**
 * Phase 0 of docs/PLAN-ia-autonoma-transferir-encerrar.md: every Studio turn leaves one
 * auditable decision so handoff/close accuracy can be measured. Pure and free of customer
 * content: only fixed event labels, counters and ids are copied.
 */

export type StudioDecisionClassification = {
  decisionType: AgentDecisionType;
  /** Why the turn ended the way it did, in a closed vocabulary suitable for aggregation. */
  basis: string;
};

/** Closed vocabulary. Keep in sync with the SLO queries in scripts/baseline-ia-decisions.ts. */
export function classifyStudioTurnDecision(state: Pick<StudioSession, 'status' | 'phase' | 'inFlight' | 'reasoning' | 'pendingField'>): StudioDecisionClassification {
  const uncertain = Boolean(state.inFlight || state.reasoning?.operations.some((operation) => operation.status === 'unknown'));
  if (state.status === 'transferred') return { decisionType: 'handoff', basis: uncertain ? 'handoff_with_uncertain_operation' : 'handoff_executed' };
  if (state.status === 'resolved' && state.phase === 'done') {
    // The reasoning core closes implicitly: all requests resolved/cancelled after a response.
    // There is no customer confirmation requirement today, which is what Phase 1 changes.
    return { decisionType: 'close', basis: state.reasoning ? 'implicit_all_requests_resolved' : 'journey_completed' };
  }
  if (state.status === 'failed') return { decisionType: 'fallback', basis: 'session_failed' };
  if (state.status === 'cancelled') return { decisionType: 'fallback', basis: 'session_cancelled' };
  if (uncertain) return { decisionType: 'continue_llm', basis: 'waiting_with_uncertain_operation' };
  if (state.status === 'waiting_input') return { decisionType: state.pendingField ? 'ask_slot' : 'answer', basis: 'waiting_customer_input' };
  return { decisionType: 'continue_llm', basis: 'running' };
}

export function buildStudioDecisionLedgerEntry(input: {
  workspaceId: string;
  chatId: string;
  messageId?: string | null;
  runId?: string | null;
  systemAgentId?: string | null;
  autopilotConfigId: string;
  releaseId: string;
  releaseVersion?: number | string | null;
  state: StudioSession;
  decisionMode: 'model_reasoning' | 'published_journey';
  suggestionOnly: boolean;
  replay: boolean;
  /** null: no close attempted. true/false: whether the chat row was actually closed. */
  chatClosed?: boolean | null;
  /** How the close was decided for a resolved session. `explicit` runs the close gate (the agent's closeOnCustomerConfirmation setting). */
  closeDecision?: { mode: 'legacy' | 'explicit'; basis?: string | null; blockedBy?: string[]; classifier?: boolean } | null;
  /** What the promise guard found in the reply. `rewritten` is true only in enforce mode. */
  promiseGuard?: { mode: string; kinds: string[]; rewritten: boolean } | null;
  /** Wall-clock for the whole turn, when the caller measured it. */
  latencyMs?: number | null;
}): DecisionLedgerEntry {
  const { state } = input;
  const classified = classifyStudioTurnDecision(state);
  // With the explicit gate, a resolved session that the gate refused to close is an answer, not a close.
  const heldOpen = input.closeDecision?.mode === 'explicit' && !input.closeDecision.basis && classified.decisionType === 'close';
  const { decisionType, basis } = heldOpen
    ? { decisionType: 'answer' as const, basis: 'resolved_awaiting_customer_confirmation' }
    : input.closeDecision?.mode === 'explicit' && classified.decisionType === 'close'
      ? { decisionType: classified.decisionType, basis: 'customer_confirmed_close' }
      : classified;
  const metrics = state.reasoning?.lastTurnMetrics;
  const lastEvent = state.events[state.events.length - 1];
  return {
    workspaceId: input.workspaceId,
    chatId: input.chatId,
    messageId: input.messageId ?? null,
    runId: input.runId ?? null,
    systemAgentId: input.systemAgentId ?? null,
    autopilotConfigId: input.autopilotConfigId,
    decisionStage: 'studio_turn',
    decisionType,
    goal: state.initialIntent ? 'studio_intent' : null,
    procedureId: state.procedureId ?? null,
    evidence: [{ source: 'studio_session', reason: basis, confidence: null }],
    policyResult: { basis },
    latencyMs: metrics?.durationMs ?? input.latencyMs ?? null,
    metadata: {
      source: 'studio',
      basis,
      studioSessionId: state.id,
      studioReleaseId: input.releaseId,
      studioVersion: input.releaseVersion ?? null,
      decisionMode: input.decisionMode,
      suggestionOnly: input.suggestionOnly,
      replay: input.replay,
      chatClosed: input.chatClosed ?? null,
      handoffReasonCode: state.handoff?.reasonCode ?? null,
      closeMode: input.closeDecision?.mode ?? null,
      closeBlockedBy: input.closeDecision?.blockedBy?.length ? input.closeDecision.blockedBy : null,
      closeClassifierUsed: input.closeDecision?.classifier ?? null,
      promiseGuardMode: input.promiseGuard?.mode ?? null,
      promiseViolations: input.promiseGuard?.kinds.length ? input.promiseGuard.kinds : null,
      promiseRewritten: input.promiseGuard?.rewritten ?? null,
      sessionStatus: state.status,
      sessionPhase: state.phase,
      turnCount: state.turnCount ?? null,
      toolCalls: metrics?.toolCalls ?? null,
      modelDecisions: metrics?.modelDecisions ?? null,
      activeRequests: metrics?.activeRequests ?? null,
      pausedRequests: metrics?.pausedRequests ?? null,
      resolvedRequests: metrics?.resolvedRequests ?? null,
      uncertainOperations: metrics?.uncertainOperations ?? null,
      budgetReached: metrics?.budgetReached ?? null,
      lastEventKind: lastEvent?.kind ?? null,
    },
  };
}
