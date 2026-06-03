import { getAgentToolDefinition, type AgentToolDefinition } from './catalog';
import type { AgentToolAction, AgentToolExecutionResult, AgentToolRuntimeContext } from './types';
import { getMcpWorkspaceConfig } from '@/services/mcp/store';
import { parseQualifiedMcpToolName } from '@/services/mcp/client';
import type { McpToolConfig } from '@/services/mcp/types';

export type AgentToolPolicyRisk = 'low' | 'medium' | 'high';

export type AgentToolPolicyDecision = {
  allowed: boolean;
  riskLevel: AgentToolPolicyRisk;
  reason?: string;
};

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function requestedToolName(action: AgentToolAction): string {
  return action.type === 'mcp_call_tool'
    ? String(action.payload?.toolName || '').trim()
    : action.type;
}

function classifyMcpTool(toolName: string, tool?: McpToolConfig | null): AgentToolPolicyRisk {
  if (tool?.annotations?.destructiveHint) return 'high';
  if (tool?.annotations?.readOnlyHint) return 'low';

  const normalized = normalize(`${toolName} ${tool?.title || ''} ${tool?.description || ''}`);
  if (/\b(reboot|restart|reinici|reset|delete|remove|cancel|terminate|factory|erase|drop)\b/.test(normalized)) {
    return 'high';
  }
  if (/\b(get|find|list|view|read|fetch|search|lookup|status|summary|consult|consulta|localiz|verific)\b/.test(normalized)) {
    return 'low';
  }
  if (/\b(change|update|alter|troca|senha|password|credential|write|create|send|apply)\b/.test(normalized)) {
    return 'medium';
  }
  return 'medium';
}

function confirmationTerms(toolName: string): RegExp {
  const normalized = normalize(toolName);
  if (/\b(reboot|restart|reinici|reset)\b/.test(normalized)) {
    return /\b(reinici|reiniciar|reinicie|reboot|restart|roteador|router)\b/;
  }
  if (/\b(payment|promise|promessa)\b/.test(normalized)) {
    return /\b(promessa|pagamento|pagar|vencimento)\b/;
  }
  if (/\b(password|senha|credential|wifi|wi fi)\b/.test(normalized)) {
    return /\b(senha|wifi|wi fi|credencial)\b/;
  }
  return /\b(confirmo|autoriza|autorizo|pode|sim)\b/;
}

function isShortAffirmativeConfirmation(customerMessage: string): boolean {
  const normalized = normalize(customerMessage);
  return /^(sim|sim pode|pode|pode sim|pode fazer|pode prosseguir|confirmo|autorizo|ok|okay|prosseguir|prossiga|faca|faz)$/.test(normalized);
}

function hasMatchingRecentConfirmationRequest(
  messages: AgentToolRuntimeContext['recentCustomerVisibleMessages'],
  toolName: string,
): boolean {
  const recentMessages = (messages || []).filter((message) => message.content?.trim()).slice(-12);
  const latestAgentMessage = [...recentMessages].reverse().find((message) => message.fromMe);
  if (!latestAgentMessage) return false;

  const normalized = normalize(latestAgentMessage.content);
  const asksForConfirmation = /\b(posso|confirme|confirmar|confirmacao|autoriza|autorizacao|prosseguir|agora)\b/.test(normalized);
  return asksForConfirmation && confirmationTerms(toolName).test(normalized);
}

function hasExplicitConfirmation(
  customerMessage: string,
  toolName: string,
  recentMessages?: AgentToolRuntimeContext['recentCustomerVisibleMessages'],
): boolean {
  const normalized = normalize(customerMessage);
  const affirmative = /\b(sim|confirmo|autorizo|autorizado|pode|pode sim|ok|okay|prosseguir|prossiga|faca|faz|quero)\b/.test(normalized);
  if (!affirmative) return false;
  if (confirmationTerms(toolName).test(normalized)) return true;

  return isShortAffirmativeConfirmation(customerMessage) &&
    hasMatchingRecentConfirmationRequest(recentMessages, toolName);
}

function policyReject(riskLevel: AgentToolPolicyRisk, code: string, reason: string): AgentToolPolicyDecision {
  return {
    allowed: false,
    riskLevel,
    reason: `[tool_policy:${code}] ${reason}`,
  };
}

function validateActionContext(action: AgentToolAction, riskLevel: AgentToolPolicyRisk, customerMessage: string): AgentToolPolicyDecision | null {
  const normalized = normalize(customerMessage);
  if (
    action.type === 'mcp_call_tool' &&
    /(?:^|:)find_router_by_ip$/i.test(String(action.payload?.toolName || '')) &&
    !String((action.payload?.arguments as Record<string, unknown> | undefined)?.client_ip || '').trim()
  ) {
    return policyReject(riskLevel, 'missing_parameters', 'Consulta do roteador exige o IPv4 do contrato selecionado.');
  }
  if (action.type === 'sgp_create_payment_promise') {
    if (!/\b(promessa|pagamento|pagar|negoci|vencimento)\b/.test(normalized)) {
      return policyReject(riskLevel, 'intent_mismatch', 'Promessa de pagamento bloqueada fora de um pedido financeiro do cliente.');
    }
    if (!action.payload?.contractId || !action.payload?.promiseDate) {
      return policyReject(riskLevel, 'missing_parameters', 'Promessa de pagamento exige contrato e data antes da confirmacao.');
    }
  }
  if (action.type === 'sgp_generate_invoice_pix') {
    if (!/\b(pix|boleto|fatura|pagamento|pagar|segunda via)\b/.test(normalized)) {
      return policyReject(riskLevel, 'intent_mismatch', 'Geracao de PIX bloqueada fora de um pedido financeiro do cliente.');
    }
    if (!action.payload?.invoiceId && !action.payload?.contractId) {
      return policyReject(riskLevel, 'missing_parameters', 'Geracao de PIX exige uma fatura ou contrato identificado.');
    }
  }
  if (action.type === 'transfer_chat') {
    if (!action.payload?.teamId && !action.payload?.teamName && !action.payload?.agentId) {
      return policyReject(riskLevel, 'missing_parameters', 'Transferencia exige uma equipe ou atendente de destino.');
    }
  }
  return null;
}

async function resolveMcpTool(context: AgentToolRuntimeContext, action: AgentToolAction): Promise<McpToolConfig | null> {
  if (action.type !== 'mcp_call_tool') return null;
  const qualifiedName = requestedToolName(action);
  const parsed = parseQualifiedMcpToolName(qualifiedName);
  if (!parsed) return null;

  const config = await getMcpWorkspaceConfig(context.workspaceId);
  const server = config.servers.find((item) => item.id === parsed.serverId && item.isActive);
  return server?.tools?.find((item) => item.qualifiedName === qualifiedName) || null;
}

function requiresExplicitConfirmation(
  action: AgentToolAction,
  definition: AgentToolDefinition | null,
  riskLevel: AgentToolPolicyRisk,
): boolean {
  if (riskLevel === 'high') return true;
  if (action.type === 'mcp_call_tool' && riskLevel === 'medium') return true;
  return definition?.requiresHumanApproval === true;
}

export async function evaluateAgentToolPolicy(input: {
  context: AgentToolRuntimeContext;
  action: AgentToolAction;
  previousResults?: AgentToolExecutionResult[];
}): Promise<AgentToolPolicyDecision> {
  const toolName = requestedToolName(input.action);
  const definition = getAgentToolDefinition(input.action.type);
  const mcpTool = await resolveMcpTool(input.context, input.action);
  const riskLevel = input.action.type === 'mcp_call_tool'
    ? classifyMcpTool(toolName, mcpTool)
    : definition?.riskLevel || 'medium';

  const failedDependency = (input.previousResults || []).find((result) => result.status !== 'success');
  if (failedDependency && input.action.type !== 'add_internal_note') {
    return policyReject(
      riskLevel,
      'dependency_failed',
      `Nao executei ${toolName} porque a etapa anterior falhou: ${failedDependency.toolName}.`,
    );
  }

  const actionContextRejection = validateActionContext(input.action, riskLevel, input.context.customerMessage);
  if (actionContextRejection) return actionContextRejection;

  if (requiresExplicitConfirmation(input.action, definition, riskLevel) &&
      !hasExplicitConfirmation(
        input.context.customerMessage,
        toolName,
        input.context.recentCustomerVisibleMessages,
      )) {
    if (isShortAffirmativeConfirmation(input.context.customerMessage)) {
      return policyReject(
        riskLevel,
        'confirmation_context_missing',
        `Recebi uma confirmacao curta, mas ela nao esta vinculada com seguranca a ${toolName}.`,
      );
    }
    return policyReject(
      riskLevel,
      'confirmation_required',
      `Preciso da confirmacao explicita do cliente antes de executar ${toolName}.`,
    );
  }

  return { allowed: true, riskLevel };
}
