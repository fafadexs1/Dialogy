import type { Contact } from '@/lib/types';
import type { AgentToolAction, AgentToolExecutionResult } from '@/services/agent-tools/types';
import type { ToolRouterTeam } from '@/services/agent-tools/router';
import type { AutopilotIntentResolution, AutopilotSlotName, KnowledgeCoverage } from './intent-types';
import { labelSlotForCustomer, type SlotExtractionResult } from './slots';
import { hasConversationCloseClaim } from './close-intent';
import { hasExternalLookupPromise } from './tool-planner';

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

function hasTransferPromise(response: string): boolean {
  const normalized = normalizeText(response);
  return /\b(vou|irei|vamos)\s+(encaminhar|transferir|passar|chamar)\b/.test(normalized) &&
    /\b(equipe|setor|atendente|humano|responsavel)\b/.test(normalized);
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
    /\b(api[_-]?key|authorization|bearer\s+[a-z0-9._-]+|token|command_id|cpfFieldId)\b/i.test(response) ||
    /\b(sgp_fetch_|mcp_call_tool|crm_update_contact_custom_fields|transfer_chat|close_chat|add_internal_note)\b/i.test(response)
  );
}

function removeTechnicalFragments(response: string): string {
  return response
    .replace(/```(?:json)?[\s\S]*?```/gi, '')
    .replace(/\b(command_id|trace_id|request_id)\s*[:=]\s*[a-z0-9._-]+/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
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
  intentResolution: AutopilotIntentResolution;
  slotExtraction: SlotExtractionResult;
  plannedActions: AgentToolAction[];
  toolResults: AgentToolExecutionResult[];
  enabledToolNames: string[];
  availableTeams: ToolRouterTeam[];
  contact?: Contact | null;
  knowledgeCoverage: KnowledgeCoverage;
  source: 'workflow_direct' | 'workflow_tools' | 'deterministic_official' | 'llm' | 'fallback';
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

  const plannedLookup = hasPlannedLookup(input.plannedActions);
  const successfulLookup = hasSuccessfulLookup(input.toolResults);
  const failedLookup = hasFailedLookup(input.toolResults);
  const lookupPromise = hasExternalLookupPromise(originalResponse);
  const lookupSuccessClaim = hasLookupSuccessClaim(originalResponse);

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
