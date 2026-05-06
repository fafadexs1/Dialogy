import type { AgentToolExecutionResult } from '@/services/agent-tools/types';
import type { KnowledgeRetrievalStrategy } from '@/services/rag/hybrid-retrieval';
import type { AutopilotIntentResolution, KnowledgeCoverage } from './intent-types';
import type { AutopilotWorkflowPlan } from './workflow-engine';
import type { ResponseValidationResult, ResponseValidatorDecision } from './response-validator';
import type { ToolPlannerResult } from './tool-planner';

export type AutopilotRunStatus = 'success' | 'fallback' | 'error' | 'skipped';

export type AutopilotObservation = {
  caseId?: string;
  status: AutopilotRunStatus;
  responseSent: boolean;
  intent: AutopilotIntentResolution['intent'];
  workflowId: string;
  confidence: number;
  ragStrategy: KnowledgeRetrievalStrategy;
  knowledgeCoverage: KnowledgeCoverage;
  workflowExecutionMode: AutopilotWorkflowPlan['executionMode'];
  workflowHandled: boolean;
  workflowMissingSlotCount: number;
  toolPlannerAcceptedCount: number;
  toolPlannerRejectedCount: number;
  toolPlannerPromiseRepairReason: string | null;
  validatorDecision: ResponseValidatorDecision;
  validatorReasonCount: number;
  fallbackReason: string | null;
  handoffPlanned: boolean;
  toolSuccessCount: number;
  toolErrorCount: number;
};

export type AutopilotObservationSummary = {
  total: number;
  responseSentRate: number;
  fallbackRate: number;
  handoffRate: number;
  validatorInterventionRate: number;
  toolPlannerRejectionRate: number;
  lowKnowledgeCoverageRate: number;
  toolErrorRate: number;
  intentCounts: Record<string, number>;
  ragStrategyCounts: Record<string, number>;
  knowledgeCoverageCounts: Record<string, number>;
  validatorDecisionCounts: Record<string, number>;
  fallbackReasonCounts: Record<string, number>;
};

function countBy<T extends string>(items: T[]): Record<T, number> {
  return items.reduce<Record<T, number>>((counts, item) => {
    counts[item] = (counts[item] || 0) + 1;
    return counts;
  }, {} as Record<T, number>);
}

function ratio(numerator: number, denominator: number) {
  return denominator > 0 ? Number((numerator / denominator).toFixed(4)) : 0;
}

export function buildAutopilotObservation(input: {
  caseId?: string;
  status: AutopilotRunStatus;
  responseSent: boolean;
  intentResolution: AutopilotIntentResolution;
  ragStrategy: KnowledgeRetrievalStrategy;
  knowledgeCoverage: KnowledgeCoverage;
  workflowPlan: AutopilotWorkflowPlan;
  toolPlanner?: ToolPlannerResult | null;
  responseValidator: ResponseValidationResult;
  toolResults?: AgentToolExecutionResult[] | null;
  fallbackReason?: string | null;
}): AutopilotObservation {
  const toolResults = input.toolResults || [];
  const toolPlannerActions = input.toolPlanner?.actions || [];
  const validatorActions = input.responseValidator.actions || [];
  const allActions = [
    ...input.workflowPlan.actions,
    ...toolPlannerActions,
    ...validatorActions,
  ];

  return {
    caseId: input.caseId,
    status: input.status,
    responseSent: input.responseSent,
    intent: input.intentResolution.intent,
    workflowId: input.intentResolution.workflowId,
    confidence: input.intentResolution.confidence,
    ragStrategy: input.ragStrategy,
    knowledgeCoverage: input.knowledgeCoverage,
    workflowExecutionMode: input.workflowPlan.executionMode,
    workflowHandled: input.workflowPlan.handledByWorkflow,
    workflowMissingSlotCount: input.workflowPlan.missingSlots.length,
    toolPlannerAcceptedCount: input.toolPlanner?.actions.length || 0,
    toolPlannerRejectedCount: input.toolPlanner?.rejectedActions.length || 0,
    toolPlannerPromiseRepairReason: input.toolPlanner?.promiseValidation.repairReason || null,
    validatorDecision: input.responseValidator.decision,
    validatorReasonCount: input.responseValidator.reasons.length,
    fallbackReason: input.fallbackReason ||
      input.responseValidator.reasons[0] ||
      input.toolPlanner?.promiseValidation.repairReason ||
      null,
    handoffPlanned: allActions.some((action) => action.type === 'transfer_chat'),
    toolSuccessCount: toolResults.filter((result) => result.status === 'success').length,
    toolErrorCount: toolResults.filter((result) => result.status === 'error').length,
  };
}

export function summarizeAutopilotObservations(observations: AutopilotObservation[]): AutopilotObservationSummary {
  const total = observations.length;
  const toolResultCount = observations.reduce((sum, item) => sum + item.toolSuccessCount + item.toolErrorCount, 0);

  return {
    total,
    responseSentRate: ratio(observations.filter((item) => item.responseSent).length, total),
    fallbackRate: ratio(observations.filter((item) => (
      item.status === 'fallback' ||
      item.validatorDecision === 'replace_with_fallback' ||
      Boolean(item.fallbackReason)
    )).length, total),
    handoffRate: ratio(observations.filter((item) => item.handoffPlanned || item.validatorDecision === 'handoff').length, total),
    validatorInterventionRate: ratio(observations.filter((item) => item.validatorDecision !== 'approve').length, total),
    toolPlannerRejectionRate: ratio(observations.filter((item) => item.toolPlannerRejectedCount > 0).length, total),
    lowKnowledgeCoverageRate: ratio(observations.filter((item) => (
      item.knowledgeCoverage === 'low' || item.knowledgeCoverage === 'none'
    )).length, total),
    toolErrorRate: ratio(observations.reduce((sum, item) => sum + item.toolErrorCount, 0), toolResultCount),
    intentCounts: countBy(observations.map((item) => item.intent)),
    ragStrategyCounts: countBy(observations.map((item) => item.ragStrategy)),
    knowledgeCoverageCounts: countBy(observations.map((item) => item.knowledgeCoverage)),
    validatorDecisionCounts: countBy(observations.map((item) => item.validatorDecision)),
    fallbackReasonCounts: countBy(observations.map((item) => item.fallbackReason || 'none')),
  };
}
