import type { AgentToolAction, AgentToolName } from '@/services/agent-tools/types';
import type { AutopilotIntentResolution, AutopilotSlotName } from './intent-types';

export type ToolPrearmSignal = {
  toolName: AgentToolName;
  status: 'prearmed';
  reason: string;
  missingSlots: AutopilotSlotName[];
  intent: AutopilotIntentResolution['intent'];
  confidence: number;
};

const CUSTOMER_LOOKUP_INTENTS = new Set<AutopilotIntentResolution['intent']>([
  'billing_or_payment',
  'support_request',
  'troubleshooting',
  'order_or_request_status',
  'document_request',
  'purchase_inquiry',
  'availability_request',
]);

const CUSTOMER_LOOKUP_TOOLS: AgentToolName[] = [
  'sgp_fetch_contact_panel_data',
  'sgp_fetch_contracts',
];

function firstEnabledTool(enabledToolNames: string[], candidates: AgentToolName[]): AgentToolName | null {
  return candidates.find((toolName) => enabledToolNames.includes(toolName)) || null;
}

export function deriveToolPrearmSignal(input: {
  intentResolution: AutopilotIntentResolution;
  missingSlots: AutopilotSlotName[];
  enabledToolNames: string[];
  plannedActions?: AgentToolAction[] | null;
  reason?: string | null;
}): ToolPrearmSignal | null {
  const missingSlots = Array.from(new Set(input.missingSlots || []));
  if (missingSlots.length === 0) return null;

  const plannedLookupAction = (input.plannedActions || []).find((action) => (
    CUSTOMER_LOOKUP_TOOLS.includes(action.type as AgentToolName)
  ));

  const toolName = (plannedLookupAction?.type as AgentToolName | undefined) ||
    (
      CUSTOMER_LOOKUP_INTENTS.has(input.intentResolution.intent) &&
      missingSlots.includes('customer_identifier')
        ? firstEnabledTool(input.enabledToolNames, CUSTOMER_LOOKUP_TOOLS)
        : null
    );

  if (!toolName) return null;

  return {
    toolName,
    status: 'prearmed',
    missingSlots,
    intent: input.intentResolution.intent,
    confidence: input.intentResolution.confidence,
    reason: input.reason || 'Ferramenta pre-engatilhada aguardando dados obrigatorios.',
  };
}

export function buildToolPrearmContent(signal: ToolPrearmSignal): string {
  const slots = signal.missingSlots.join(', ');
  return `Tool pre-engatilhada: ${signal.toolName}. Aguardando ${slots}.`;
}
