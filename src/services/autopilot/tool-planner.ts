import type { Contact } from '@/lib/types';
import type { AgentToolCatalogItem } from '@/services/agent-tools/catalog';
import type { AgentToolAction } from '@/services/agent-tools/types';
import { shouldHandoffToHuman, type ToolRouterTeam } from '@/services/agent-tools/router';
import type { AutopilotIntentResolution, AutopilotSlotName } from './intent-types';
import type { ToolSelectionScoreWeights } from './score-history';
import { labelSlotForCustomer, type SlotExtractionResult } from './slots';
import { evaluateToolCapabilityGate, resolveRequestedToolName, type ToolCapabilityGateCode } from './tool-capability-registry';
import { hasClinicalRedFlagSignal } from './clinical-triage';

export type ToolPlannerRejectedAction = {
  action: AgentToolAction;
  code:
    | 'unknown_tool'
    | 'disabled_tool'
    | 'intent_not_allowed'
    | 'forbidden_goal'
    | 'missing_slots'
    | 'requires_human_approval'
    | 'step_not_allowed'
    | 'score_below_threshold'
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

const INFORMATIONAL_INTENTS = new Set<AutopilotIntentResolution['intent']>([
  'catalog_request',
  'pricing_request',
  'promotion_request',
  'availability_request',
  'greeting',
  'thanks',
]);

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
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

  if (
    action.type === 'sgp_fetch_contact_panel_data' &&
    action.payload?.contractId != null &&
    !/^\d+$/.test(action.payload.contractId.trim())
  ) {
    return 'Consulta SGP por contrato exige contractId numerico.';
  }

  if (action.type === 'sgp_create_payment_promise') {
    if (!action.payload?.contractId || !action.payload?.promiseDate) {
      return 'Promessa de pagamento exige contractId e promiseDate.';
    }
  }

  return null;
}

type CustomerToolIntent =
  | 'wifi_credentials_lookup'
  | 'wifi_credentials_change'
  | 'wifi_channel_diagnostics'
  | 'router_reboot'
  | 'unknown';

function inferCustomerToolIntent(customerMessage: string): CustomerToolIntent {
  const normalized = normalizeText(customerMessage);
  const mentionsWifi = /\b(wi fi|wifi|ssid|rede|senha|usuario|credencia)\w*/.test(normalized);
  const wantsChange = /\b(trocar|mudar|alterar|atualizar|nova|novo|configurar)\w*/.test(normalized);
  if (/\b(reiniciar|reinicie|reboot|resetar|desligar e ligar)\w*/.test(normalized)) {
    return 'router_reboot';
  }
  if (mentionsWifi && wantsChange) return 'wifi_credentials_change';
  if (mentionsWifi && /\b(canal|canais|redes ao redor|vizin|interferencia|lento|lentidao|oscila|queda|sinal fraco|analisar)\w*/.test(normalized)) {
    return 'wifi_channel_diagnostics';
  }
  if (mentionsWifi && /\b(ver|verificar|consultar|saber|mostrar|recuperar|esqueci|qual|usuario|senha|ssid|nome da rede|credencia)\w*/.test(normalized)) {
    return 'wifi_credentials_lookup';
  }
  return 'unknown';
}

function inferActionToolIntent(action: AgentToolAction, catalog: AgentToolCatalogItem[]): CustomerToolIntent {
  const requestedToolName = resolveRequestedToolName(action) || action.type;
  const catalogItem = catalog.find((tool) => tool.name === requestedToolName);
  const normalized = normalizeText([
    requestedToolName,
    action.reason || '',
    catalogItem?.description || '',
    catalogItem?.inputSchema ? JSON.stringify(catalogItem.inputSchema) : '',
  ].join(' '));
  if (/\b(reboot_router|reboot|reiniciar|resetar)\b/.test(normalized)) return 'router_reboot';
  if (/\b(change_wifi_credentials|trocar|mudar|alterar|credentials)\b/.test(normalized) && /\b(wifi|wi fi|ssid|senha|rede)\b/.test(normalized)) {
    return 'wifi_credentials_change';
  }
  if (/\b(scan_wifi_neighbors|get_wifi_scan_cached|canal|canais|interferencia|redes ao redor|vizin|lento|lentidao)\b/.test(normalized)) {
    return 'wifi_channel_diagnostics';
  }
  if (/\b(get_wifi_view|refresh_wifi_summary|ssid|senha|usuario|credencia|nome da rede)\b/.test(normalized)) {
    return 'wifi_credentials_lookup';
  }
  return 'unknown';
}

function toolIntentMismatchReason(input: {
  action: AgentToolAction;
  customerMessage: string;
  toolCatalog: AgentToolCatalogItem[];
}): string | null {
  const customerIntent = inferCustomerToolIntent(input.customerMessage);
  const actionIntent = inferActionToolIntent(input.action, input.toolCatalog);
  if (customerIntent === 'unknown' || actionIntent === 'unknown' || customerIntent === actionIntent) return null;
  const requestedToolName = resolveRequestedToolName(input.action) || input.action.type;
  if (customerIntent === 'wifi_credentials_lookup' && actionIntent === 'router_reboot') {
    return `Ferramenta ${requestedToolName} bloqueada: cliente pediu consulta de usuario/senha/SSID do Wi-Fi, nao reboot.`;
  }
  if (customerIntent === 'wifi_credentials_lookup' && actionIntent === 'wifi_credentials_change') {
    return `Ferramenta ${requestedToolName} bloqueada: cliente pediu consulta de Wi-Fi atual, nao troca de credenciais.`;
  }
  if (customerIntent === 'wifi_channel_diagnostics' && (actionIntent === 'router_reboot' || actionIntent === 'wifi_credentials_change')) {
    return `Ferramenta ${requestedToolName} bloqueada: diagnostico de canais/interferencia exige leitura/analise antes de side effect.`;
  }
  if (customerIntent === 'wifi_credentials_change' && actionIntent === 'router_reboot') {
    return `Ferramenta ${requestedToolName} bloqueada: cliente pediu troca de Wi-Fi, nao reinicio do roteador.`;
  }
  return null;
}

function toPlannerRejectCode(code: ToolCapabilityGateCode): ToolPlannerRejectedAction['code'] {
  return code === 'allowed' ? 'unknown_tool' : code;
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
  scoringWeights?: Partial<ToolSelectionScoreWeights> | null;
}): ToolPlannerResult {
  const rejectedActions: ToolPlannerRejectedAction[] = [];
  const acceptedActions: AgentToolAction[] = [];
  const capabilityDecisions: Array<ReturnType<typeof evaluateToolCapabilityGate>> = [];
  const isInformationalIntent = INFORMATIONAL_INTENTS.has(input.intentResolution.intent);
  const explicitHumanHandoff = shouldHandoffToHuman(input.customerMessage);
  const safetyCriticalHandoff = hasClinicalRedFlagSignal(input.customerMessage);
  const handoffAllowed = explicitHumanHandoff || safetyCriticalHandoff;
  const hasImplicitTransferCandidate = input.actions.some((action) => (
    action.type === 'transfer_chat' && !handoffAllowed
  ));

  for (const action of input.actions) {
    if (
      !handoffAllowed &&
      (
        action.type === 'transfer_chat' ||
        (action.type === 'add_internal_note' && hasImplicitTransferCandidate)
      )
    ) {
      rejectedActions.push({
        action,
        code: 'intent_not_allowed',
        reason: `Ferramenta ${action.type} bloqueada: a mensagem atual nao pediu atendimento humano.`,
      });
      continue;
    }

    const mismatchReason = toolIntentMismatchReason({
      action,
      customerMessage: input.customerMessage,
      toolCatalog: input.toolCatalog,
    });
    if (mismatchReason) {
      rejectedActions.push({
        action,
        code: 'intent_not_allowed',
        reason: mismatchReason,
      });
      continue;
    }

    if (isInformationalIntent && action.type !== 'crm_update_contact_custom_fields') {
      rejectedActions.push({
        action,
        code: 'intent_not_allowed',
        reason: `Intencao informacional (${input.intentResolution.intent}): ferramenta ${resolveRequestedToolName(action) || action.type} bloqueada.`,
      });
      continue;
    }

    const capabilityGate = evaluateToolCapabilityGate({
      action,
      intentResolution: input.intentResolution,
      slotExtraction: input.slotExtraction,
      enabledToolNames: input.enabledToolNames,
      toolCatalog: input.toolCatalog,
      scoringWeights: input.scoringWeights,
    });
    capabilityDecisions.push(capabilityGate);

    if (capabilityGate.code === 'unknown_tool') {
      rejectedActions.push({
        action,
        code: 'unknown_tool',
        reason: capabilityGate.reason,
      });
      continue;
    }

    const payloadError = validatePayload(action);
    if (payloadError) {
      rejectedActions.push({ action, code: 'invalid_payload', reason: payloadError });
      continue;
    }

    if (!capabilityGate.allowed) {
      rejectedActions.push({
        action,
        code: toPlannerRejectCode(capabilityGate.code),
        reason: capabilityGate.reason,
        missingSlots: capabilityGate.missingSlots,
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
  if (promisedExternalLookup && !hasExecutableLookupTool && !isInformationalIntent) {
    if (missingSlotRejection?.missingSlots?.length) {
      responseOverride = missingSlotResponse(missingSlotRejection.missingSlots);
      repairReason = 'promise_missing_slots';
    } else {
      const team = explicitHumanHandoff && input.enabledToolNames.includes('transfer_chat')
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
        responseOverride = input.intentResolution.intent === 'troubleshooting'
          ? 'Entendi. A falha acontece em todos os seus dispositivos ou apenas em um deles?'
          : 'Nao tenho uma ferramenta de consulta habilitada para verificar isso automaticamente agora. Vou evitar te passar uma informacao incerta.';
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
      capabilityDecisions: capabilityDecisions.map((decision) => ({
        tool: decision.capability?.name || null,
        capability: decision.capability?.capability || null,
        code: decision.code,
        allowed: decision.allowed,
        score: decision.score,
        scoreBreakdown: decision.scoreBreakdown,
        missingSlots: decision.missingSlots,
        reason: decision.reason,
      })),
      promiseValidation: {
        promisedExternalLookup,
        hasExecutableLookupTool,
        repairReason,
      },
    },
  };
}
