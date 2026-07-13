import type { Contact } from '@/lib/types';
import type { AiWorkflowDecision } from '@/ai/flows/workflow-classifier';
import type { AgentToolAction, AgentToolExecutionResult } from '@/services/agent-tools/types';
import type { ToolRouterTeam } from '@/services/agent-tools/router';
import type { AutopilotIntentResolution, AutopilotSlotName, KnowledgeCoverage } from './intent-types';
import { getAutopilotWorkflow } from './workflows';
import { isConversationCloseRequest } from './close-intent';
import { extractAutopilotSlots, getMissingSlots, labelSlotForCustomer, type SlotExtractionResult } from './slots';
import { hasClinicalTriageSignal } from './clinical-triage';

export type WorkflowExecutionMode = 'continue_llm' | 'direct_response' | 'pre_response_tools';

export type AutopilotWorkflowPlan = {
  executionMode: WorkflowExecutionMode;
  response?: string | null;
  actions: AgentToolAction[];
  reason: string;
  missingSlots: AutopilotSlotName[];
  slotExtraction: SlotExtractionResult;
  handledByWorkflow: boolean;
  metadata: Record<string, unknown>;
};

export type CloseIntentGateDecision = {
  execute: boolean;
  confidence: 'low' | 'medium' | 'high';
  reason?: string | null;
} | null;

export type WorkflowSlotMappings = {
  customerIdentifierFieldKeys?: string[];
};

function normalize(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function enabled(names: string[], name: string) {
  return names.includes(name);
}

function internalNote(input: { contact?: Contact | null; message: string; reason: string }) {
  const prefix = input.contact?.name ? `${input.contact.name}: ` : '';
  return `${prefix}${input.message.replace(/\s+/g, ' ').trim().slice(0, 180)}. ${input.reason}`.slice(0, 280);
}

function findRequestedTeam(teams: ToolRouterTeam[], message: string) {
  const text = normalize(message);
  return teams.find((team) => {
    const name = normalize(team.name);
    return name.length >= 3 && text.includes(name);
  }) ?? teams[0] ?? null;
}

function fallbackPlan(input: {
  workflowId: string;
  intent: AutopilotIntentResolution['intent'];
  missingSlots: AutopilotSlotName[];
  slotExtraction: SlotExtractionResult;
  knowledgeCoverage: KnowledgeCoverage;
}) {
  return {
    executionMode: 'continue_llm' as const,
    response: null,
    actions: [],
    reason: 'Workflow universal nao precisou intervir antes do LLM.',
    missingSlots: input.missingSlots,
    slotExtraction: input.slotExtraction,
    handledByWorkflow: false,
    metadata: {
      workflowId: input.workflowId,
      intent: input.intent,
      extractedSlots: input.slotExtraction.slots,
      invalidSlots: input.slotExtraction.invalidSlots,
      knowledgeCoverage: input.knowledgeCoverage,
    },
  };
}

export function resolveAutopilotWorkflowPlan(input: {
  intentResolution: AutopilotIntentResolution;
  customerMessage: string;
  chatHistory?: string;
  contact?: Contact | null;
  enabledToolNames: string[];
  availableTeams: ToolRouterTeam[];
  knowledgeCoverage: KnowledgeCoverage;
  slotMappings?: WorkflowSlotMappings;
  closeIntentGate?: CloseIntentGateDecision;
  aiWorkflowDecision?: AiWorkflowDecision | null;
  recentToolResults?: AgentToolExecutionResult[] | null;
  slotExtraction?: SlotExtractionResult;
  now?: Date;
}): AutopilotWorkflowPlan {
  const workflow = getAutopilotWorkflow(input.intentResolution.intent);
  const slotExtraction = input.slotExtraction || extractAutopilotSlots({
    customerMessage: input.customerMessage,
    chatHistory: input.chatHistory,
    contact: input.contact,
    now: input.now,
  });
  const missingSlots = getMissingSlots(workflow.requiredSlots, slotExtraction.slots);
  const metadata = {
    workflowId: workflow.id,
    intent: input.intentResolution.intent,
    extractedSlots: slotExtraction.slots,
    invalidSlots: slotExtraction.invalidSlots,
    knowledgeCoverage: input.knowledgeCoverage,
  };

  const shouldClose = input.closeIntentGate?.execute === true
    || isConversationCloseRequest(input.customerMessage);
  if (shouldClose) {
    const reason = input.closeIntentGate?.reason || 'Cliente pediu para encerrar o atendimento.';
    return {
      executionMode: 'direct_response',
      response: enabled(input.enabledToolNames, 'close_chat')
        ? 'Atendimento encerrado conforme solicitado.'
        : 'Entendido. Nao vou enviar novas mensagens por aqui agora.',
      actions: enabled(input.enabledToolNames, 'close_chat')
        ? [{ type: 'close_chat', reason, payload: { notes: reason, sendCloseMessage: false } }]
        : [],
      reason,
      missingSlots: [],
      slotExtraction,
      handledByWorkflow: true,
      metadata: { ...metadata, closeRequested: true },
    };
  }

  if (input.intentResolution.intent === 'human_handoff') {
    const team = findRequestedTeam(input.availableTeams, input.customerMessage);
    const reason = 'Cliente solicitou atendimento humano.';
    const actions: AgentToolAction[] = [];
    if (enabled(input.enabledToolNames, 'add_internal_note')) {
      actions.push({
        type: 'add_internal_note',
        reason,
        payload: { content: internalNote({ contact: input.contact, message: input.customerMessage, reason }) },
      });
    }
    if (team && enabled(input.enabledToolNames, 'transfer_chat')) {
      actions.push({ type: 'transfer_chat', reason, payload: { teamId: team.id } });
    }
    return {
      executionMode: 'direct_response',
      response: team && enabled(input.enabledToolNames, 'transfer_chat')
        ? `Vou encaminhar seu atendimento para a equipe ${team.name}.`
        : 'Entendi. Registrei que voce quer atendimento humano.',
      actions,
      reason,
      missingSlots: [],
      slotExtraction,
      handledByWorkflow: true,
      metadata: { ...metadata, teamId: team?.id ?? null, teamName: team?.name ?? null },
    };
  }

  if (
    input.intentResolution.intent === 'scheduling_request'
    && missingSlots.length > 0
    && hasClinicalTriageSignal(input.customerMessage)
  ) {
    const plan = fallbackPlan({
      workflowId: workflow.id,
      intent: input.intentResolution.intent,
      missingSlots,
      slotExtraction,
      knowledgeCoverage: input.knowledgeCoverage,
    });

    return {
      ...plan,
      reason: 'Mensagem contem sintoma clinico/pediatrico; priorizando orientacao assistida antes de pedir horario.',
      metadata: { ...plan.metadata, clinicalTriageSignal: true },
    };
  }

  if (
    (input.intentResolution.intent === 'scheduling_request' || input.intentResolution.intent === 'order_or_request_status')
    && missingSlots.length > 0
  ) {
    return {
      executionMode: 'direct_response',
      response: `Para continuar, me informe ${missingSlots.map(labelSlotForCustomer).join(' e ')}.`,
      actions: [],
      reason: 'Workflow universal precisa de dados obrigatorios.',
      missingSlots,
      slotExtraction,
      handledByWorkflow: true,
      metadata,
    };
  }

  return fallbackPlan({
    workflowId: workflow.id,
    intent: input.intentResolution.intent,
    missingSlots,
    slotExtraction,
    knowledgeCoverage: input.knowledgeCoverage,
  });
}
