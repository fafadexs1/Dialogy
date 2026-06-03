import { db } from '@/lib/db';
import { transferChatAction } from '@/actions/chats';
import { sendAutomatedMessageAction } from '@/actions/messages';
import { auditAgentToolExecution } from './audit';
import { getAgentToolDefinition } from './catalog';
import type { AgentToolAction, AgentToolExecutionResult, AgentToolRuntimeContext } from './types';
import { recordAgentToolMetrics } from '@/lib/observability/metrics';
import { runCrmUpdateContactCustomFieldsTool } from './crm-tools';
import { runSgpTool } from './sgp-tools';
import { normalizeMcpToolArguments } from './mcp-arguments';
import { callMcpServerTool, parseQualifiedMcpToolName } from '@/services/mcp/client';
import { getMcpWorkspaceConfig } from '@/services/mcp/store';
import {
  DEFAULT_ORCHESTRATOR_BUDGET,
  recordOrchestratorToolCall,
  withTimeout,
  type OrchestratorRunHandle,
} from '@/services/orchestrator/runtime';
import { getWorkspaceTemplates } from '@/lib/workspace-config';
import { enqueueAiCaseMemoryRefresh, shouldEnqueueJob } from '@/lib/queue';
import { refreshCaseMemoryForChat } from '@/services/rag/case-memory';
import { evaluateAgentToolPolicy } from './policy';
import { abortActiveProcedures } from '@/services/autopilot/procedure-store';
import { broadcastChatUpdate } from '@/lib/realtime/chat-broadcast';
import { clearPendingToolConfirmation, setPendingToolConfirmation } from '@/services/autopilot/flow-state-store';
import { redactSensitiveLogValue } from '@/lib/observability/redaction';

const MAX_ACTIONS_PER_MESSAGE = 2;
const MAX_INTERNAL_NOTE_CHARS = 500;
const ALLOWED_TOOLS = new Set([
  'transfer_chat',
  'close_chat',
  'add_internal_note',
  'crm_update_contact_custom_fields',
  'sgp_fetch_contracts',
  'sgp_fetch_contact_panel_data',
  'sgp_generate_invoice_pix',
  'sgp_create_payment_promise',
  'mcp_call_tool',
]);

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
  return context.turnPolicy.allowedToolNames.includes(toolName);
}

function resolveRequestedToolName(action: AgentToolAction): string {
  if (action.type === 'mcp_call_tool') {
    return action.payload?.toolName || '';
  }
  return action.type;
}

async function loadRecentCustomerVisibleMessages(
  context: AgentToolRuntimeContext
): Promise<NonNullable<AgentToolRuntimeContext['recentCustomerVisibleMessages']>> {
  try {
    const { rows } = await db.query(
      `SELECT content, from_me
       FROM messages
       WHERE workspace_id = $1
         AND chat_id = $2
         AND COALESCE(api_message_status, '') <> 'internal'
         AND COALESCE(content, '') <> ''
       ORDER BY created_at DESC
       LIMIT 12`,
      [context.workspaceId, context.chat.id]
    );

    return rows.reverse().map((row: any) => ({
      fromMe: row.from_me === true,
      content: String(row.content || ''),
    }));
  } catch (error) {
    console.warn('[AGENT_TOOL_POLICY] Failed to load recent customer-visible messages:', error);
    return [];
  }
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
    input: redactSensitiveLogValue(inputOverride || result.input) as Record<string, unknown>,
    output: redactSensitiveLogValue(result.output ?? null) as Record<string, unknown> | null,
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

export async function formatTeamBusinessHours(teamId: string): Promise<string> {
  const { rows } = await db.query(
    `SELECT day_of_week, is_enabled, start_time, end_time 
     FROM business_hours 
     WHERE team_id = $1`,
    [teamId]
  );
  
  if (rows.length === 0) {
    return 'horário comercial';
  }

  const enabledHours = rows.filter((r: any) => r.is_enabled && r.start_time && r.end_time);
  if (enabledHours.length === 0) {
    return 'horário comercial';
  }

  const dayOrder = ['Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado', 'Domingo'];
  enabledHours.sort((a: any, b: any) => dayOrder.indexOf(a.day_of_week) - dayOrder.indexOf(b.day_of_week));

  const scheduleGroups: Record<string, string[]> = {};
  for (const bh of enabledHours) {
    const timeKey = `${bh.start_time} às ${bh.end_time}`;
    if (!scheduleGroups[timeKey]) {
      scheduleGroups[timeKey] = [];
    }
    scheduleGroups[timeKey].push(bh.day_of_week);
  }

  const parts: string[] = [];
  for (const [timeRange, days] of Object.entries(scheduleGroups)) {
    const shortDays = days.map(d => d.replace('-feira', ''));
    if (shortDays.length === 1) {
      parts.push(`${shortDays[0]} das ${timeRange}`);
    } else if (shortDays.length === 2) {
      parts.push(`${shortDays[0]} e ${shortDays[1]} das ${timeRange}`);
    } else {
      const indices = days.map(d => dayOrder.indexOf(d)).sort((a, b) => a - b);
      const isConsecutive = indices.every((val, i) => i === 0 || val === indices[i - 1] + 1);
      if (isConsecutive) {
        parts.push(`${shortDays[0]} a ${shortDays[shortDays.length - 1]} das ${timeRange}`);
      } else {
        const lastDay = shortDays.pop();
        parts.push(`${shortDays.join(', ')} e ${lastDay} das ${timeRange}`);
      }
    }
  }

  return parts.join(', ');
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
      if (result.error === 'Nenhum agente disponível nesta equipe no momento.' && target.teamId) {
        try {
          const { rows: teamRows } = await db.query(
            'SELECT name, color, tag_id FROM teams WHERE id = $1', 
            [target.teamId]
          );
          const teamName = teamRows[0]?.name || 'Comercial';
          const teamColor = teamRows[0]?.color || '#cccccc';
          const teamTagId = teamRows[0]?.tag_id;

          let chatTag = teamName;
          let chatColor = teamColor;

          if (teamTagId) {
            const { rows: tagRows } = await db.query('SELECT label, color FROM tags WHERE id = $1', [teamTagId]);
            if (tagRows[0]) {
              chatTag = tagRows[0].label;
              chatColor = tagRows[0].color;
            }
          }

          const businessHoursText = await formatTeamBusinessHours(target.teamId);

          const messageText = `Agradeço o seu contato! No momento, a nossa equipe do setor ${teamName} está fora do expediente (${businessHoursText}). Vou transferir seu atendimento para este setor assim que o expediente iniciar. Seu chat já foi colocado na fila de espera para que nossa equipe te atenda logo no início das atividades!`;

          await sendAutomatedMessageAction(
            context.chat.id,
            messageText,
            context.systemAgentId,
            true
          );

          await db.query(
            `UPDATE chats
             SET agent_id = NULL,
                 assigned_system_agent_id = NULL,
                 is_autopilot_active = FALSE,
                 copilot_mode = 'off',
                 status = 'gerais',
                 tag = $1,
                 color = $2,
                 assigned_at = NULL,
                 updated_at = clock_timestamp()
             WHERE id = $3`,
            [chatTag, chatColor, context.chat.id]
          );

          await broadcastChatUpdate(context.workspaceId, context.chat.id, {
            agent_id: null,
            assigned_system_agent_id: null,
            is_autopilot_active: false,
            copilot_mode: 'off',
            status: 'gerais',
            tag: chatTag,
            color: chatColor,
            assigned_at: null,
          });
          await abortActiveProcedures(context.chat.id);

          return {
            toolName: 'transfer_chat',
            status: 'success',
            input: action,
            output: {
              transferred: false,
              fallbackExecuted: true,
              target,
              reason: 'Nenhum agente disponível no momento. Fila com horário de expediente ativada.',
            },
          };
        } catch (fallbackError) {
          console.error('[TRANSFER_CHAT_FALLBACK] Error running fallback:', fallbackError);
        }
      }

      return {
        toolName: 'transfer_chat',
        status: 'error',
        input: action,
        error: result.error || 'Falha ao transferir atendimento.',
      };
    }

    await abortActiveProcedures(context.chat.id);
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

async function runCloseChatTool(
  context: AgentToolRuntimeContext,
  action: Extract<AgentToolAction, { type: 'close_chat' }>
): Promise<AgentToolExecutionResult> {
  const payload = action.payload || {};
  const reasonTagId = typeof payload.reasonTagId === 'string' && payload.reasonTagId.trim()
    ? payload.reasonTagId.trim()
    : null;
  const notes = typeof payload.notes === 'string' && payload.notes.trim()
    ? payload.notes.trim().slice(0, 1000)
    : (action.reason?.trim() || 'Encerramento solicitado pelo cliente via Atendente Inteligente.');
  const sendCloseMessage = payload.sendCloseMessage === true;

  const client = await db.connect();
  let closeTemplate: string | undefined;
  let workspaceId = context.workspaceId;
  let lastInstanceName: string | null = null;

  try {
    await client.query('BEGIN');

    const chatRes = await client.query(
      `SELECT
          workspace_id,
          status,
          tag AS current_tag,
          color AS current_color,
          (
            SELECT m.instance_name
            FROM messages m
            WHERE m.chat_id = c.id AND m.instance_name IS NOT NULL
            ORDER BY m.created_at DESC
            LIMIT 1
          ) AS last_instance_name
       FROM chats c
       WHERE id = $1 AND workspace_id = $2
       FOR UPDATE`,
      [context.chat.id, context.workspaceId]
    );

    const chatRow = chatRes.rows[0];
    if (!chatRow) {
      await client.query('ROLLBACK');
      return reject(action, 'Chat nao encontrado neste workspace.');
    }

    if (chatRow.status === 'encerrados') {
      await client.query('ROLLBACK');
      return {
        toolName: 'close_chat',
        status: 'success',
        input: action,
        output: { closed: true, alreadyClosed: true },
      };
    }

    workspaceId = chatRow.workspace_id;
    lastInstanceName = chatRow.last_instance_name || null;

    const { closeMessageTemplate } = await getWorkspaceTemplates(workspaceId);
    closeTemplate = closeMessageTemplate || undefined;

    let tagInfo = { label: null as string | null, color: null as string | null };
    if (reasonTagId) {
      const tagRes = await client.query(
        `SELECT label, color
         FROM tags
         WHERE id = $1 AND workspace_id = $2
         LIMIT 1`,
        [reasonTagId, workspaceId]
      );
      if (tagRes.rows[0]) {
        tagInfo = tagRes.rows[0];
      }
    }

    await client.query(
      `UPDATE chats
       SET
          status = 'encerrados',
          closed_at = clock_timestamp(),
          close_reason_tag_id = $1,
          close_notes = $2,
          tag = $3,
          color = $4
       WHERE id = $5 AND workspace_id = $6`,
      [
        reasonTagId,
        notes,
        tagInfo.label ?? chatRow.current_tag ?? '',
        tagInfo.color ?? chatRow.current_color ?? '',
        context.chat.id,
        workspaceId,
      ]
    );

    await client.query(
      `UPDATE meta_conversations
       SET status = 'closed', updated_at = timezone('utc', now())
       WHERE chat_id = $1`,
      [context.chat.id]
    );

    await client.query(
      `INSERT INTO messages (
          workspace_id,
          chat_id,
          type,
          content,
          metadata,
          sender_system_agent_id,
          created_at
       ) VALUES ($1, $2, 'system', $3, $4, $5, clock_timestamp())`,
      [
        workspaceId,
        context.chat.id,
        `Atendimento encerrado via Atendente Inteligente por ${context.systemAgentName}.`,
        JSON.stringify({
          event: 'close',
          closed_by_system_agent_id: context.systemAgentId,
          reason_tag_id: reasonTagId,
          notes,
          customerMessage: context.customerMessage,
          tool: 'close_chat',
        }),
        context.systemAgentId,
      ]
    );

    await client.query('COMMIT');

    const closedAtStr = new Date().toISOString();
    await broadcastChatUpdate(workspaceId, context.chat.id, {
      status: 'encerrados',
      closed_at: closedAtStr,
      close_reason_tag_id: reasonTagId,
      close_notes: notes,
      tag: tagInfo.label ?? chatRow.current_tag ?? '',
      color: tagInfo.color ?? chatRow.current_color ?? '',
    });

    try {
      const closedAtRes = await db.query('SELECT closed_at FROM chats WHERE id = $1', [context.chat.id]);
      const closedAt = closedAtRes.rows[0]?.closed_at
        ? new Date(closedAtRes.rows[0].closed_at).toISOString()
        : null;

      if (shouldEnqueueJob('ai_case_memory_refresh')) {
        await enqueueAiCaseMemoryRefresh({
          workspaceId,
          chatId: context.chat.id,
          closedAt,
        });
      } else {
        await refreshCaseMemoryForChat({
          workspaceId,
          chatId: context.chat.id,
          closedAt,
        });
      }
    } catch (caseMemoryError) {
      console.error('[AGENT_TOOL_CLOSE_CHAT] Falha ao atualizar memoria de caso:', caseMemoryError);
    }

    if (closeTemplate && sendCloseMessage) {
      try {
        await sendAutomatedMessageAction(
          context.chat.id,
          closeTemplate,
          context.systemAgentId,
          true,
          lastInstanceName || undefined,
          {
            event: 'close_notice',
            authored_by_system_agent_id: context.systemAgentId,
            template_applied: true,
            reason_tag_id: reasonTagId,
          }
        );
      } catch (templateError) {
        console.error('[AGENT_TOOL_CLOSE_CHAT] Falha ao enviar template de encerramento:', templateError);
      }
    }

    return {
      toolName: 'close_chat',
      status: 'success',
      input: action,
      output: {
        closed: true,
        reasonTagId,
        sendCloseMessage,
      },
    };
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Ignore rollback errors after connection-level failures.
    }
    return {
      toolName: 'close_chat',
      status: 'error',
      input: action,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    client.release();
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

    const normalizedArguments = normalizeMcpToolArguments(action.payload?.arguments);
    if (!normalizedArguments.success) {
      return reject(action, normalizedArguments.error);
    }

    const result = await callMcpServerTool({
      server,
      toolName: parsed.toolName,
      arguments: normalizedArguments.arguments,
    });

    const content = (result as any).content || null;
    const textError = Array.isArray(content)
      ? content
          .map((item: any) => item?.type === 'text' ? item.text : null)
          .filter(Boolean)
          .join('\n')
          .trim()
      : '';

    if ((result as any).isError) {
      return {
        toolName: qualifiedName as any,
        status: 'error',
        input: action,
        error: textError || 'Ferramenta MCP retornou erro.',
        output: JSON.parse(JSON.stringify({
          content,
          structuredContent: (result as any).structuredContent || null,
          isError: true,
        })),
      };
    }

    return {
      toolName: qualifiedName as any,
      status: 'success',
      input: action,
      output: JSON.parse(JSON.stringify({
        content,
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

  const runtimeContext = context.recentCustomerVisibleMessages
    ? context
    : {
        ...context,
        recentCustomerVisibleMessages: await loadRecentCustomerVisibleMessages(context),
      };

  const allowedToRun = await ensureChatStillAssignedToAgent(runtimeContext);
  if (!allowedToRun) {
    for (const action of normalizedActions) {
      const startedAt = Date.now();
      const result = reject(action, 'Chat nao esta atribuido a este Atendente Inteligente ou autopilot esta desligado.');
      await auditToolResult(runtimeContext, result, Date.now() - startedAt);
      results.push(result);
    }
    return results;
  }

  let transferExecuted = false;
  for (const action of normalizedActions) {
    const startedAt = Date.now();
    if (!ALLOWED_TOOLS.has(action.type)) {
      const result = reject(action, 'Ferramenta nao permitida para Atendente Inteligente.');
      await auditToolResult(runtimeContext, result, Date.now() - startedAt);
      results.push(result);
      continue;
    }

    const requestedToolName = resolveRequestedToolName(action);
    if (!isToolEnabledForAgent(runtimeContext, requestedToolName)) {
      const result = reject(action, 'Ferramenta desabilitada nas configuracoes deste agente.');
      await auditToolResult(runtimeContext, result, Date.now() - startedAt);
      results.push(result);
      continue;
    }

    const definition = getAgentToolDefinition(action.type);
    if (!definition) {
      const result = reject(action, 'Ferramenta sem contrato registrado no catalogo.');
      await auditToolResult(runtimeContext, result, Date.now() - startedAt);
      results.push(result);
      continue;
    }

    if (action.type === 'transfer_chat' && transferExecuted) {
      const result = reject(action, 'Apenas uma transferencia pode ser executada por mensagem.');
      await auditToolResult(runtimeContext, result, Date.now() - startedAt);
      results.push(result);
      continue;
    }

    let policyDecision;
    try {
      policyDecision = await evaluateAgentToolPolicy({
        context: runtimeContext,
        action,
        previousResults: results,
      });
    } catch (error) {
      policyDecision = {
        allowed: false,
        riskLevel: 'medium' as const,
        reason: `[tool_policy:metadata_unavailable] Nao consegui validar a seguranca da ferramenta: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    if (!policyDecision.allowed) {
      const result = reject(action, policyDecision.reason || 'Ferramenta bloqueada pela politica de execucao.');
      if (policyDecision.reason?.includes('[tool_policy:confirmation_required]')) {
        await setPendingToolConfirmation({
          chatId: runtimeContext.chat.id,
          workspaceId: runtimeContext.workspaceId,
          autopilotConfigId: runtimeContext.autopilotConfig.id,
          activeNodeId: runtimeContext.turnPolicy.activeNodeId,
          action,
        });
      }
      await auditToolResult(runtimeContext, result, Date.now() - startedAt);
      results.push(result);
      continue;
    }

    let result: AgentToolExecutionResult;
    try {
      result = await withTimeout((async () => {
        if (action.type === 'transfer_chat') return runTransferChatTool(runtimeContext, action);
        if (action.type === 'close_chat') return runCloseChatTool(runtimeContext, action);
        if (action.type === 'add_internal_note') return runAddInternalNoteTool(runtimeContext, action);
        if (action.type === 'mcp_call_tool') return runMcpCallTool(runtimeContext, action);
        if (action.type === 'crm_update_contact_custom_fields') {
          return runCrmUpdateContactCustomFieldsTool(runtimeContext, action);
        }
        return runSgpTool(runtimeContext, action as any);
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
    if (result.status === 'success') {
      await clearPendingToolConfirmation(runtimeContext.chat.id, action);
    }

    await auditToolResult(runtimeContext, result, Date.now() - startedAt);
    results.push(result);
  }

  return results;
}
