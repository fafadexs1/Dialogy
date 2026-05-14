import type { Contact } from '@/lib/types';
import type { AiWorkflowDecision } from '@/ai/flows/workflow-classifier';
import type { AgentToolAction, AgentToolExecutionResult, AgentToolName } from '@/services/agent-tools/types';
import type { ToolRouterTeam } from '@/services/agent-tools/router';
import type { AutopilotIntentResolution, AutopilotSlotName, KnowledgeCoverage } from './intent-types';
import { getAutopilotWorkflow } from './workflows';
import { isConversationCloseRequest } from './close-intent';
import {
  extractAutopilotSlots,
  getMissingSlots,
  labelSlotForCustomer,
  type InvalidSlotDetail,
  type SlotExtractionResult,
} from './slots';

export type WorkflowExecutionMode =
  | 'continue_llm'
  | 'direct_response'
  | 'pre_response_tools';

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

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function isToolEnabled(enabledToolNames: string[], toolName: AgentToolName | string): boolean {
  return enabledToolNames.includes(toolName);
}

function findTeamByHints(teams: ToolRouterTeam[], hints: RegExp[]): ToolRouterTeam | null {
  return teams.find((team) => hints.some((pattern) => pattern.test(team.name))) || null;
}

function findHandoffTeam(input: {
  teams: ToolRouterTeam[];
  intent: AutopilotIntentResolution['intent'];
  customerMessage?: string;
}): ToolRouterTeam | null {
  const normalizedMessage = normalizeText(input.customerMessage || '');
  if (normalizedMessage) {
    const explicitTeam = input.teams.find((team) => {
      const normalizedName = normalizeText(team.name);
      return normalizedName.length >= 3 && normalizedMessage.includes(normalizedName);
    });
    if (explicitTeam) return explicitTeam;

    if (/\b(comercial|vendas|contratar|contratacao|assinar|adesao|proposta|orcamento)\b/.test(normalizedMessage)) {
      const commercialTeam = findTeamByHints(input.teams, [/\b(comercial|vendas|sales)\b/i]);
      if (commercialTeam) return commercialTeam;
    }

    if (/\b(financeiro|boleto|fatura|pix|pagamento|cobranca|mensalidade)\b/.test(normalizedMessage)) {
      const billingTeam = findTeamByHints(input.teams, [/\b(financeiro|cobranca|cobrança|billing)\b/i]);
      if (billingTeam) return billingTeam;
    }

    if (/\b(suporte|tecnico|internet|conexao|sinal|roteador|modem|wifi|wi fi|los|lentidao|lento|caiu|caindo)\b/.test(normalizedMessage)) {
      const supportTeam = findTeamByHints(input.teams, [/\b(suporte|tecnico|técnico|noc|atendimento)\b/i]);
      if (supportTeam) return supportTeam;
    }
  }

  const domainHints: Partial<Record<AutopilotIntentResolution['intent'], RegExp[]>> = {
    billing_or_payment: [/\b(financeiro|cobranca|cobrança|billing)\b/i],
    cancellation_request: [/\b(cancelamento|retencao|retenção|sucesso|atendimento)\b/i],
    troubleshooting: [/\b(suporte|tecnico|técnico|noc|atendimento)\b/i],
    support_request: [/\b(suporte|sac|atendimento|help)\b/i],
    complaint: [/\b(sac|ouvidoria|suporte|atendimento|qualidade)\b/i],
    human_handoff: [/\b(atendimento|suporte|sac|help|humano)\b/i],
  };

  const hinted = findTeamByHints(input.teams, domainHints[input.intent] || []);
  return hinted
    || input.teams.find((team) => team.routingConfig?.enabled && team.routingConfig.autoTransfer !== false)
    || input.teams[0]
    || null;
}

function buildInternalNote(input: {
  contact?: Contact | null;
  customerMessage: string;
  reason: string;
}) {
  const prefix = input.contact?.name ? `${input.contact.name}: ` : '';
  const compact = input.customerMessage.replace(/\s+/g, ' ').trim().slice(0, 180);
  return `${prefix}${compact}. Workflow: ${input.reason}.`;
}

function buildTransferActions(input: {
  team: ToolRouterTeam;
  customerMessage: string;
  reason: string;
  contact?: Contact | null;
  enabledToolNames: string[];
}): AgentToolAction[] {
  const actions: AgentToolAction[] = [];
  if (isToolEnabled(input.enabledToolNames, 'add_internal_note')) {
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

  actions.push({
    type: 'transfer_chat',
    reason: input.reason,
    payload: { teamId: input.team.id },
  });

  return actions;
}

function askForMissingSlots(missingSlots: AutopilotSlotName[], intent: AutopilotIntentResolution['intent']): string {
  if (missingSlots.length === 1) {
    const slot = missingSlots[0];
    if (slot === 'customer_identifier') {
      return 'Para consultar com seguranca, me informe o CPF/CNPJ ou identificador cadastrado.';
    }
    if (slot === 'date') {
      return 'Qual data voce prefere?';
    }
    if (slot === 'time') {
      return 'Qual horario fica melhor para voce?';
    }
    if (slot === 'order_or_request_id') {
      return 'Me informe o numero do pedido, protocolo ou solicitacao para eu localizar corretamente.';
    }
    return `Para seguir, me informe ${labelSlotForCustomer(slot)}.`;
  }

  if (intent === 'scheduling_request') {
    return 'Para agendar, me informe a data e o horario de preferencia.';
  }

  return `Para seguir com seguranca, me informe: ${missingSlots.map(labelSlotForCustomer).join(', ')}.`;
}

function hasCustomerIdentifierFromMessage(slotExtraction: SlotExtractionResult): boolean {
  return slotExtraction.details.some((detail) => (
    detail.name === 'customer_identifier' && detail.source === 'message'
  ));
}

function hasCustomerIdentifier(slotExtraction: SlotExtractionResult): boolean {
  return Boolean(slotExtraction.slots.customer_identifier);
}

function hasRecentSuccessfulCustomerLookup(results?: AgentToolExecutionResult[] | null): boolean {
  return Boolean((results || []).some((result) => (
    result.status === 'success' &&
    (
      result.toolName === 'sgp_fetch_contact_panel_data' ||
      result.toolName === 'sgp_fetch_contracts'
    ) &&
    Boolean(result.output)
  )));
}

function hasInvalidCustomerIdentifier(invalidSlots: InvalidSlotDetail[]): boolean {
  return invalidSlots.some((slot) => slot.name === 'customer_identifier');
}

function hasOperationalLookupIntent(message: string): boolean {
  const normalized = normalizeText(message);
  return /\b(consult|verific|checar|status|internet|wifi|wi fi|fibra|sinal|conexao|conexao|fatura|boleto|pagamento|cadastro|contratos?|pedido|protocolo|funciona|erro|falha|ruim|lento|lentidao|cai|caiu|caindo|rompeu|rompida|rompido|suporte|los|loss|sem acesso|sem sinal)\b/.test(normalized);
}

function hasOperationalLookupContext(message: string, chatHistory?: string): boolean {
  return hasOperationalLookupIntent(`${chatHistory || ''}\n${message}`);
}

function hasOperationalDocumentLookupIntent(message: string): boolean {
  const normalized = normalizeText(message);
  const mentionsContractOrRegistration = /\b(contratos?|cadastro|dados cadastrais|assinatura)\b/.test(normalized);
  const asksForOperationalInfo = /\b(informac|dados|status|situacao|consult|verific|checar|sobre|detalhes?|quais|quantos?|lista|listar|mostra|mostrar|tenho)\b/.test(normalized);
  const asksForDocumentCopy = /\b(enviar|manda|mandar|emitir|baixar|download|copia|segunda via|2a via|pdf|documento)\b/.test(normalized);

  return mentionsContractOrRegistration && (asksForOperationalInfo || asksForDocumentCopy);
}

function buildCustomerIdentifierFields(input: {
  value: string;
  mappings?: WorkflowSlotMappings;
}): Record<string, string> {
  const keys = input.mappings?.customerIdentifierFieldKeys?.filter(Boolean) || [];
  const fallbackKeys = ['CPF/CNPJ', 'CPF', 'CNPJ', 'Documento'];
  return Array.from(new Set([...keys, ...fallbackKeys])).reduce<Record<string, string>>((fields, key) => {
    fields[key] = input.value;
    return fields;
  }, {});
}

function buildSgpLookupActions(input: {
  slotExtraction: SlotExtractionResult;
  enabledToolNames: string[];
  mappings?: WorkflowSlotMappings;
  reason: string;
}): AgentToolAction[] {
  if (!isToolEnabled(input.enabledToolNames, 'sgp_fetch_contact_panel_data')) return [];

  const actions: AgentToolAction[] = [];
  const identifier = input.slotExtraction.slots.customer_identifier;

  if (
    identifier &&
    hasCustomerIdentifierFromMessage(input.slotExtraction) &&
    isToolEnabled(input.enabledToolNames, 'crm_update_contact_custom_fields')
  ) {
    actions.push({
      type: 'crm_update_contact_custom_fields',
      reason: 'Salvar identificador informado pelo cliente antes da consulta operacional.',
      payload: {
        fields: buildCustomerIdentifierFields({
          value: identifier,
          mappings: input.mappings,
        }),
      },
    });
  }

  actions.push({
    type: 'sgp_fetch_contact_panel_data',
    reason: input.reason,
    payload: {},
  });

  return actions;
}

function shouldAskCustomerIdentifierForOperationalWorkflow(input: {
  intent: AutopilotIntentResolution['intent'];
  customerMessage: string;
  enabledToolNames: string[];
  slotExtraction: SlotExtractionResult;
  recentToolResults?: AgentToolExecutionResult[] | null;
}) {
  if (hasCustomerIdentifier(input.slotExtraction)) return false;
  if (hasRecentSuccessfulCustomerLookup(input.recentToolResults)) return false;
  if (!isToolEnabled(input.enabledToolNames, 'sgp_fetch_contact_panel_data')) return false;
  if (input.intent === 'billing_or_payment') return true;
  if (input.intent === 'order_or_request_status') return !input.slotExtraction.slots.order_or_request_id;
  if (input.intent === 'troubleshooting') return true;
  if (input.intent === 'support_request') return hasOperationalLookupIntent(input.customerMessage);
  if (input.intent === 'document_request') return hasOperationalDocumentLookupIntent(input.customerMessage);
  return false;
}

function shouldCloseFromHybridSignal(input: {
  customerMessage: string;
  closeIntentGate?: CloseIntentGateDecision;
}) {
  const gate = input.closeIntentGate;
  const gateUnavailable = !gate?.reason || ['missing_api_key', 'invalid_gate_response'].includes(gate.reason);
  if (gate && !gateUnavailable) {
    if (gate.execute && gate.confidence !== 'low') {
      return {
        shouldClose: true,
        reason: `Classificador de encerramento aprovou close_chat (${gate.confidence}): ${gate.reason || 'sem motivo'}.`,
      };
    }

    return { shouldClose: false, reason: null };
  }

  if (isConversationCloseRequest(input.customerMessage)) {
    return { shouldClose: true, reason: 'Cliente pediu explicitamente para encerrar o atendimento.' };
  }

  if (gate?.execute && gate.confidence !== 'low') {
    return {
      shouldClose: true,
      reason: `Classificador de encerramento aprovou close_chat (${gate.confidence}): ${gate.reason || 'sem motivo'}.`,
    };
  }

  return { shouldClose: false, reason: null };
}

function getAiSuggestedLookupTool(decision?: AiWorkflowDecision | null): 'sgp_fetch_contact_panel_data' | 'sgp_fetch_contracts' | null {
  if (!decision?.shouldUseTools || decision.confidence < 0.55) return null;
  if (decision.suggestedTools.includes('sgp_fetch_contact_panel_data')) return 'sgp_fetch_contact_panel_data';
  if (decision.suggestedTools.includes('sgp_fetch_contracts')) return 'sgp_fetch_contracts';
  return null;
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
  now?: Date;
}): AutopilotWorkflowPlan {
  const workflow = getAutopilotWorkflow(input.intentResolution.intent);
  const slotExtraction = extractAutopilotSlots({
    customerMessage: input.customerMessage,
    chatHistory: input.chatHistory,
    contact: input.contact,
    now: input.now,
  });
  const missingSlots = getMissingSlots(workflow.requiredSlots, slotExtraction.slots);
  const baseMetadata = {
    workflowId: workflow.id,
    intent: input.intentResolution.intent,
    extractedSlots: slotExtraction.slots,
    invalidSlots: slotExtraction.invalidSlots,
    knowledgeCoverage: input.knowledgeCoverage,
    recentToolMemory: hasRecentSuccessfulCustomerLookup(input.recentToolResults),
  };

  if (hasInvalidCustomerIdentifier(slotExtraction.invalidSlots)) {
    return {
      executionMode: 'direct_response',
      response: 'O CPF/CNPJ informado parece invalido. Pode conferir e me enviar novamente?',
      actions: [],
      reason: 'Identificador do cliente invalido.',
      missingSlots: ['customer_identifier'],
      slotExtraction,
      handledByWorkflow: true,
      metadata: baseMetadata,
    };
  }

  const closeDecision = shouldCloseFromHybridSignal({
    customerMessage: input.customerMessage,
    closeIntentGate: input.closeIntentGate,
  });
  if (closeDecision.shouldClose) {
    const reason = closeDecision.reason || 'Cliente pediu para encerrar o atendimento.';

    if (isToolEnabled(input.enabledToolNames, 'close_chat')) {
      return {
        executionMode: 'direct_response',
        response: 'Atendimento encerrado conforme solicitado.',
        actions: [{
          type: 'close_chat',
          reason,
          payload: {
            notes: `${reason} Mensagem: ${input.customerMessage.replace(/\s+/g, ' ').trim().slice(0, 220)}`,
            sendCloseMessage: false,
          },
        }],
        reason,
        missingSlots: [],
        slotExtraction,
        handledByWorkflow: true,
        metadata: { ...baseMetadata, closeRequested: true },
      };
    }

    return {
      executionMode: 'direct_response',
      response: 'Entendido. Nao vou enviar novas mensagens por aqui agora, mas a ferramenta de encerramento nao esta habilitada neste agente.',
      actions: isToolEnabled(input.enabledToolNames, 'add_internal_note')
        ? [{
            type: 'add_internal_note',
            reason,
            payload: {
              content: buildInternalNote({
                contact: input.contact,
                customerMessage: input.customerMessage,
                reason: 'Pedido de encerramento sem close_chat habilitado.',
              }),
            },
          }]
        : [],
      reason: 'Pedido de encerramento sem ferramenta close_chat habilitada.',
      missingSlots: [],
      slotExtraction,
      handledByWorkflow: true,
      metadata: { ...baseMetadata, closeRequested: true, closeToolDisabled: true },
    };
  }

  if (input.intentResolution.intent === 'human_handoff') {
    if (isToolEnabled(input.enabledToolNames, 'transfer_chat')) {
      const team = findHandoffTeam({
        teams: input.availableTeams,
        intent: input.intentResolution.intent,
        customerMessage: input.customerMessage,
      });

      if (team) {
        const reason = 'Workflow de atendimento humano acionado por pedido explicito do cliente.';
        return {
          executionMode: 'direct_response',
          response: `Vou encaminhar seu atendimento para a equipe ${team.name}.`,
          actions: buildTransferActions({
            team,
            customerMessage: input.customerMessage,
            reason,
            contact: input.contact,
            enabledToolNames: input.enabledToolNames,
          }),
          reason,
          missingSlots: [],
          slotExtraction,
          handledByWorkflow: true,
          metadata: { ...baseMetadata, teamId: team.id, teamName: team.name },
        };
      }
    }

    return {
      executionMode: 'direct_response',
      response: 'Entendi. Vou sinalizar que voce quer atendimento humano, mas nao encontrei uma equipe de destino configurada para transferir automaticamente.',
      actions: isToolEnabled(input.enabledToolNames, 'add_internal_note')
        ? [{
            type: 'add_internal_note',
            reason: 'Cliente pediu atendimento humano, mas nao ha equipe configurada para transferencia automatica.',
            payload: {
              content: buildInternalNote({
                contact: input.contact,
                customerMessage: input.customerMessage,
                reason: 'Pedido de humano sem equipe configurada.',
              }),
            },
          }]
        : [],
      reason: 'Pedido humano sem destino automatico.',
      missingSlots: [],
      slotExtraction,
      handledByWorkflow: true,
      metadata: baseMetadata,
    };
  }

  const aiSuggestedLookupTool = getAiSuggestedLookupTool(input.aiWorkflowDecision);
  if (
    aiSuggestedLookupTool &&
    input.aiWorkflowDecision?.needsCustomerIdentifier &&
    !hasCustomerIdentifier(slotExtraction) &&
    !hasRecentSuccessfulCustomerLookup(input.recentToolResults)
  ) {
    return {
      executionMode: 'direct_response',
      response: askForMissingSlots(['customer_identifier'], input.intentResolution.intent),
      actions: [],
      reason: `Classificador IA de workflow pediu identificador antes de consultar ferramenta: ${input.aiWorkflowDecision.reason || 'sem motivo'}.`,
      missingSlots: ['customer_identifier'],
      slotExtraction,
      handledByWorkflow: true,
      metadata: {
        ...baseMetadata,
        aiWorkflowDecision: input.aiWorkflowDecision,
      },
    };
  }

  if (
    aiSuggestedLookupTool &&
    hasCustomerIdentifier(slotExtraction) &&
    isToolEnabled(input.enabledToolNames, aiSuggestedLookupTool)
  ) {
    const actions = buildSgpLookupActions({
      slotExtraction,
      enabledToolNames: input.enabledToolNames,
      mappings: input.slotMappings,
      reason: `Classificador IA de workflow recomendou consulta operacional: ${input.aiWorkflowDecision?.reason || 'sem motivo'}.`,
    });

    if (actions.length > 0) {
      return {
        executionMode: 'pre_response_tools',
        response: null,
        actions,
        reason: 'Workflow IA recomendou consulta operacional antes de responder.',
        missingSlots: [],
        slotExtraction,
        handledByWorkflow: true,
        metadata: {
          ...baseMetadata,
          plannedTools: actions.map((action) => action.type),
          aiWorkflowDecision: input.aiWorkflowDecision,
        },
      };
    }
  }

  if (shouldAskCustomerIdentifierForOperationalWorkflow({
    intent: input.intentResolution.intent,
    customerMessage: input.customerMessage,
    enabledToolNames: input.enabledToolNames,
    slotExtraction,
    recentToolResults: input.recentToolResults,
  })) {
    return {
      executionMode: 'direct_response',
      response: askForMissingSlots(['customer_identifier'], input.intentResolution.intent),
      actions: [],
      reason: 'Workflow operacional precisa de identificador antes de consultar ferramenta.',
      missingSlots: ['customer_identifier'],
      slotExtraction,
      handledByWorkflow: true,
      metadata: baseMetadata,
    };
  }

  if (input.intentResolution.intent === 'billing_or_payment' && hasCustomerIdentifier(slotExtraction)) {
    const actions = buildSgpLookupActions({
      slotExtraction,
      enabledToolNames: input.enabledToolNames,
      mappings: input.slotMappings,
      reason: 'Workflow financeiro consultando dados do cliente antes de responder.',
    });

    if (actions.length > 0) {
      return {
        executionMode: 'pre_response_tools',
        response: null,
        actions,
        reason: 'Workflow financeiro com slots suficientes para consulta.',
        missingSlots: [],
        slotExtraction,
        handledByWorkflow: true,
        metadata: { ...baseMetadata, plannedTools: actions.map((action) => action.type) },
      };
    }
  }

  if (
    (
      input.intentResolution.intent === 'troubleshooting' ||
      input.intentResolution.intent === 'support_request' ||
      input.intentResolution.intent === 'unknown' ||
      (
        input.intentResolution.intent === 'document_request' &&
        hasOperationalDocumentLookupIntent(input.customerMessage)
      )
    ) &&
    hasCustomerIdentifier(slotExtraction) &&
    hasOperationalLookupContext(input.customerMessage, input.chatHistory)
  ) {
    const actions = buildSgpLookupActions({
      slotExtraction,
      enabledToolNames: input.enabledToolNames,
      mappings: input.slotMappings,
      reason: 'Workflow de suporte consultando dados operacionais antes de responder.',
    });

    if (actions.length > 0) {
      return {
        executionMode: 'pre_response_tools',
        response: null,
        actions,
        reason: 'Workflow operacional com identificador suficiente para consulta.',
        missingSlots: [],
        slotExtraction,
        handledByWorkflow: true,
        metadata: { ...baseMetadata, plannedTools: actions.map((action) => action.type) },
      };
    }
  }

  if (input.intentResolution.intent === 'scheduling_request' && missingSlots.length > 0) {
    return {
      executionMode: 'direct_response',
      response: askForMissingSlots(missingSlots, input.intentResolution.intent),
      actions: [],
      reason: 'Workflow de agendamento precisa preencher data/horario.',
      missingSlots,
      slotExtraction,
      handledByWorkflow: true,
      metadata: baseMetadata,
    };
  }

  if (input.intentResolution.intent === 'order_or_request_status' && missingSlots.length > 0) {
    return {
      executionMode: 'direct_response',
      response: askForMissingSlots(missingSlots, input.intentResolution.intent),
      actions: [],
      reason: 'Workflow de status precisa de identificador do pedido/solicitacao.',
      missingSlots,
      slotExtraction,
      handledByWorkflow: true,
      metadata: baseMetadata,
    };
  }

  if (
    (input.intentResolution.intent === 'support_request' || input.intentResolution.intent === 'troubleshooting') &&
    input.knowledgeCoverage === 'none' &&
    !hasOperationalLookupIntent(input.customerMessage)
  ) {
    return {
      executionMode: 'direct_response',
      response: 'Me passe um pouco mais de detalhe sobre o que esta acontecendo para eu orientar corretamente.',
      actions: [],
      reason: 'Workflow de suporte sem contexto suficiente precisa de esclarecimento.',
      missingSlots: [],
      slotExtraction,
      handledByWorkflow: true,
      metadata: baseMetadata,
    };
  }

  return {
    executionMode: 'continue_llm',
    response: null,
    actions: [],
    reason: 'Workflow nao precisou intervir antes do LLM.',
    missingSlots,
    slotExtraction,
    handledByWorkflow: false,
    metadata: baseMetadata,
  };
}
