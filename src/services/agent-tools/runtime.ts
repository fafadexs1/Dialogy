import { db } from '@/lib/db';
import { transferChatAction } from '@/actions/chats';
import { auditAgentToolExecution } from './audit';
import { getAgentToolDefinition, listDefaultEnabledAgentToolNames } from './catalog';
import type { AgentToolAction, AgentToolExecutionResult, AgentToolRuntimeContext } from './types';
import { recordAgentToolMetrics } from '@/lib/observability/metrics';
import { runCrmUpdateContactCustomFieldsTool } from './crm-tools';
import { runSgpTool } from './sgp-tools';
import { callMcpServerTool, parseQualifiedMcpToolName } from '@/services/mcp/client';
import { getMcpWorkspaceConfig } from '@/services/mcp/store';
import {
  DEFAULT_ORCHESTRATOR_BUDGET,
  recordOrchestratorToolCall,
  withTimeout,
  type OrchestratorRunHandle,
} from '@/services/orchestrator/runtime';

const MAX_ACTIONS_PER_MESSAGE = 4;
const MAX_INTERNAL_NOTE_CHARS = 500;
const ALLOWED_TOOLS = new Set([
  'transfer_chat',
  'add_internal_note',
  'crm_update_contact_custom_fields',
  'sgp_fetch_contracts',
  'sgp_fetch_contact_panel_data',
  'sgp_generate_invoice_pix',
  'sgp_create_payment_promise',
  'mcp_call_tool',
]);

const DEFAULT_ENABLED_TOOLS = new Set(listDefaultEnabledAgentToolNames());

function normalizeSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function reject(action: AgentToolAction, message: string): AgentToolExecutionResult {
  return {
    toolName: action.type as any,
    status: 'rejected',
    input: action,
    error: message,
  };
}

function contextRun(context: AgentToolRuntimeContext): OrchestratorRunHandle | null {
  if (!context.orchestratorRunId) return null;
  return {
    id: context.orchestratorRunId,
    workspaceId: context.workspaceId,
    chatId: context.chat.id,
    startedAt: Date.now(),
    budget: DEFAULT_ORCHESTRATOR_BUDGET,
  };
}

function isToolEnabledForAgent(context: AgentToolRuntimeContext, toolName: string): boolean {
  const configuredToolNames = context.autopilotConfig.enabled_tool_names;
  if (!Array.isArray(configuredToolNames)) {
    return DEFAULT_ENABLED_TOOLS.has(toolName as any);
  }
  return configuredToolNames.includes(toolName);
}

function resolveRequestedToolName(action: AgentToolAction): string {
  if (action.type === 'mcp_call_tool') {
    return action.payload?.toolName || '';
  }
  return action.type;
}

async function auditToolResult(
  context: AgentToolRuntimeContext,
  result: AgentToolExecutionResult,
  durationMs: number,
  inputOverride?: AgentToolAction
) {
  const definition = getAgentToolDefinition(result.toolName);
  const actionDefinition = getAgentToolDefinition(inputOverride?.type || result.input.type);
  await auditAgentToolExecution(context, result, inputOverride);
  recordAgentToolMetrics({
    toolName: result.toolName,
    status: result.status,
    durationMs,
    riskLevel: definition?.riskLevel ?? null,
    workspaceId: context.workspaceId,
  });
  await recordOrchestratorToolCall({
    run: contextRun(context),
    workspaceId: context.workspaceId,
    chatId: context.chat.id,
    systemAgentId: context.systemAgentId,
    autopilotConfigId: context.autopilotConfig.id,
    toolName: result.toolName,
    toolVersion: definition?.version ?? actionDefinition?.version ?? null,
    class: definition?.class ?? actionDefinition?.class ?? null,
    riskLevel: definition?.riskLevel ?? actionDefinition?.riskLevel ?? null,
    status: result.status,
    input: (inputOverride || result.input) as unknown as Record<string, unknown>,
    output: result.output ?? null,
    error: result.error ?? null,
    durationMs,
    requiresHumanApproval: definition?.requiresHumanApproval ?? actionDefinition?.requiresHumanApproval ?? false,
  });
}

export function sanitizeInternalNoteContent(value: string): string {
  const normalized = value
    .replace(/\s+/g, ' ')
    .replace(/\b(Fim|Finalizado|Finaliza(?:do)?|Registro concluido|Registro terminado)[^.?!]*(?:[.?!]|$)/gi, '')
    .replace(/\b[\w\s]*\bfinaliza a nota agora[.?!]?/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (normalized.length <= MAX_INTERNAL_NOTE_CHARS) {
    return normalized;
  }

  const sentences = normalized.match(/[^.!?]+[.!?]?/g) || [normalized];
  const selected: string[] = [];
  let total = 0;

  for (const sentence of sentences) {
    const cleanSentence = sentence.trim();
    if (!cleanSentence) continue;
    const nextTotal = total + cleanSentence.length + (selected.length > 0 ? 1 : 0);
    if (nextTotal > MAX_INTERNAL_NOTE_CHARS) break;
    selected.push(cleanSentence);
    total = nextTotal;
  }

  const compact = selected.join(' ').trim();
  if (compact) {
    return compact;
  }

  return `${normalized.slice(0, MAX_INTERNAL_NOTE_CHARS - 1).trim()}…`;
}

async function ensureChatStillAssignedToAgent(context: AgentToolRuntimeContext) {
  const { rows } = await db.query(
    `SELECT assigned_system_agent_id, is_autopilot_active, status
     FROM chats
     WHERE id = $1 AND workspace_id = $2
     LIMIT 1`,
    [context.chat.id, context.workspaceId]
  );
  const row = rows[0];
  return Boolean(
    row &&
      row.status !== 'encerrados' &&
      row.is_autopilot_active === true &&
      row.assigned_system_agent_id === context.systemAgentId
  );
}

async function resolveTransferTarget(context: AgentToolRuntimeContext, action: Extract<AgentToolAction, { type: 'transfer_chat' }>) {
  const payload = action.payload || {};

  if (payload.agentId) {
    const { rows } = await db.query(
      `SELECT u.id
       FROM users u
       JOIN user_workspace_roles uwr ON uwr.user_id = u.id
       WHERE u.id = $1 AND uwr.workspace_id = $2
       LIMIT 1`,
      [payload.agentId, context.workspaceId]
    );
    if (!rows[0]) {
      throw new Error('Agente humano de destino nao encontrado neste workspace.');
    }
    return { agentId: payload.agentId };
  }

  if (payload.teamId) {
    const { rows } = await db.query(
      `SELECT id FROM teams WHERE id = $1 AND workspace_id = $2 LIMIT 1`,
      [payload.teamId, context.workspaceId]
    );
    if (!rows[0]) {
      throw new Error('Equipe de destino nao encontrada neste workspace.');
    }
    return { teamId: payload.teamId };
  }

  if (payload.teamName) {
    const requestedTeamName = payload.teamName.trim();
    const { rows: exactRows } = await db.query(
      `SELECT id
       FROM teams
       WHERE workspace_id = $1 AND lower(name) = lower($2)
       ORDER BY name
       LIMIT 1`,
      [context.workspaceId, requestedTeamName]
    );
    if (exactRows[0]) {
      return { teamId: exactRows[0].id as string };
    }

    const requestedNormalized = normalizeSearchText(requestedTeamName);
    const { rows: allTeamRows } = await db.query(
      `SELECT id, name
       FROM teams
       WHERE workspace_id = $1
       ORDER BY name`,
      [context.workspaceId]
    );
    const fuzzyRows = allTeamRows.filter((row) => {
      const teamNormalized = normalizeSearchText(String(row.name || ''));
      if (!teamNormalized || teamNormalized.length < 4) return false;
      return requestedNormalized.includes(teamNormalized) || teamNormalized.includes(requestedNormalized);
    });

    if (fuzzyRows.length === 1) {
      return { teamId: fuzzyRows[0].id as string };
    }

    if (fuzzyRows.length > 1) {
      throw new Error(`Equipe "${payload.teamName}" esta ambigua neste workspace.`);
    }

    throw new Error(`Equipe "${payload.teamName}" nao encontrada neste workspace.`);
  }

  throw new Error('Informe teamId, teamName ou agentId para transferir o atendimento.');
}

async function runTransferChatTool(
  context: AgentToolRuntimeContext,
  action: Extract<AgentToolAction, { type: 'transfer_chat' }>
): Promise<AgentToolExecutionResult> {
  try {
    const target = await resolveTransferTarget(context, action);
    const result = await transferChatAction(
      {
        chatId: context.chat.id,
        ...target,
      },
      {
        user: {
          id: context.systemAgentId,
          name: context.systemAgentName,
        },
        isSystemAgent: true,
      }
    );

    if (!result.success) {
      return {
        toolName: 'transfer_chat',
        status: 'error',
        input: action,
        error: result.error || 'Falha ao transferir atendimento.',
      };
    }

    return {
      toolName: 'transfer_chat',
      status: 'success',
      input: action,
      output: {
        transferred: true,
        target,
        reason: action.reason || null,
      },
    };
  } catch (error) {
    return {
      toolName: 'transfer_chat',
      status: 'error',
      input: action,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function runAddInternalNoteTool(
  context: AgentToolRuntimeContext,
  action: Extract<AgentToolAction, { type: 'add_internal_note' }>
): Promise<AgentToolExecutionResult> {
  const content = sanitizeInternalNoteContent(action.payload?.content?.trim() || action.reason?.trim() || '');
  if (!content) {
    return reject(action, 'Nota interna sem conteudo.');
  }

  try {
    const note = [
      content,
      action.reason && action.reason.trim() !== content ? `Motivo: ${action.reason}` : '',
    ].filter(Boolean).join('\n\n');

    const insertRes = await db.query(
      `INSERT INTO messages (
        workspace_id,
        chat_id,
        type,
        content,
        from_me,
        api_message_status,
        metadata,
        is_read,
        sender_system_agent_id,
        created_at
      ) VALUES ($1, $2, 'text', $3, true, 'internal', $4, true, $5, clock_timestamp())
      RETURNING id`,
      [
        context.workspaceId,
        context.chat.id,
        note,
        JSON.stringify({
          isInternalNote: true,
          isAiAnalysis: true,
          analysisKind: 'routing_context',
          sentBy: 'system_agent',
          tool: 'add_internal_note',
          customerMessage: context.customerMessage,
        }),
        context.systemAgentId,
      ]
    );

    return {
      toolName: 'add_internal_note',
      status: 'success',
      input: action,
      output: {
        messageId: insertRes.rows[0]?.id,
      },
    };
  } catch (error) {
    return {
      toolName: 'add_internal_note',
      status: 'error',
      input: action,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function runMcpCallTool(
  context: AgentToolRuntimeContext,
  action: Extract<AgentToolAction, { type: 'mcp_call_tool' }>
): Promise<AgentToolExecutionResult> {
  const qualifiedName = action.payload?.toolName?.trim() || '';
  const parsed = parseQualifiedMcpToolName(qualifiedName);
  if (!parsed) {
    return reject(action, 'Ferramenta MCP invalida ou ausente.');
  }

  try {
    const config = await getMcpWorkspaceConfig(context.workspaceId);
    const server = config.servers.find((item) => item.id === parsed.serverId && item.isActive);
    if (!server) {
      return reject(action, 'Servidor MCP nao encontrado ou inativo.');
    }

    const tool = (server.tools || []).find((item) => item.qualifiedName === qualifiedName);
    if (!tool) {
      return reject(action, 'Ferramenta MCP nao foi sincronizada neste workspace.');
    }

    const result = await callMcpServerTool({
      server,
      toolName: parsed.toolName,
      arguments: action.payload?.arguments || {},
    });

    return {
      toolName: qualifiedName as any,
      status: 'success',
      input: action,
      output: JSON.parse(JSON.stringify({
        content: (result as any).content || null,
        structuredContent: (result as any).structuredContent || null,
        isError: (result as any).isError || false,
      })),
    };
  } catch (error) {
    return {
      toolName: qualifiedName as any,
      status: 'error',
      input: action,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function runAgentTools(
  context: AgentToolRuntimeContext,
  actions: AgentToolAction[] | null | undefined
): Promise<AgentToolExecutionResult[]> {
  const normalizedActions = (actions || []).filter(Boolean).slice(0, MAX_ACTIONS_PER_MESSAGE);
  const results: AgentToolExecutionResult[] = [];

  if (normalizedActions.length === 0) {
    return results;
  }

  const allowedToRun = await ensureChatStillAssignedToAgent(context);
  if (!allowedToRun) {
    for (const action of normalizedActions) {
      const startedAt = Date.now();
      const result = reject(action, 'Chat nao esta atribuido a este Atendente Inteligente ou autopilot esta desligado.');
      await auditToolResult(context, result, Date.now() - startedAt);
      results.push(result);
    }
    return results;
  }

  let transferExecuted = false;
  for (const action of normalizedActions) {
    const startedAt = Date.now();
    if (!ALLOWED_TOOLS.has(action.type)) {
      const result = reject(action, 'Ferramenta nao permitida para Atendente Inteligente.');
      await auditToolResult(context, result, Date.now() - startedAt);
      results.push(result);
      continue;
    }

    const requestedToolName = resolveRequestedToolName(action);
    if (!isToolEnabledForAgent(context, requestedToolName)) {
      const result = reject(action, 'Ferramenta desabilitada nas configuracoes deste agente.');
      await auditToolResult(context, result, Date.now() - startedAt);
      results.push(result);
      continue;
    }

    const definition = getAgentToolDefinition(action.type);
    if (!definition) {
      const result = reject(action, 'Ferramenta sem contrato registrado no catalogo.');
      await auditToolResult(context, result, Date.now() - startedAt);
      results.push(result);
      continue;
    }

    if (action.type === 'transfer_chat' && transferExecuted) {
      const result = reject(action, 'Apenas uma transferencia pode ser executada por mensagem.');
      await auditToolResult(context, result, Date.now() - startedAt);
      results.push(result);
      continue;
    }

    let result: AgentToolExecutionResult;
    try {
      result = await withTimeout((async () => {
        if (action.type === 'transfer_chat') return runTransferChatTool(context, action);
        if (action.type === 'add_internal_note') return runAddInternalNoteTool(context, action);
        if (action.type === 'mcp_call_tool') return runMcpCallTool(context, action);
        if (action.type === 'crm_update_contact_custom_fields') {
          return runCrmUpdateContactCustomFieldsTool(context, action);
        }
        return runSgpTool(context, action as any);
      })(), definition.timeoutMs, `agent tool ${definition.name}`);
    } catch (error) {
      result = {
        toolName: action.type,
        status: 'error',
        input: action,
        error: error instanceof Error ? error.message : String(error),
      };
    }

    if (action.type === 'transfer_chat' && result.status === 'success') {
      transferExecuted = true;
    }

    await auditToolResult(context, result, Date.now() - startedAt);
    results.push(result);
  }

  return results;
}
