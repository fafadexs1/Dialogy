import {
  hasExplicitTeamHandoff,
  shouldHandoffToHuman,
  type ToolRouterTeam,
  type ToolRoutingCandidate,
} from '@/services/agent-tools/router';
import type { AgentToolAction } from '@/services/agent-tools/types';

export function normalizeAgentActions(actions: unknown): AgentToolAction[] {
  if (!Array.isArray(actions)) return [];

  const allowedTypes = new Set([
    'transfer_chat',
    'close_chat',
    'add_internal_note',
    'crm_update_contact_custom_fields',
    'sgp_fetch_contracts',
    'sgp_fetch_contact_panel_data',
    'sgp_generate_invoice_pix',
    'sgp_create_payment_promise',
    'sgp_open_support_ticket',
    'mcp_call_tool',
  ]);

  return actions
    .filter((action: any) => action && typeof action === 'object')
    .filter((action: any) => allowedTypes.has(action.type))
    .map((action: any) => ({
      type: action.type,
      reason: typeof action.reason === 'string' ? action.reason : null,
      payload: action.payload && typeof action.payload === 'object' ? action.payload : {},
    })) as AgentToolAction[];
}

export function mergeAgentActions(...actionSets: Array<AgentToolAction[] | null | undefined>): AgentToolAction[] {
  const merged: AgentToolAction[] = [];
  let hasTransfer = false;
  let hasClose = false;
  let hasInternalNote = false;

  for (const actions of actionSets) {
    for (const action of actions || []) {
      if (action.type === 'transfer_chat') {
        if (hasTransfer) continue;
        hasTransfer = true;
      }

      if (action.type === 'close_chat') {
        if (hasClose) continue;
        hasClose = true;
      }

      if (action.type === 'add_internal_note') {
        if (hasInternalNote) continue;
        hasInternalNote = true;
      }

      merged.push(action);
    }
  }

  return merged.slice(0, 4);
}

export function filterImplicitTransferActions(input: {
  actions: AgentToolAction[];
  customerMessage: string;
  availableTeams: ToolRouterTeam[];
  candidates?: ToolRoutingCandidate[];
}): AgentToolAction[] {
  if (shouldHandoffToHuman(input.customerMessage)) {
    return input.actions;
  }

  return input.actions.filter((action) => {
    if (action.type !== 'transfer_chat' && action.type !== 'add_internal_note') {
      return true;
    }

    const payload = action.payload && typeof action.payload === 'object' ? action.payload as Record<string, any> : {};
    const targetTeam =
      typeof payload.teamId === 'string'
        ? input.availableTeams.find((team) => team.id === payload.teamId)
        : null;
    const teamName = String(payload.teamName || targetTeam?.name || '');
    const reason = String(action.reason || payload.reason || payload.content || '');
    const text = `${teamName} ${reason}`;

    if (action.type === 'transfer_chat') {
      const explicitByTarget = targetTeam ? hasExplicitTeamHandoff(input.customerMessage, targetTeam) : false;
      const explicitByName = teamName ? hasExplicitTeamHandoff(input.customerMessage, { name: teamName }) : false;
      if (explicitByTarget || explicitByName) return true;
      if (isOperationallyUnresolvableTransferReason(reason)) return true;

      return false;
    }

    const hasAllowedImplicitTransfer = input.actions.some((candidateAction) => {
      if (candidateAction.type !== 'transfer_chat') return false;
      const candidateReason = String(candidateAction.reason || '');
      return isOperationallyUnresolvableTransferReason(candidateReason);
    });
    if (hasAllowedImplicitTransfer) return true;
    return !/\b(transfer|encaminh|roteamento)\b/i.test(text);
  });
}

function isOperationallyUnresolvableTransferReason(reason: string) {
  return /\b(lookup_promise_without_executable_tool|lookup_promise_without_tool_or_handoff|promise_handoff|promise_without_tool|tool_failure|tool_error|timeout|indisponivel|indisponÃ­vel|sem ferramenta|nao ha ferramenta executavel|nÃ£o hÃ¡ ferramenta executÃ¡vel|nao tenho uma ferramenta|nÃ£o tenho uma ferramenta|nao consigo consultar|nÃ£o consigo consultar|consulta.*seguranca|consulta.*seguranÃ§a)\b/i.test(reason);
}

export function isPreResponseDataAction(action: AgentToolAction) {
  return action.type === 'crm_update_contact_custom_fields' || action.type.startsWith('sgp_') || action.type === 'mcp_call_tool';
}

function actionKey(action: AgentToolAction): string {
  if (action.type === 'mcp_call_tool') {
    return `${action.type}:${action.payload?.toolName || ''}`;
  }
  return action.type;
}

export function filterAlreadyExecutedActions(actions: AgentToolAction[], results: Array<{ input: AgentToolAction; toolName: string }>): AgentToolAction[] {
  const executed = new Set(results.map((result) => {
    if (result.input.type === 'mcp_call_tool') {
      return `${result.input.type}:${result.input.payload?.toolName || result.toolName}`;
    }
    return result.input.type;
  }));

  return actions.filter((action) => !executed.has(actionKey(action)));
}
