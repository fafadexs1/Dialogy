import type { AgentToolAction } from '@/services/agent-tools/types';
import type { AutopilotIntentResolution } from './intent-types';
import type { AgentDecisionType, BlockedToolDecision, DecisionEvidence, DecisionLedgerEntry } from './decision-ledger';
import { inferAgentDecisionType } from './decision-ledger';
import { resolveRequestedToolName } from './tool-capability-registry';
import type { SlotExtractionResult } from './slots';

export type AgentProcedureDecisionContext = {
  activeProcedureId?: string | null;
  matchedProcedureId?: string | null;
  procedureId?: string | null;
  procedureName?: string | null;
  currentStepId?: string | null;
  matchScore?: number | null;
  matchReason?: string | null;
  status?: string | null;
};

export type AgentRuntimeDecisionInput = {
  workspaceId: string;
  chatId?: string | null;
  messageId?: string | null;
  runId?: string | null;
  autopilotConfigId?: string | null;
  stage: string;
  intentResolution: Pick<AutopilotIntentResolution, 'intent' | 'confidence' | 'reason'> & {
    workflowId?: string | null;
  };
  workflowPlan?: {
    executionMode?: string | null;
    reason?: string | null;
    handledByWorkflow?: boolean | null;
    missingSlots?: string[];
    actions?: AgentToolAction[];
    slotExtraction?: SlotExtractionResult | null;
  } | null;
  toolPlanner?: {
    actions?: AgentToolAction[];
    rejectedActions?: Array<{
      action: AgentToolAction;
      reason: string;
      missingSlots?: string[];
      code?: string;
    }>;
    responseOverride?: string | null;
    metadata?: Record<string, unknown> | null;
  } | null;
  procedure?: AgentProcedureDecisionContext | null;
  switchResolution?: {
    switchNodeId: string;
    routeId: string;
    routeLabel?: string;
    targetNodeId?: string;
    confidence: number;
    fallbackUsed: boolean;
    evidence?: string[];
    candidateRoutes?: Array<{
      routeId: string;
      routeLabel?: string;
      targetNodeId?: string;
      confidence?: number;
      selected?: boolean;
      fallback?: boolean;
      evidence?: string[];
      rejectedReason?: string;
    }>;
    rejectedRoutes?: Array<{
      routeId: string;
      routeLabel?: string;
      targetNodeId?: string;
      confidence?: number;
      selected?: boolean;
      fallback?: boolean;
      evidence?: string[];
      rejectedReason?: string;
    }>;
  } | null;
  policyContext?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
};

export type AgentRuntimeDecision = {
  decisionType: AgentDecisionType;
  goal: string;
  procedureId?: string | null;
  stepId?: string | null;
  selectedTools: string[];
  blockedTools: BlockedToolDecision[];
  requiredSlots: string[];
  presentSlots: AgentDecisionPresentSlot[];
  invalidSlots: AgentDecisionInvalidSlot[];
  confidence: number;
  evidence: DecisionEvidence[];
  ledgerEntry: DecisionLedgerEntry;
};

export type AgentDecisionPresentSlot = {
  name: string;
  source: string;
  confidence: number | null;
};

export type AgentDecisionInvalidSlot = {
  name: string;
  reason: string;
};

function unique(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)));
}

function actionNames(actions: AgentToolAction[] | null | undefined): string[] {
  return unique((actions || []).map((action) => resolveRequestedToolName(action) || action.type));
}

function blockedToolsFromPlanner(
  rejectedActions: NonNullable<AgentRuntimeDecisionInput['toolPlanner']>['rejectedActions'],
): BlockedToolDecision[] {
  if (!Array.isArray(rejectedActions)) return [];
  return rejectedActions.map((item) => ({
    toolName: resolveRequestedToolName(item.action) || item.action.type,
    reason: item.reason,
    missingSlots: item.missingSlots,
  }));
}

function resolveDecisionType(input: {
  workflowPlan?: AgentRuntimeDecisionInput['workflowPlan'];
  toolPlanner?: AgentRuntimeDecisionInput['toolPlanner'];
  selectedTools: string[];
  blockedTools: BlockedToolDecision[];
  requiredSlots: string[];
  procedure?: AgentProcedureDecisionContext | null;
}): AgentDecisionType {
  if (input.requiredSlots.length > 0) return 'ask_slot';
  if (input.blockedTools.some((tool) => (
    tool.reason.includes('[tool_policy:confirmation_required]') ||
    tool.reason.includes('[tool_policy:confirmation_context_missing]')
  ))) {
    return 'wait_confirmation';
  }
  if (input.selectedTools.length > 0 || input.toolPlanner?.actions?.length) {
    return inferAgentDecisionType({
      executionMode: input.workflowPlan?.executionMode,
      selectedTools: input.selectedTools,
      blockedTools: input.blockedTools,
      responseOverride: input.toolPlanner?.responseOverride,
    });
  }
  if (input.blockedTools.length > 0 || input.toolPlanner?.responseOverride) return 'fallback';
  if (input.procedure?.status === 'waiting_input') return 'ask_slot';
  return inferAgentDecisionType({
    executionMode: input.workflowPlan?.executionMode,
    selectedTools: input.selectedTools,
    blockedTools: input.blockedTools,
    requiredSlots: input.requiredSlots,
    responseOverride: input.toolPlanner?.responseOverride,
  });
}

function buildEvidence(input: AgentRuntimeDecisionInput, selectedTools: string[], blockedTools: BlockedToolDecision[]): DecisionEvidence[] {
  const evidence: DecisionEvidence[] = [
    {
      source: 'intent_resolution',
      reason: input.intentResolution.reason || `Intent resolvida como ${input.intentResolution.intent}.`,
      confidence: input.intentResolution.confidence,
    },
  ];

  if (input.switchResolution) {
    evidence.push({
      source: 'switch_resolution',
      reason: `Switch ${input.switchResolution.switchNodeId} escolheu rota ${input.switchResolution.routeId}${input.switchResolution.fallbackUsed ? ' usando fallback' : ''}.`,
      confidence: input.switchResolution.confidence,
    });
  }

  if (input.procedure?.procedureId || input.procedure?.matchedProcedureId || input.procedure?.activeProcedureId) {
    evidence.push({
      source: 'procedure_matcher',
      reason: input.procedure.matchReason || input.procedure.procedureName || input.procedure.procedureId || 'Procedimento ativo.',
      confidence: input.procedure.matchScore ?? undefined,
    });
  }

  if (input.workflowPlan?.reason) {
    evidence.push({
      source: 'workflow_engine',
      reason: input.workflowPlan.reason,
    });
  }

  if (selectedTools.length > 0 || blockedTools.length > 0) {
    evidence.push({
      source: 'tool_policy_gate',
      reason: `Ferramentas aprovadas: ${selectedTools.join(', ') || 'nenhuma'}; bloqueadas: ${blockedTools.map((tool) => tool.toolName).join(', ') || 'nenhuma'}.`,
    });
  }

  return evidence;
}

function summarizePresentSlots(slotExtraction: SlotExtractionResult | null | undefined): AgentDecisionPresentSlot[] {
  if (!slotExtraction) return [];
  const byName = new Map<string, AgentDecisionPresentSlot>();

  for (const detail of slotExtraction.details || []) {
    const name = String(detail.name || '').trim();
    if (!name || byName.has(name)) continue;
    byName.set(name, {
      name,
      source: detail.source || 'message',
      confidence: typeof detail.confidence === 'number' && Number.isFinite(detail.confidence)
        ? Number(Math.min(1, Math.max(0, detail.confidence)).toFixed(3))
        : null,
    });
  }

  for (const name of Object.keys(slotExtraction.slots || {})) {
    if (!name || byName.has(name)) continue;
    byName.set(name, {
      name,
      source: 'unknown',
      confidence: null,
    });
  }

  return Array.from(byName.values());
}

function summarizeInvalidSlots(slotExtraction: SlotExtractionResult | null | undefined): AgentDecisionInvalidSlot[] {
  if (!slotExtraction) return [];
  return (slotExtraction.invalidSlots || [])
    .map((slot): AgentDecisionInvalidSlot | null => {
      const name = String(slot.name || '').trim();
      if (!name) return null;
      return {
        name,
        reason: String(slot.reason || '').trim(),
      };
    })
    .filter((slot): slot is AgentDecisionInvalidSlot => slot !== null);
}

export function decideAgentNextAction(input: AgentRuntimeDecisionInput): AgentRuntimeDecision {
  const workflowSelectedTools = actionNames(input.workflowPlan?.actions);
  const plannerSelectedTools = actionNames(input.toolPlanner?.actions);
  const selectedTools = plannerSelectedTools.length > 0 ? plannerSelectedTools : workflowSelectedTools;
  const blockedTools = blockedToolsFromPlanner(input.toolPlanner?.rejectedActions);
  const requiredSlots = unique([
    ...(input.workflowPlan?.missingSlots || []),
    ...blockedTools.flatMap((tool) => tool.missingSlots || []),
  ]);
  const decisionType = resolveDecisionType({
    workflowPlan: input.workflowPlan,
    toolPlanner: input.toolPlanner,
    selectedTools,
    blockedTools,
    requiredSlots,
    procedure: input.procedure,
  });
  const procedureId = input.procedure?.procedureId
    || input.procedure?.matchedProcedureId
    || null;
  const stepId = input.procedure?.currentStepId || null;
  const evidence = buildEvidence(input, selectedTools, blockedTools);
  const confidence = Number(Math.min(1, Math.max(0, input.intentResolution.confidence || 0)).toFixed(3));
  const presentSlots = summarizePresentSlots(input.workflowPlan?.slotExtraction);
  const invalidSlots = summarizeInvalidSlots(input.workflowPlan?.slotExtraction);

  const ledgerEntry: DecisionLedgerEntry = {
    workspaceId: input.workspaceId,
    chatId: input.chatId,
    messageId: input.messageId,
    runId: input.runId,
    autopilotConfigId: input.autopilotConfigId,
    procedureExecutionId: input.procedure?.activeProcedureId || null,
    decisionStage: input.stage,
    decisionType,
    goal: input.intentResolution.intent,
    workflowId: input.intentResolution.workflowId,
    procedureId,
    stepId,
    selectedTool: selectedTools[0] || null,
    selectedTools,
    blockedTools,
    requiredSlots,
    evidence,
    policyResult: input.policyContext || null,
    confidence,
    metadata: {
      ...(input.metadata || {}),
      workflowPlan: input.workflowPlan ? {
        executionMode: input.workflowPlan.executionMode,
        handledByWorkflow: input.workflowPlan.handledByWorkflow,
        reason: input.workflowPlan.reason,
      } : null,
      slotSummary: {
        presentSlots,
        missingSlots: requiredSlots,
        invalidSlots,
      },
      toolPlanner: input.toolPlanner?.metadata || null,
      procedure: input.procedure || null,
      switchResolution: input.switchResolution || null,
    },
  };

  return {
    decisionType,
    goal: input.intentResolution.intent,
    procedureId,
    stepId,
    selectedTools,
    blockedTools,
    requiredSlots,
    presentSlots,
    invalidSlots,
    confidence,
    evidence,
    ledgerEntry,
  };
}
