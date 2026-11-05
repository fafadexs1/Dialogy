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
  /** Wall-clock for the whole turn, when the caller measured it. */
  latencyMs?: number | null;
}): DecisionLedgerEntry {
  const { state } = input;
  const { decisionType, basis } = classifyStudioTurnDecision(state);
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
