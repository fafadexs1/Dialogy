import { getAgentToolDefinition, type AgentToolDefinition } from './catalog';
import type { AgentToolAction, AgentToolExecutionResult, AgentToolRuntimeContext } from './types';
import { getMcpWorkspaceConfig } from '@/services/mcp/store';
import { parseQualifiedMcpToolName } from '@/services/mcp/client';
import type { McpToolConfig } from '@/services/mcp/types';
import { fingerprintToolAction } from './action-fingerprint';
import { classifyMcpToolSafety } from '@/services/mcp/tool-safety';
import { isConversationCloseRequest } from '@/services/autopilot/close-intent';

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

function isExplicitAffirmativeConfirmation(customerMessage: string): boolean {
  const normalized = normalize(customerMessage);
  if (!normalized || /\b(nao|nunca|cancela|cancelar|pare|parar|desisto)\b/.test(normalized)) {
    return false;
  }
  return /\b(sim|confirmo|confirmado|autorizo|autorizado|pode|pode ser|ta bom|tudo bem|ok|okay|prossiga|pode prosseguir|vou aguardar)\b/.test(normalized);
}

function hasMatchingRecentConfirmationRequest(
  messages: AgentToolRuntimeContext['recentCustomerVisibleMessages'],
  toolName: string,
): boolean {
  const recentMessages = (messages || []).filter((message) => message.content?.trim()).slice(-12);
  let skippedCurrentCustomerMessage = false;
  for (let index = recentMessages.length - 1; index >= 0; index -= 1) {
    const message = recentMessages[index];
    if (!message.fromMe) {
      if (!skippedCurrentCustomerMessage) {
        skippedCurrentCustomerMessage = true;
        continue;
      }
      break;
    }
    if (!skippedCurrentCustomerMessage) continue;
    const normalized = normalize(message.content);
    const asksForConfirmation = /\b(posso|confirme|confirmar|confirmacao|autoriza|autorizacao|quer que|prosseguir|agora)\b/.test(normalized);
    if (asksForConfirmation && confirmationTerms(toolName).test(normalized)) return true;
  }
  return false;
}

function policyReject(riskLevel: AgentToolPolicyRisk, code: string, reason: string): AgentToolPolicyDecision {
  return {
    allowed: false,
    riskLevel,
    reason: `[tool_policy:${code}] ${reason}`,
  };
}

function hasValidServerCloseAuthorization(
  action: AgentToolAction,
  context: AgentToolRuntimeContext,
): boolean {
  if (action.type !== 'close_chat') return false;
  const authorization = context.closeAuthorization;
  if (!authorization) return false;
  if (
    authorization.chatId !== context.chat.id ||
    !context.orchestratorRunId ||
    authorization.orchestratorRunId !== context.orchestratorRunId ||
    authorization.actionFingerprint !== fingerprintToolAction(action)
  ) return false;

  if (authorization.source === 'procedure_goal_completed') {
    return Boolean(authorization.procedureExecutionId.trim());
  }
  if (authorization.source === 'conversation_collection_completed') {
    return (
      Boolean(context.sourceMessageId)
      && authorization.sourceMessageId === context.sourceMessageId
      && authorization.needsInputExecutionId !== authorization.completionExecutionId
      && [
        authorization.workflowId,
        authorization.workflowVersion,
        authorization.needsInputExecutionId,
        authorization.completionExecutionId,
        authorization.agentNodeId,
        authorization.terminalNodeId,
        authorization.pendingFieldsFingerprint,
        authorization.persistenceReceiptFingerprint,
        authorization.checkpointFingerprint,
      ].every((value) => Boolean(value.trim()))
    );
  }
  if (authorization.source !== 'workflow_goal_completed') return false;
  return (
    Boolean(authorization.workflowId.trim()) &&
    Boolean(authorization.workflowVersion.trim()) &&
    Boolean(authorization.executionId.trim()) &&
    Boolean(authorization.terminalNodeId.trim())
  );
}

function validateActionContext(
  action: AgentToolAction,
  riskLevel: AgentToolPolicyRisk,
  context: AgentToolRuntimeContext,
): AgentToolPolicyDecision | null {
  const customerMessage = context.customerMessage;
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
  if (
    action.type === 'close_chat' &&
    !isConversationCloseRequest(customerMessage) &&
    !hasValidServerCloseAuthorization(action, context)
  ) {
    return policyReject(
      riskLevel,
      'intent_mismatch',
      'Encerramento do chat bloqueado sem um pedido explicito para finalizar a conversa atual.',
    );
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
    ? classifyMcpToolSafety(toolName, mcpTool).riskLevel
    : definition?.riskLevel || 'medium';

  const failedDependency = (input.previousResults || [])
    .find((result) => result.status !== 'success' && result.toolName !== 'add_internal_note');
  if (failedDependency && input.action.type !== 'add_internal_note' && input.action.type !== 'transfer_chat') {
    return policyReject(
      riskLevel,
      'dependency_failed',
      `Nao executei ${toolName} porque a etapa anterior falhou: ${failedDependency.toolName}.`,
    );
  }

  const actionContextRejection = validateActionContext(input.action, riskLevel, input.context);
  if (actionContextRejection) return actionContextRejection;

  const explicitlyAuthorizedConversationClose = (
    input.action.type === 'close_chat'
    && (
      isConversationCloseRequest(input.context.customerMessage)
      || hasValidServerCloseAuthorization(input.action, input.context)
    )
  );
  const conversationalConfirmation = Boolean(
    input.context.allowRecentConversationalConfirmation
    && isExplicitAffirmativeConfirmation(input.context.customerMessage)
    && hasMatchingRecentConfirmationRequest(input.context.recentCustomerVisibleMessages, toolName)
  );
  if (!explicitlyAuthorizedConversationClose &&
      requiresExplicitConfirmation(input.action, definition, riskLevel) &&
      input.context.confirmedActionFingerprint !== fingerprintToolAction(input.action) &&
      !conversationalConfirmation) {
    if (
      isShortAffirmativeConfirmation(input.context.customerMessage) &&
      !hasMatchingRecentConfirmationRequest(input.context.recentCustomerVisibleMessages, toolName)
    ) {
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
