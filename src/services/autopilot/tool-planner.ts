import type { Contact } from '@/lib/types';
import { getAgentToolDefinition, type AgentToolCatalogItem, type AgentToolDefinition } from '@/services/agent-tools/catalog';
import type { AgentToolAction, AgentToolName } from '@/services/agent-tools/types';
import type { ToolRouterTeam } from '@/services/agent-tools/router';
import type { AutopilotIntentResolution, AutopilotSlotName } from './intent-types';
import { labelSlotForCustomer, type SlotExtractionResult } from './slots';

export type ToolPlannerRejectedAction = {
  action: AgentToolAction;
  code:
    | 'unknown_tool'
    | 'disabled_tool'
    | 'intent_not_allowed'
    | 'missing_slots'
    | 'requires_human_approval'
    | 'invalid_payload';
  reason: string;
  missingSlots?: AutopilotSlotName[];
};

export type ToolPlannerPromiseValidation = {
  promisedExternalLookup: boolean;
  hasExecutableLookupTool: boolean;
  repairReason?: string | null;
};

export type ToolPlannerResult = {
  actions: AgentToolAction[];
  rejectedActions: ToolPlannerRejectedAction[];
  responseOverride?: string | null;
  promiseValidation: ToolPlannerPromiseValidation;
  metadata: Record<string, unknown>;
};

const LOOKUP_TOOL_TYPES = new Set<AgentToolAction['type']>([
  'sgp_fetch_contracts',
  'sgp_fetch_contact_panel_data',
  'mcp_call_tool',
]);

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function resolveRequestedToolName(action: AgentToolAction): string {
  if (action.type === 'mcp_call_tool') return action.payload?.toolName?.trim() || '';
  return action.type;
}

function findRuntimeDefinition(
  action: AgentToolAction,
  toolCatalog: AgentToolCatalogItem[]
): AgentToolDefinition | AgentToolCatalogItem | null {
  const requestedToolName = resolveRequestedToolName(action);
  return toolCatalog.find((tool) => tool.name === requestedToolName || tool.name === action.type) ||
    getAgentToolDefinition(action.type as AgentToolName);
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

function missingSlotsForAction(input: {
  action: AgentToolAction;
  definition: AgentToolDefinition | AgentToolCatalogItem;
  slotExtraction: SlotExtractionResult;
}): AutopilotSlotName[] {
  return (input.definition.requiredSlots || []).filter((slot) => (
    !input.slotExtraction.slots[slot] && !slotSatisfiedByActionPayload(input.action, slot)
  ));
}

function validatePayload(action: AgentToolAction): string | null {
  if (action.type === 'mcp_call_tool') {
    if (!action.payload?.toolName?.trim()) return 'Ferramenta MCP sem toolName.';
    if (action.payload.arguments != null && (typeof action.payload.arguments !== 'object' || Array.isArray(action.payload.arguments))) {
      return 'Argumentos MCP devem ser um objeto JSON.';
    }
  }

  if (action.type === 'crm_update_contact_custom_fields') {
    const fields = action.payload?.fields;
    if (!fields || typeof fields !== 'object' || Array.isArray(fields) || Object.keys(fields).length === 0) {
      return 'Atualizacao de CRM sem campos validos.';
    }
  }

  if (action.type === 'close_chat') {
    const payload = action.payload || {};
    if (payload.reasonTagId != null && typeof payload.reasonTagId !== 'string') {
      return 'reasonTagId do encerramento deve ser texto ou nulo.';
    }
    if (payload.notes != null && typeof payload.notes !== 'string') {
      return 'notes do encerramento deve ser texto ou nulo.';
    }
    if (payload.sendCloseMessage != null && typeof payload.sendCloseMessage !== 'boolean') {
      return 'sendCloseMessage do encerramento deve ser booleano ou nulo.';
    }
  }

  if (action.type === 'sgp_generate_invoice_pix') {
    if (!action.payload?.invoiceId || !action.payload?.contractId) {
      return 'Geracao de PIX exige invoiceId e contractId.';
    }
  }

  if (action.type === 'sgp_create_payment_promise') {
    if (!action.payload?.contractId || !action.payload?.promiseDate) {
      return 'Promessa de pagamento exige contractId e promiseDate.';
    }
  }

  return null;
}

export function hasExternalLookupPromise(response: string | null | undefined): boolean {
  const normalized = normalizeText(response || '');
  if (!normalized) return false;

  return (
    /\b(vou|irei|vamos|posso|consigo|deixa eu|deixe me|estou|to)\s+(verificar|consultar|checar|conferir|validar|buscar|olhar|acessar)\b/.test(normalized) &&
    /\b(sistema|cadastro|contrato|fatura|boleto|pagamento|pedido|protocolo|status|conexao|sinal|agenda|estoque|disponibilidade|dados)\b/.test(normalized)
  ) || (
    /\b(?:para|pra)\s+(?:verificar|consultar|checar|conferir|validar|buscar|olhar|acessar)\b/.test(normalized) &&
    /\b(?:vou|vamos|preciso|vou precisar|precisamos|me informe|envie|manda|mandar)\b/.test(normalized) &&
    /\b(sistema|cadastro|contrato|fatura|boleto|pagamento|pedido|protocolo|status|conexao|sinal|agenda|estoque|disponibilidade|dados)\b/.test(normalized)
  );
}

function hasExecutableLookupAction(actions: AgentToolAction[]): boolean {
  return actions.some((action) => LOOKUP_TOOL_TYPES.has(action.type));
}

function findHandoffTeam(input: {
  intent: AutopilotIntentResolution['intent'];
  availableTeams: ToolRouterTeam[];
}): ToolRouterTeam | null {
  const hints: Partial<Record<AutopilotIntentResolution['intent'], RegExp[]>> = {
    billing_or_payment: [/\b(financeiro|cobranca|cobrança|billing)\b/i],
    support_request: [/\b(suporte|sac|atendimento|help)\b/i],
    troubleshooting: [/\b(suporte|tecnico|técnico|noc|atendimento)\b/i],
    order_or_request_status: [/\b(suporte|atendimento|operacao|operação|logistica|logística)\b/i],
    human_handoff: [/\b(atendimento|suporte|sac|help|humano)\b/i],
    complaint: [/\b(sac|ouvidoria|qualidade|atendimento)\b/i],
  };
  const intentHints = hints[input.intent] || [];
  return input.availableTeams.find((team) => intentHints.some((pattern) => pattern.test(team.name))) ||
    input.availableTeams.find((team) => team.routingConfig?.enabled && team.routingConfig.autoTransfer !== false) ||
    input.availableTeams[0] ||
    null;
}

function buildInternalNote(input: {
  contact?: Contact | null;
  customerMessage: string;
  reason: string;
}) {
  const prefix = input.contact?.name ? `${input.contact.name}: ` : '';
  return `${prefix}${input.customerMessage.replace(/\s+/g, ' ').trim().slice(0, 180)}. Tool planner: ${input.reason}.`;
}

function buildTransferActions(input: {
  team: ToolRouterTeam;
  enabledToolNames: string[];
  customerMessage: string;
  contact?: Contact | null;
  reason: string;
}): AgentToolAction[] {
  const actions: AgentToolAction[] = [];
  if (input.enabledToolNames.includes('add_internal_note')) {
    actions.push({
      type: 'add_internal_note',
      reason: input.reason,
      payload: {
        content: buildInternalNote({
          contact: input.contact,
          customerMessage: input.customerMessage,
          reason: input.reason,
        }),
      },
    });
  }
  if (input.enabledToolNames.includes('transfer_chat')) {
    actions.push({
      type: 'transfer_chat',
      reason: input.reason,
      payload: { teamId: input.team.id },
    });
  }
  return actions;
}

function missingSlotResponse(missingSlots: AutopilotSlotName[]): string {
  if (missingSlots.includes('customer_identifier')) {
    return 'Para consultar com seguranca, me informe o CPF/CNPJ ou identificador cadastrado.';
  }

  if (missingSlots.includes('invoice_or_payment_id')) {
    return 'Para consultar essa cobranca com seguranca, me informe o numero da fatura ou boleto.';
  }

  if (missingSlots.includes('date')) {
    return 'Para seguir, me informe a data.';
  }

  return `Para seguir com seguranca, me informe: ${missingSlots.map(labelSlotForCustomer).join(', ')}.`;
}

export function planAutopilotTools(input: {
  response: string | null | undefined;
  customerMessage: string;
  intentResolution: AutopilotIntentResolution;
  slotExtraction: SlotExtractionResult;
  actions: AgentToolAction[];
  enabledToolNames: string[];
  toolCatalog: AgentToolCatalogItem[];
  availableTeams: ToolRouterTeam[];
  contact?: Contact | null;
}): ToolPlannerResult {
  const rejectedActions: ToolPlannerRejectedAction[] = [];
  const acceptedActions: AgentToolAction[] = [];

  for (const action of input.actions) {
    const definition = findRuntimeDefinition(action, input.toolCatalog);
    if (!definition) {
      rejectedActions.push({
        action,
        code: 'unknown_tool',
        reason: `Ferramenta ${action.type} nao possui contrato registrado.`,
      });
      continue;
    }

    const payloadError = validatePayload(action);
    if (payloadError) {
      rejectedActions.push({ action, code: 'invalid_payload', reason: payloadError });
      continue;
    }

    if (!isToolEnabled({ action, enabledToolNames: input.enabledToolNames })) {
      rejectedActions.push({
        action,
        code: 'disabled_tool',
        reason: `Ferramenta ${resolveRequestedToolName(action) || action.type} nao esta habilitada para este agente.`,
      });
      continue;
    }

    if (definition.requiresHumanApproval) {
      rejectedActions.push({
        action,
        code: 'requires_human_approval',
        reason: `Ferramenta ${resolveRequestedToolName(action) || action.type} exige aprovacao humana.`,
      });
      continue;
    }

    if (definition.allowedIntents.length > 0 && !definition.allowedIntents.includes(input.intentResolution.intent)) {
      rejectedActions.push({
        action,
        code: 'intent_not_allowed',
        reason: `Ferramenta ${resolveRequestedToolName(action) || action.type} nao e permitida para a intencao ${input.intentResolution.intent}.`,
      });
      continue;
    }

    const missingSlots = missingSlotsForAction({
      action,
      definition,
      slotExtraction: input.slotExtraction,
    });
    if (missingSlots.length > 0) {
      rejectedActions.push({
        action,
        code: 'missing_slots',
        reason: `Ferramenta ${resolveRequestedToolName(action) || action.type} precisa de slots ausentes: ${missingSlots.join(', ')}.`,
        missingSlots,
      });
      continue;
    }

    acceptedActions.push(action);
  }

  const promisedExternalLookup = hasExternalLookupPromise(input.response);
  const hasExecutableLookupTool = hasExecutableLookupAction(acceptedActions);
  let responseOverride: string | null = null;
  let repairReason: string | null = null;

  const missingSlotRejection = rejectedActions.find((item) => item.code === 'missing_slots' && item.missingSlots?.length);
  if (promisedExternalLookup && !hasExecutableLookupTool) {
    if (missingSlotRejection?.missingSlots?.length) {
      responseOverride = missingSlotResponse(missingSlotRejection.missingSlots);
      repairReason = 'promise_missing_slots';
    } else {
      const team = input.enabledToolNames.includes('transfer_chat')
        ? findHandoffTeam({
            intent: input.intentResolution.intent,
            availableTeams: input.availableTeams,
          })
        : null;

      if (team) {
        const reason = 'Resposta prometeu consulta, mas nao ha ferramenta executavel segura para cumprir.';
        acceptedActions.push(...buildTransferActions({
          team,
          enabledToolNames: input.enabledToolNames,
          customerMessage: input.customerMessage,
          contact: input.contact,
          reason,
        }));
        responseOverride = `Nao consigo consultar isso automaticamente com seguranca agora. Vou encaminhar seu atendimento para a equipe ${team.name}.`;
        repairReason = 'promise_handoff';
      } else {
        responseOverride = 'Nao tenho uma ferramenta de consulta habilitada para verificar isso automaticamente agora. Vou evitar te passar uma informacao incerta.';
        repairReason = 'promise_without_tool';
      }
    }
  }

  return {
    actions: acceptedActions,
    rejectedActions,
    responseOverride,
    promiseValidation: {
      promisedExternalLookup,
      hasExecutableLookupTool,
      repairReason,
    },
    metadata: {
      acceptedActions: acceptedActions.map((action) => resolveRequestedToolName(action) || action.type),
      rejectedActions: rejectedActions.map((item) => ({
        tool: resolveRequestedToolName(item.action) || item.action.type,
        code: item.code,
        reason: item.reason,
        missingSlots: item.missingSlots || [],
      })),
      promiseValidation: {
        promisedExternalLookup,
        hasExecutableLookupTool,
        repairReason,
      },
    },
  };
}
