import type { AgentToolCatalogItem, AgentToolDefinition } from '@/services/agent-tools/catalog';
import { getAgentToolDefinition } from '@/services/agent-tools/catalog';
import type { AgentToolAction, AgentToolName } from '@/services/agent-tools/types';
import type { AutopilotIntentResolution, AutopilotSlotName, UniversalAutopilotIntent } from './intent-types';
import type { SlotExtractionResult } from './slots';
import { calculateToolSelectionScore, type ToolSelectionScoreWeights } from './score-history';
import {
  catalogToolRequiresConfirmation,
  isSensitiveMcpCatalogTool,
} from './tool-confirmation-policy';

export type ProcedureStepType =
  | 'classify'
  | 'retrieve_knowledge'
  | 'collect_slots'
  | 'confirm'
  | 'call_tool'
  | 'validate_tool_result'
  | 'respond'
  | 'handoff'
  | 'close';

export type ToolCapabilityRisk = 'low' | 'medium' | 'high';

export type ToolCapability = {
  name: string;
  capability: string;
  description: string;
  riskLevel: ToolCapabilityRisk;
  sideEffect: 'none' | 'low' | 'medium' | 'high';
  requiredSlots: AutopilotSlotName[];
  allowedGoals: UniversalAutopilotIntent[];
  forbiddenGoals: UniversalAutopilotIntent[];
  allowedStepTypes: ProcedureStepType[];
  requiresConfirmation: boolean;
  requiresHumanApproval: boolean;
  inputSchema?: Record<string, unknown> | null;
  outputSchema?: Record<string, unknown> | null;
  source: 'dialogy' | 'mcp';
};

export type ToolCapabilityGateCode =
  | 'allowed'
  | 'unknown_tool'
  | 'disabled_tool'
  | 'intent_not_allowed'
  | 'forbidden_goal'
  | 'missing_slots'
  | 'requires_human_approval'
  | 'step_not_allowed'
  | 'score_below_threshold';

export type ToolCapabilityGateResult = {
  allowed: boolean;
  code: ToolCapabilityGateCode;
  reason: string;
  capability?: ToolCapability;
  missingSlots: AutopilotSlotName[];
  score: number;
  scoreBreakdown: {
    goalMatch: number;
    procedureStepMatch: number;
    requiredSlotsPresent: number;
    policyAllowed: number;
    toolEvidence: number;
    weights?: ToolSelectionScoreWeights;
  };
};

function capabilityName(toolName: string): string {
  if (toolName === 'transfer_chat') return 'human_handoff';
  if (toolName === 'close_chat') return 'close_conversation';
  if (toolName === 'add_internal_note') return 'preserve_context';
  if (toolName === 'crm_update_contact_custom_fields') return 'update_registration_data';
  if (toolName === 'sgp_fetch_contracts') return 'check_customer_contracts';
  if (toolName === 'sgp_fetch_contact_panel_data') return 'check_customer_status';
  if (toolName === 'sgp_generate_invoice_pix') return 'request_invoice_or_payment';
  if (toolName === 'sgp_create_payment_promise') return 'schedule_payment_promise';
  if (toolName === 'sgp_open_support_ticket') return 'open_support_ticket';
  if (toolName.startsWith('mcp:')) return `external_${toolName.split(':').at(-1) || 'tool'}`;
  return toolName;
}

function allowedStepTypesForTool(tool: AgentToolDefinition | AgentToolCatalogItem): ProcedureStepType[] {
  if (tool.class === 'handoff') return ['handoff', 'call_tool'];
  if (tool.name === 'close_chat') return ['close', 'call_tool'];
  if (tool.class === 'read_only' || tool.class === 'retrieval') return ['retrieve_knowledge', 'call_tool'];
  return ['call_tool'];
}

export function resolveRequestedToolName(action: AgentToolAction): string {
  return action.type === 'mcp_call_tool'
    ? String(action.payload?.toolName || '').trim()
    : action.type;
}

export function toolCapabilityFromCatalogItem(
  tool: AgentToolDefinition | AgentToolCatalogItem,
): ToolCapability {
  const source = 'source' in tool ? tool.source : 'dialogy';
  const sensitiveMcp = isSensitiveMcpCatalogTool(tool);
  return {
    name: tool.name,
    capability: capabilityName(tool.name),
    description: tool.description,
    riskLevel: sensitiveMcp ? 'high' : tool.riskLevel,
    sideEffect: sensitiveMcp ? 'high' : tool.sideEffect,
    requiredSlots: tool.requiredSlots,
    allowedGoals: tool.allowedIntents,
    forbiddenGoals: [],
    allowedStepTypes: allowedStepTypesForTool(tool),
    requiresConfirmation: catalogToolRequiresConfirmation(tool),
    requiresHumanApproval: tool.requiresHumanApproval,
    inputSchema: tool.inputSchema || null,
    outputSchema: tool.outputSchema || null,
    source,
  };
}

export function listToolCapabilities(toolCatalog: AgentToolCatalogItem[]): ToolCapability[] {
  return toolCatalog.map(toolCapabilityFromCatalogItem);
}

export function findToolCapabilityForAction(input: {
  action: AgentToolAction;
  toolCatalog: AgentToolCatalogItem[];
}): ToolCapability | null {
  const requestedToolName = resolveRequestedToolName(input.action);
  const catalogItem = input.toolCatalog.find((tool) => (
    tool.name === requestedToolName || tool.name === input.action.type
  ));
  const definition = catalogItem || getAgentToolDefinition(input.action.type as AgentToolName);
  return definition ? toolCapabilityFromCatalogItem(definition) : null;
}

function isToolEnabled(input: {
  action: AgentToolAction;
  enabledToolNames: string[];
}) {
  const requested = resolveRequestedToolName(input.action);
  if (input.action.type === 'mcp_call_tool') return Boolean(requested && input.enabledToolNames.includes(requested));
  return input.enabledToolNames.includes(input.action.type);
}

function slotSatisfiedByActionPayload(action: AgentToolAction, slot: AutopilotSlotName): boolean {
  if (action.type === 'sgp_generate_invoice_pix' && slot === 'invoice_or_payment_id') {
    return Boolean(action.payload?.invoiceId);
  }

  if (action.type === 'sgp_create_payment_promise' && slot === 'date') {
    return Boolean(action.payload?.promiseDate && /^\d{4}-\d{2}-\d{2}$/.test(action.payload.promiseDate));
  }

  return false;
}

export function missingSlotsForToolCapability(input: {
  action: AgentToolAction;
  capability: ToolCapability;
  slotExtraction: SlotExtractionResult;
}): AutopilotSlotName[] {
  return input.capability.requiredSlots.filter((slot) => (
    !input.slotExtraction.slots[slot] && !slotSatisfiedByActionPayload(input.action, slot)
  ));
}

function buildScore(input: {
  capability: ToolCapability;
  intent: UniversalAutopilotIntent;
  stepType: ProcedureStepType;
  missingSlots: AutopilotSlotName[];
  policyAllowed: boolean;
  weights?: Partial<ToolSelectionScoreWeights> | null;
}) {
  const goalMatch = input.capability.allowedGoals.length === 0 || input.capability.allowedGoals.includes(input.intent) ? 1 : 0;
  const procedureStepMatch = input.capability.allowedStepTypes.includes(input.stepType) ? 1 : 0;
  const requiredSlotsPresent = input.capability.requiredSlots.length === 0
    ? 1
    : 1 - (input.missingSlots.length / input.capability.requiredSlots.length);
  const policyAllowed = input.policyAllowed ? 1 : 0;
  const toolEvidence = input.capability.description ? 1 : 0.5;

  const scoreResult = calculateToolSelectionScore({
    goalMatch,
    procedureStepMatch,
    requiredSlotsPresent,
    policyAllowed,
    toolEvidence,
  }, input.weights);

  return {
    score: scoreResult.score,
    scoreBreakdown: {
      goalMatch,
      procedureStepMatch,
      requiredSlotsPresent: Number(requiredSlotsPresent.toFixed(2)),
      policyAllowed,
      toolEvidence,
      weights: scoreResult.weights,
    },
  };
}

function gateResult(input: Omit<ToolCapabilityGateResult, 'score' | 'scoreBreakdown'> & {
  score?: number;
  scoreBreakdown?: ToolCapabilityGateResult['scoreBreakdown'];
}): ToolCapabilityGateResult {
  return {
    ...input,
    score: input.score ?? 0,
    scoreBreakdown: input.scoreBreakdown ?? {
      goalMatch: 0,
      procedureStepMatch: 0,
      requiredSlotsPresent: 0,
      policyAllowed: 0,
      toolEvidence: 0,
    },
  };
}

export function evaluateToolCapabilityGate(input: {
  action: AgentToolAction;
  intentResolution: Pick<AutopilotIntentResolution, 'intent'>;
  slotExtraction: SlotExtractionResult;
  enabledToolNames: string[];
  toolCatalog: AgentToolCatalogItem[];
  stepType?: ProcedureStepType;
  scoringWeights?: Partial<ToolSelectionScoreWeights> | null;
  minScore?: number;
}): ToolCapabilityGateResult {
  const requestedToolName = resolveRequestedToolName(input.action) || input.action.type;
  const capability = findToolCapabilityForAction({
    action: input.action,
    toolCatalog: input.toolCatalog,
  });
  if (!capability) {
    return gateResult({
      allowed: false,
      code: 'unknown_tool',
      reason: `Ferramenta ${requestedToolName} nao possui contrato registrado.`,
      missingSlots: [],
    });
  }

  const stepType = input.stepType || (
    capability.name === 'transfer_chat'
      ? 'handoff'
      : capability.name === 'close_chat'
        ? 'close'
        : 'call_tool'
  );
  const missingSlots = missingSlotsForToolCapability({
    action: input.action,
    capability,
    slotExtraction: input.slotExtraction,
  });
  const policyAllowed = (
    isToolEnabled({ action: input.action, enabledToolNames: input.enabledToolNames }) &&
    !capability.requiresHumanApproval &&
    !capability.forbiddenGoals.includes(input.intentResolution.intent) &&
    (capability.allowedGoals.length === 0 || capability.allowedGoals.includes(input.intentResolution.intent)) &&
    capability.allowedStepTypes.includes(stepType) &&
    missingSlots.length === 0
  );
  const { score, scoreBreakdown } = buildScore({
    capability,
    intent: input.intentResolution.intent,
    stepType,
    missingSlots,
    policyAllowed,
    weights: input.scoringWeights,
  });

  if (!isToolEnabled({ action: input.action, enabledToolNames: input.enabledToolNames })) {
    return gateResult({
      allowed: false,
      code: 'disabled_tool',
      reason: `Ferramenta ${requestedToolName} nao esta habilitada para este agente.`,
      capability,
      missingSlots,
      score,
      scoreBreakdown,
    });
  }

  if (capability.requiresHumanApproval) {
    return gateResult({
      allowed: false,
      code: 'requires_human_approval',
      reason: `Ferramenta ${requestedToolName} exige aprovacao humana.`,
      capability,
      missingSlots,
      score,
      scoreBreakdown,
    });
  }

  if (capability.forbiddenGoals.includes(input.intentResolution.intent)) {
    return gateResult({
      allowed: false,
      code: 'forbidden_goal',
      reason: `Ferramenta ${requestedToolName} e proibida para o objetivo ${input.intentResolution.intent}.`,
      capability,
      missingSlots,
      score,
      scoreBreakdown,
    });
  }

  if (capability.allowedGoals.length > 0 && !capability.allowedGoals.includes(input.intentResolution.intent)) {
    return gateResult({
      allowed: false,
      code: 'intent_not_allowed',
      reason: `Ferramenta ${requestedToolName} nao e permitida para a intencao ${input.intentResolution.intent}.`,
      capability,
      missingSlots,
      score,
      scoreBreakdown,
    });
  }

  if (!capability.allowedStepTypes.includes(stepType)) {
    return gateResult({
      allowed: false,
      code: 'step_not_allowed',
      reason: `Ferramenta ${requestedToolName} nao pode executar na etapa ${stepType}.`,
      capability,
      missingSlots,
      score,
      scoreBreakdown,
    });
  }

  if (missingSlots.length > 0) {
    return gateResult({
      allowed: false,
      code: 'missing_slots',
      reason: `Ferramenta ${requestedToolName} precisa de slots ausentes: ${missingSlots.join(', ')}.`,
      capability,
      missingSlots,
      score,
      scoreBreakdown,
    });
  }

  const minScore = typeof input.minScore === 'number' && Number.isFinite(input.minScore)
    ? Math.max(0, Math.min(1, input.minScore))
    : 0.75;
  if (score < minScore) {
    return gateResult({
      allowed: false,
      code: 'score_below_threshold',
      reason: `Ferramenta ${requestedToolName} ficou com score ${score.toFixed(2)}, abaixo do minimo ${minScore.toFixed(2)}.`,
      capability,
      missingSlots: [],
      score,
      scoreBreakdown,
    });
  }

  return gateResult({
    allowed: true,
    code: 'allowed',
    reason: `Ferramenta ${requestedToolName} permitida pela capability ${capability.capability}.`,
    capability,
    missingSlots: [],
    score,
    scoreBreakdown,
  });
}
