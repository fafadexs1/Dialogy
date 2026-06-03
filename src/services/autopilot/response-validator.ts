import type { Contact, KnowledgeBaseDocument } from '@/lib/types';
import type { AgentToolAction, AgentToolExecutionResult } from '@/services/agent-tools/types';
import type { ToolRouterTeam } from '@/services/agent-tools/router';
import type { AutopilotIntentResolution, AutopilotSlotName, KnowledgeCoverage } from './intent-types';
import { labelSlotForCustomer, type SlotExtractionResult } from './slots';
import { hasConversationCloseClaim } from './close-intent';
import { hasExternalLookupPromise } from './tool-planner';
import { repairTurnContinuation } from './turn-continuation';
import { buildSgpResponseFromToolResults } from '@/services/autopilot-sgp-response';

export type ResponseValidatorDecision =
  | 'approve'
  | 'repair'
  | 'replace_with_fallback'
  | 'handoff';

export type ResponseValidationResult = {
  decision: ResponseValidatorDecision;
  response: string;
  actions: AgentToolAction[];
  reasons: string[];
  metadata: Record<string, unknown>;
};

const LOOKUP_TOOL_NAMES = new Set<string>([
  'sgp_fetch_contact_panel_data',
  'sgp_fetch_contracts',
]);

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function compact(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function fallbackResponse(value?: string | null): string {
  return compact(value || '') ||
    'Estou com uma instabilidade para responder isso com seguranca agora. Nossa equipe vai acompanhar por aqui.';
}

function hasSuccessfulLookup(toolResults: AgentToolExecutionResult[]): boolean {
  return toolResults.some((result) => (
    result.status === 'success' &&
    (
      LOOKUP_TOOL_NAMES.has(String(result.toolName)) ||
      String(result.toolName).startsWith('mcp:')
    )
  ));
}

function hasFailedLookup(toolResults: AgentToolExecutionResult[]): boolean {
  return toolResults.some((result) => (
    result.status !== 'success' &&
    (
      LOOKUP_TOOL_NAMES.has(String(result.toolName)) ||
      String(result.toolName).startsWith('mcp:')
    )
  ));
}

function hasPlannedLookup(actions: AgentToolAction[]): boolean {
  return actions.some((action) => (
    action.type === 'sgp_fetch_contact_panel_data' ||
    action.type === 'sgp_fetch_contracts' ||
    action.type === 'mcp_call_tool'
  ));
}

function hasPlannedTransfer(actions: AgentToolAction[]): boolean {
  return actions.some((action) => action.type === 'transfer_chat');
}

function hasLookupSuccessClaim(response: string): boolean {
  const normalized = normalizeText(response);
  return (
    /\b(consultei|verifiquei|acessei|conferi|localizei|encontrei)\b/.test(normalized) &&
    /\b(sistema|cadastro|contrato|fatura|boleto|pagamento|pedido|protocolo|status|conexao|sinal|sgp|agenda|estoque)\b/.test(normalized)
  );
}

function asksForCustomerIdentifier(response: string): boolean {
  const normalized = normalizeText(response);
  return (
    /\b(cpf|cnpj|identificador cadastral|documento)\b/.test(normalized) &&
    /\b(informe|informar|envie|enviar|passe|passa|passar|preciso|pode me dizer|pode me informar|qual e)\b/.test(normalized)
  );
}

function asksForPaymentArtifact(message: string): boolean {
  const normalized = normalizeText(message);
  const asksToSendInvoice = (
    /\b(manda|mandar|envia|enviar|passa|passar|informa|informar|preciso|quero|gerar|emitir)\b.{0,60}\b(boleto|fatura)\b/.test(normalized) ||
    /\b(boleto|fatura)\b.{0,60}\b(manda|mandar|envia|enviar|passa|passar|informa|informar|gerar|emitir)\b/.test(normalized)
  );
  return /\b(pix|segunda via|2a via|link de pagamento|linha digitavel|codigo de barras)\b/.test(normalized) || asksToSendInvoice;
}

function hasPaymentArtifact(response: string): boolean {
  const normalized = normalizeText(response);
  return (
    /\bpix copia e cola\b/.test(normalized) ||
    /\bhttps?:\/\/\S+/i.test(response) ||
    /\b\d{5}\.?\d{5}\s+\d{5}\.?\d{6}\s+\d{5}\.?\d{6}\s+\d\s+\d{14}\b/.test(response) ||
    /\b\d{40,}\b/.test(response)
  );
}

function hasSuccessfulPaymentData(toolResults: AgentToolExecutionResult[]): boolean {
  return toolResults.some((result) => {
    if (result.status !== 'success' || result.toolName !== 'sgp_fetch_contact_panel_data') return false;
    const output = result.output as any;
    const invoices = Array.isArray(output?.invoices) ? output.invoices : [];
    return invoices.some((invoice: any) => (
      invoice &&
      invoice.isPaid !== true &&
      invoice.isCancelled !== true &&
      (invoice.isOpen === true || /\b(aberto|open|pendente|pending|vencido|overdue)\b/.test(normalizeText(String(invoice.status || '')))) &&
      Boolean(invoice.pixCode || invoice.paymentLink || invoice.digitableLine || invoice.barcode)
    ));
  });
}

function hasTransferPromise(response: string): boolean {
  const normalized = normalizeText(response);
  return /\b(vou|irei|vamos)\s+(encaminhar|transferir|passar|chamar)\b/.test(normalized) &&
    /\b(equipe|setor|atendente|humano|responsavel)\b/.test(normalized);
}

function hasExplicitHandoffRequest(message: string): boolean {
  const normalized = normalizeText(message);
  return (
    /\b(atendente|humano|pessoa|consultor|vendedor|equipe|setor)\b/.test(normalized) &&
    /\b(falar|conversar|chamar|transferir|encaminhar|passar|me passa|quero)\b/.test(normalized)
  );
}

function isSelfServiceInformationIntent(intent: AutopilotIntentResolution['intent']): boolean {
  return ['purchase_inquiry', 'catalog_request', 'pricing_request', 'promotion_request', 'availability_request'].includes(intent);
}

function hasPlannedClose(actions: AgentToolAction[]): boolean {
  return actions.some((action) => action.type === 'close_chat');
}

function hasInternalLeak(response: string): boolean {
  const trimmed = response.trim();
  if (/^[{[][\s\S]*[}\]]$/.test(trimmed) && /\b(actions|payload|toolName|triggeredRule|response|metadata)\b/i.test(trimmed)) {
    return true;
  }

  return (
    /\b(TypeError|ReferenceError|SyntaxError|stack trace|Unhandled|ECONNRESET|ETIMEDOUT)\b/i.test(response) ||
    /\b(INVALID_ARGUMENT|Schema validation|Parse Errors?:|Provided data:|Required JSON schema)\b/.test(response) ||
    /\b(api[_-]?key|authorization|bearer\s+[a-z0-9._-]+|token|command_id|cpfFieldId)\b/i.test(response) ||
    /\b(sgp_fetch_|mcp_call_tool|crm_update_contact_custom_fields|transfer_chat|close_chat|add_internal_note)\b/i.test(response)
  );
}

function hasConversationTranscriptLeak(response: string): boolean {
  const compacted = compact(response);
  const speakerLabels = compacted.match(/\b(?:Cliente|Atendente|Agente|Usuario|Usuário|Bot)\s*:/g) || [];

  return (
    speakerLabels.length >= 3 ||
    /\bCliente:\s+[\s\S]{10,}\bAtendente:\s+[\s\S]{10,}\bCliente:/.test(compacted) ||
    /\bAtendente:\s+[\s\S]{10,}\bCliente:\s+[\s\S]{10,}\bAtendente:/.test(compacted)
  );
}

function removeTechnicalFragments(response: string): string {
  const cleaned = response
    .replace(/```(?:json)?\s*([\s\S]*?)\s*```/gi, (match, p1) => {
      // If the markdown block is the ONLY thing in the response, keep its contents
      if (response.trim() === match.trim()) return p1;
      return '';
    })
    .replace(/\b(command_id|trace_id|request_id)\s*[:=]\s*[a-z0-9._-]+/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || response.trim();
}

function extractSupportedFactTokens(value: string): string[] {
  const patterns = [
    /R\$\s*\d{1,3}(?:\.\d{3})*(?:,\d{2})?/gi,
    /\b\d{1,2}\/\d{1,2}\/\d{4}\b/g,
    /https?:\/\/[^\s),]+/gi,
    /\b\d{2,4}\s*(?:mega|megas|mb|gb)\b/gi,
  ];
  return Array.from(new Set(patterns.flatMap((pattern) => value.match(pattern) || [])));
}

function unsupportedKnowledgeFacts(response: string, documents: KnowledgeBaseDocument[]): string[] {
  const evidence = normalizeText(documents.map((document) => document.content || '').join('\n'));
  return extractSupportedFactTokens(response).filter((token) => !evidence.includes(normalizeText(token)));
}

function findMissingLookupSlots(input: {
  intentResolution: AutopilotIntentResolution;
  slotExtraction: SlotExtractionResult;
}): AutopilotSlotName[] {
  if (input.slotExtraction.slots.customer_identifier) return [];
  if (['billing_or_payment', 'support_request', 'troubleshooting', 'order_or_request_status', 'document_request'].includes(input.intentResolution.intent)) {
    return ['customer_identifier'];
  }
  return [];
}

function missingSlotResponse(missingSlots: AutopilotSlotName[]): string {
  if (missingSlots.includes('customer_identifier')) {
    return 'Para consultar com seguranca, me informe o CPF/CNPJ ou identificador cadastrado.';
  }

  return `Para seguir com seguranca, me informe: ${missingSlots.map(labelSlotForCustomer).join(', ')}.`;
}

const FLOW_COMPLETION_REQUIRED_SLOTS: AutopilotSlotName[] = [
  'product_or_service_preference',
  'name',
  'customer_identifier',
  'address',
  'phone',
];

function findHandoffTeam(input: {
  intent: AutopilotIntentResolution['intent'];
  availableTeams: ToolRouterTeam[];
}): ToolRouterTeam | null {
  const hints: Partial<Record<AutopilotIntentResolution['intent'], RegExp[]>> = {
    billing_or_payment: [/\b(financeiro|cobranca|cobrança|billing)\b/i],
    support_request: [/\b(suporte|sac|atendimento|help)\b/i],
    troubleshooting: [/\b(suporte|tecnico|técnico|noc|atendimento)\b/i],
    order_or_request_status: [/\b(suporte|atendimento|operacao|operação|logistica|logística)\b/i],
    complaint: [/\b(sac|ouvidoria|qualidade|atendimento)\b/i],
    human_handoff: [/\b(atendimento|suporte|sac|help|humano)\b/i],
  };
  const intentHints = hints[input.intent] || [];
  return input.availableTeams.find((team) => intentHints.some((pattern) => pattern.test(team.name))) ||
    input.availableTeams.find((team) => team.routingConfig?.enabled && team.routingConfig.autoTransfer !== false) ||
    input.availableTeams[0] ||
    null;
}

function buildHandoffActions(input: {
  team: ToolRouterTeam;
  enabledToolNames: string[];
  customerMessage: string;
  contact?: Contact | null;
  reason: string;
}): AgentToolAction[] {
  const actions: AgentToolAction[] = [];
  if (input.enabledToolNames.includes('add_internal_note')) {
    const prefix = input.contact?.name ? `${input.contact.name}: ` : '';
    actions.push({
      type: 'add_internal_note',
      reason: input.reason,
      payload: {
        content: `${prefix}${input.customerMessage.replace(/\s+/g, ' ').trim().slice(0, 180)}. Validator: ${input.reason}.`,
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

export function validateAutopilotResponse(input: {
  response: string | null | undefined;
  fallbackReply?: string | null;
  customerMessage: string;
  chatHistory?: string | null;
  continuationRequiredSlots?: AutopilotSlotName[] | null;
  completionActions?: AgentToolAction[] | null;
  intentResolution: AutopilotIntentResolution;
  slotExtraction: SlotExtractionResult;
  plannedActions: AgentToolAction[];
  toolResults: AgentToolExecutionResult[];
  enabledToolNames: string[];
  availableTeams: ToolRouterTeam[];
  contact?: Contact | null;
  knowledgeCoverage: KnowledgeCoverage;
  knowledgeDocuments?: KnowledgeBaseDocument[] | null;
  source: 'workflow_direct' | 'workflow_tools' | 'llm' | 'fallback';
  systemAgentName?: string;
}): ResponseValidationResult {
  const originalResponse = compact(input.response || '');
  const reasons: string[] = [];

  if (!originalResponse) {
    reasons.push('empty_response');
    return {
      decision: 'replace_with_fallback',
      response: fallbackResponse(input.fallbackReply),
      actions: [],
      reasons,
      metadata: { decision: 'replace_with_fallback', reasons, source: input.source },
    };
  }

  if (hasInternalLeak(originalResponse)) {
    reasons.push('internal_or_technical_leak');
    return {
      decision: 'replace_with_fallback',
      response: fallbackResponse(input.fallbackReply),
      actions: [],
      reasons,
      metadata: { decision: 'replace_with_fallback', reasons, source: input.source },
    };
  }

  if (hasConversationTranscriptLeak(originalResponse)) {
    reasons.push('conversation_transcript_leak');
    return {
      decision: 'replace_with_fallback',
      response: fallbackResponse(input.fallbackReply),
      actions: [],
      reasons,
      metadata: { decision: 'replace_with_fallback', reasons, source: input.source },
    };
  }

  if (
    input.source === 'llm' &&
    !hasSuccessfulLookup(input.toolResults) &&
    (input.knowledgeDocuments?.length || 0) > 0 &&
    !isSelfServiceInformationIntent(input.intentResolution.intent)
  ) {
    const unsupportedFacts = unsupportedKnowledgeFacts(originalResponse, input.knowledgeDocuments || []);
    if (unsupportedFacts.length > 0) {
      reasons.push('unsupported_knowledge_facts');
      return {
        decision: 'replace_with_fallback',
        response: 'Nao encontrei confirmacao suficiente na base para informar esses dados com seguranca. Posso verificar outra informacao ou encaminhar para confirmacao.',
        actions: [],
        reasons,
        metadata: { decision: 'replace_with_fallback', reasons, unsupportedFacts, source: input.source },
      };
    }
  }

  const plannedLookup = hasPlannedLookup(input.plannedActions);
  const successfulLookup = hasSuccessfulLookup(input.toolResults);
  const failedLookup = hasFailedLookup(input.toolResults);
  const lookupPromise = hasExternalLookupPromise(originalResponse);
  const lookupSuccessClaim = hasLookupSuccessClaim(originalResponse);

  if (successfulLookup && asksForCustomerIdentifier(originalResponse)) {
    reasons.push('customer_identifier_requested_after_successful_lookup');
    return {
      decision: 'repair',
      response: 'Ja localizei os dados necessarios. Vou seguir com o atendimento usando as informacoes disponiveis e aviso antes de executar qualquer acao sensivel.',
      actions: [],
      reasons,
      metadata: { decision: 'repair', reasons, source: input.source },
    };
  }

  if (
    asksForPaymentArtifact(input.customerMessage) &&
    hasSuccessfulPaymentData(input.toolResults) &&
    !hasPaymentArtifact(originalResponse)
  ) {
    const repairedPaymentResponse = buildSgpResponseFromToolResults(input.toolResults, input.customerMessage);
    if (repairedPaymentResponse && hasPaymentArtifact(repairedPaymentResponse)) {
      reasons.push('payment_artifact_missing_from_response');
      return {
        decision: 'repair',
        response: repairedPaymentResponse,
        actions: [],
        reasons,
        metadata: { decision: 'repair', reasons, source: input.source },
      };
    }
  }

  if (lookupPromise && !plannedLookup && !successfulLookup) {
    const missingSlots = findMissingLookupSlots({
      intentResolution: input.intentResolution,
      slotExtraction: input.slotExtraction,
    });
    if (missingSlots.length > 0) {
      reasons.push('lookup_promise_missing_slots');
      return {
        decision: 'repair',
        response: missingSlotResponse(missingSlots),
        actions: [],
        reasons,
        metadata: { decision: 'repair', reasons, missingSlots, source: input.source },
      };
    }

    const team = input.enabledToolNames.includes('transfer_chat')
      ? findHandoffTeam({
          intent: input.intentResolution.intent,
          availableTeams: input.availableTeams,
        })
      : null;

    if (team) {
      reasons.push('lookup_promise_without_executable_tool');
      const response = `Nao consigo consultar isso automaticamente com seguranca agora. Vou encaminhar seu atendimento para a equipe ${team.name}.`;
      return {
        decision: 'handoff',
        response,
        actions: buildHandoffActions({
          team,
          enabledToolNames: input.enabledToolNames,
          customerMessage: input.customerMessage,
          contact: input.contact,
          reason: reasons[0],
        }),
        reasons,
        metadata: { decision: 'handoff', reasons, teamId: team.id, teamName: team.name, source: input.source },
      };
    }

    reasons.push('lookup_promise_without_tool_or_handoff');
    return {
      decision: 'repair',
      response: 'Nao tenho uma ferramenta de consulta habilitada para verificar isso automaticamente agora. Vou evitar te passar uma informacao incerta.',
      actions: [],
      reasons,
      metadata: { decision: 'repair', reasons, source: input.source },
    };
  }

  if ((lookupSuccessClaim && !successfulLookup) || (lookupSuccessClaim && failedLookup && !successfulLookup)) {
    reasons.push(failedLookup ? 'lookup_success_claim_after_tool_failure' : 'lookup_success_claim_without_successful_tool');
    return {
      decision: 'replace_with_fallback',
      response: failedLookup
        ? 'Nao consegui concluir a consulta no sistema agora. Vou encaminhar para verificacao manual e evitar te passar uma informacao errada.'
        : fallbackResponse(input.fallbackReply),
      actions: [],
      reasons,
      metadata: { decision: 'replace_with_fallback', reasons, source: input.source },
    };
  }

  if (
    hasTransferPromise(originalResponse) &&
    !hasPlannedTransfer(input.plannedActions) &&
    isSelfServiceInformationIntent(input.intentResolution.intent) &&
    !hasExplicitHandoffRequest(input.customerMessage)
  ) {
    reasons.push('self_service_transfer_promise_suppressed');
    
    // Keep the agent in self-service mode unless the customer explicitly requested a human.
    const slots = input.slotExtraction.slots || {};
    let dynamicRepairMsg = 'Posso seguir com seu atendimento por aqui! ';
    
    const hasName = Boolean(slots.name || input.contact?.name);
    const hasIdentifier = Boolean(slots.customer_identifier);
    const hasPhone = Boolean(slots.phone || input.contact?.phone);
    const hasEmail = Boolean(slots.email || input.contact?.email);
    
    if (!hasIdentifier) {
      dynamicRepairMsg += 'Para continuar com seguranca, poderia me informar seu documento ou identificador cadastral?';
    } else if (!hasPhone) {
      dynamicRepairMsg += 'Perfeito, identificador recebido. Agora me informe seu melhor telefone ou WhatsApp de contato com DDD.';
    } else if (!hasEmail) {
      dynamicRepairMsg += 'Maravilha, ja tenho um contato registrado. Agora me informe qual email devo usar, se for necessario para este atendimento.';
    } else if (!hasName) {
      dynamicRepairMsg += 'Entendido. Me confirme seu nome completo, por favor.';
    } else {
      dynamicRepairMsg += 'Ja tenho os dados principais. Vou dar continuidade ao atendimento sem transferir automaticamente.';
    }

    return {
      decision: 'repair',
      response: dynamicRepairMsg,
      actions: [],
      reasons,
      metadata: { decision: 'repair', reasons, source: input.source },
    };
  }

  if (hasTransferPromise(originalResponse) && !hasPlannedTransfer(input.plannedActions)) {
    const team = input.enabledToolNames.includes('transfer_chat')
      ? findHandoffTeam({
          intent: input.intentResolution.intent,
          availableTeams: input.availableTeams,
        })
      : null;

    if (team) {
      reasons.push('transfer_promise_without_action');
      return {
        decision: 'handoff',
        response: `Vou encaminhar seu atendimento para a equipe ${team.name}.`,
        actions: buildHandoffActions({
          team,
          enabledToolNames: input.enabledToolNames,
          customerMessage: input.customerMessage,
          contact: input.contact,
          reason: reasons[0],
        }),
        reasons,
        metadata: { decision: 'handoff', reasons, teamId: team.id, teamName: team.name, source: input.source },
      };
    }
  }

  if (hasConversationCloseClaim(originalResponse) && !hasPlannedClose(input.plannedActions)) {
    const completionCloseActions = (input.completionActions || []).filter((action) => action.type === 'close_chat');
    if (completionCloseActions.length > 0) {
      reasons.push('close_promise_matched_flow_completion');
      return {
        decision: 'repair',
        response: 'Atendimento encerrado conforme solicitado.',
        actions: completionCloseActions,
        reasons,
        metadata: { decision: 'repair', reasons, source: input.source },
      };
    }

    if (input.enabledToolNames.includes('close_chat')) {
      reasons.push('close_promise_without_action');
      return {
        decision: 'repair',
        response: 'Atendimento encerrado conforme solicitado.',
        actions: [{
          type: 'close_chat',
          reason: 'Resposta prometeu encerramento sem acao planejada.',
          payload: {
            notes: `Encerramento solicitado pelo cliente. Mensagem: ${input.customerMessage.replace(/\s+/g, ' ').trim().slice(0, 220)}`,
            sendCloseMessage: false,
          },
        }],
        reasons,
        metadata: { decision: 'repair', reasons, source: input.source },
      };
    }

    reasons.push('close_promise_without_tool');
    return {
      decision: 'repair',
      response: 'Entendido. Nao vou enviar novas mensagens por aqui agora, mas a ferramenta de encerramento nao esta habilitada neste agente.',
      actions: [],
      reasons,
      metadata: { decision: 'repair', reasons, source: input.source },
    };
  }

  const continuationRepair = repairTurnContinuation({
    response: originalResponse,
    customerMessage: input.customerMessage,
    chatHistory: input.chatHistory,
    intentResolution: input.intentResolution,
    slotExtraction: input.slotExtraction,
    contact: input.contact,
    requiredSlots: input.continuationRequiredSlots?.length
      ? input.continuationRequiredSlots
      : (input.completionActions?.length ? FLOW_COMPLETION_REQUIRED_SLOTS : undefined),
  });
  if (continuationRepair.repaired) {
    reasons.push('turn_continuation_repaired');
    const completionActions = continuationRepair.requirement.reason === 'progress_complete'
      ? (input.completionActions || [])
      : [];
    if (completionActions.length > 0) reasons.push('flow_completion_actions_added');
    return {
      decision: 'repair',
      response: continuationRepair.response,
      actions: completionActions,
      reasons,
      metadata: {
        decision: 'repair',
        reasons,
        source: input.source,
        continuation: continuationRepair.requirement,
      },
    };
  }

  if (
    continuationRepair.requirement.required &&
    continuationRepair.requirement.reason === 'progress_complete' &&
    (input.completionActions?.length || 0) > 0
  ) {
    reasons.push('flow_completion_actions_added');
    return {
      decision: 'repair',
      response: continuationRepair.response,
      actions: input.completionActions || [],
      reasons,
      metadata: {
        decision: 'repair',
        reasons,
        source: input.source,
        continuation: continuationRepair.requirement,
      },
    };
  }

  const repaired = removeTechnicalFragments(originalResponse);
  if (repaired && repaired !== originalResponse) {
    reasons.push('removed_technical_fragments');
    return {
      decision: 'repair',
      response: repaired,
      actions: [],
      reasons,
      metadata: { decision: 'repair', reasons, source: input.source },
    };
  }

  return {
    decision: 'approve',
    response: originalResponse,
    actions: [],
    reasons,
    metadata: {
      decision: 'approve',
      reasons,
      source: input.source,
      knowledgeCoverage: input.knowledgeCoverage,
    },
  };
}
