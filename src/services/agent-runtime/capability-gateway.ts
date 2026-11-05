import { fingerprintToolAction } from '@/services/agent-tools/action-fingerprint';
import type { AgentToolCatalogItem } from '@/services/agent-tools/catalog';
import type { AgentToolAction } from '@/services/agent-tools/types';
import {
  evaluateToolCapabilityGate,
  findToolCapabilityForAction,
  listToolCapabilities,
  missingSlotsForToolCapability,
  resolveRequestedToolName,
  type ToolCapability,
} from '@/services/autopilot/tool-capability-registry';
import type { AutopilotIntentResolution } from '@/services/autopilot/intent-types';
import type { SlotExtractionResult } from '@/services/autopilot/slots';
import type {
  CapabilityAuthorization,
  ToolCapabilityContract,
} from './types';

function requiredInputFields(schema: Record<string, unknown> | null | undefined): string[] {
  return Array.isArray(schema?.required)
    ? schema.required.map(String).filter(Boolean)
    : [];
}

function actionArguments(action: AgentToolAction): Record<string, unknown> {
  if (action.type === 'mcp_call_tool') {
    return action.payload?.arguments && typeof action.payload.arguments === 'object'
      ? action.payload.arguments
      : {};
  }
  return action.payload && typeof action.payload === 'object'
    ? action.payload as Record<string, unknown>
    : {};
}

function invalidRequiredArguments(
  action: AgentToolAction,
  schema: Record<string, unknown> | null | undefined,
): string[] {
  const args = actionArguments(action);
  return requiredInputFields(schema).filter((field) => {
    const value = args[field];
    return value == null || (typeof value === 'string' && value.trim() === '');
  });
}

function contractFromCapability(capability: ToolCapability | null | undefined): ToolCapabilityContract | null {
  if (!capability) return null;
  return {
    name: capability.name,
    version: capability.version,
    capability: capability.capability,
    description: capability.description,
    source: capability.source,
    riskLevel: capability.riskLevel,
    sideEffect: capability.sideEffect,
    requiredSlots: capability.requiredSlots,
    permissions: capability.permissions,
    preconditions: capability.preconditions,
    postconditions: capability.postconditions,
    idempotent: capability.idempotent,
    timeoutMs: capability.timeoutMs,
    maxAttempts: capability.maxAttempts,
    requiresConfirmation: capability.requiresConfirmation,
    requiresHumanApproval: capability.requiresHumanApproval,
    inputSchema: capability.inputSchema || null,
    outputSchema: capability.outputSchema || null,
  };
}

function rejected(
  code: CapabilityAuthorization['code'],
  reason: string,
  contract: ToolCapabilityContract | null,
  missingSlots: string[],
  action: AgentToolAction,
  confirmationRequired = false,
): CapabilityAuthorization {
  return {
    allowed: false,
    code,
    reason,
    contract,
    missingSlots,
    confirmationRequired,
    idempotencyKey: fingerprintToolAction(action),
  };
}

export function authorizeAgentToolCapability(input: {
  action: AgentToolAction;
  intentResolution?: Pick<AutopilotIntentResolution, 'intent'>;
  slotExtraction?: SlotExtractionResult | null;
  enabledToolNames: string[];
  toolCatalog: AgentToolCatalogItem[];
  stepType?: Parameters<typeof evaluateToolCapabilityGate>[0]['stepType'];
  confirmedActionFingerprint?: string | null;
  enforceConfirmation?: boolean;
  minScore?: number;
}): CapabilityAuthorization {
  const slotExtraction = input.slotExtraction || { slots: {}, details: [], invalidSlots: [] };
  const capability = findToolCapabilityForAction({
    action: input.action,
    toolCatalog: input.toolCatalog,
  });
  const contract = contractFromCapability(capability);
  const hasSlotEvidence = input.slotExtraction != null;
  const requestedToolName = resolveRequestedToolName(input.action) || input.action.type;

  if (!contract || !capability) {
    return rejected(
      'unknown_tool',
      `Ferramenta ${requestedToolName} nao possui contrato registrado.`,
      null,
      [],
      input.action,
    );
  }

  if (!input.enabledToolNames.includes(requestedToolName) && !input.enabledToolNames.includes(input.action.type)) {
    return rejected(
      'disabled_tool',
      `Ferramenta ${requestedToolName} nao esta habilitada para este agente.`,
      contract,
      [],
      input.action,
    );
  }

  if (contract.requiresHumanApproval) {
    return rejected(
      'requires_human_approval',
      `Ferramenta ${requestedToolName} exige aprovacao humana.`,
      contract,
      [],
      input.action,
    );
  }

  const missingSlots = hasSlotEvidence
    ? missingSlotsForToolCapability({
        action: input.action,
        capability,
        slotExtraction,
      })
    : [];
  if (missingSlots.length > 0) {
    return rejected(
      'missing_slots',
      `Ferramenta ${requestedToolName} precisa dos slots: ${missingSlots.join(', ')}.`,
      contract,
      missingSlots,
      input.action,
    );
  }

  const invalidArguments = invalidRequiredArguments(input.action, contract.inputSchema);
  if (invalidArguments.length > 0) {
    return rejected(
      'invalid_arguments',
      `Argumentos obrigatorios ausentes para ${requestedToolName}: ${invalidArguments.join(', ')}.`,
      contract,
      [],
      input.action,
    );
  }

  if (input.intentResolution) {
    const gate = evaluateToolCapabilityGate({
      action: input.action,
      intentResolution: input.intentResolution,
      slotExtraction,
      enabledToolNames: input.enabledToolNames,
      toolCatalog: input.toolCatalog,
      stepType: input.stepType,
      minScore: input.minScore,
    });
    if (gate.code !== 'allowed') {
      const code = gate.code === 'intent_not_allowed' ? 'intent_not_allowed' : 'risk_policy_blocked';
      return rejected(code, gate.reason, contract, gate.missingSlots, input.action);
    }
  }

  const confirmationRequired = contract.requiresConfirmation || contract.riskLevel === 'high';
  const confirmationSatisfied = input.confirmedActionFingerprint === fingerprintToolAction(input.action);
  if (confirmationRequired && input.enforceConfirmation && !confirmationSatisfied) {
    return rejected(
      'requires_confirmation',
      `Preciso da confirmacao explicita antes de executar ${requestedToolName}.`,
      contract,
      [],
      input.action,
      true,
    );
  }

  return {
    allowed: true,
    code: 'allowed',
    reason: `Ferramenta ${requestedToolName} autorizada pelo gateway de capacidades.`,
    contract,
    missingSlots: [],
    confirmationRequired,
    idempotencyKey: fingerprintToolAction(input.action),
  };
}

export function listToolCapabilityContracts(
  toolCatalog: AgentToolCatalogItem[],
): ToolCapabilityContract[] {
  return listToolCapabilities(toolCatalog).map((capability) => ({
    name: capability.name,
    version: capability.version,
    capability: capability.capability,
    description: capability.description,
    source: capability.source,
    riskLevel: capability.riskLevel,
    sideEffect: capability.sideEffect,
    requiredSlots: capability.requiredSlots,
    permissions: capability.permissions,
    preconditions: capability.preconditions,
    postconditions: capability.postconditions,
    idempotent: capability.idempotent,
    timeoutMs: capability.timeoutMs,
    maxAttempts: capability.maxAttempts,
    requiresConfirmation: capability.requiresConfirmation,
    requiresHumanApproval: capability.requiresHumanApproval,
    inputSchema: capability.inputSchema || null,
    outputSchema: capability.outputSchema || null,
  }));
}

export function hasConfirmedCapabilityAction(input: {
  action: AgentToolAction;
  confirmedActionFingerprint?: string | null;
}): boolean {
  return Boolean(
    input.confirmedActionFingerprint
    && input.confirmedActionFingerprint === fingerprintToolAction(input.action),
  );
}
