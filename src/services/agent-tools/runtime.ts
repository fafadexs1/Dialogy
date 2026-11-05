import { randomUUID } from 'crypto';
import { db } from '@/lib/db';
import { transferChatAction } from '@/actions/chats';
import { sendAutomatedMessageAction } from '@/actions/messages';
import { auditAgentToolExecution } from './audit';
import { getAgentToolDefinition, listAgentToolCatalogItems } from './catalog';
import type { AgentToolAction, AgentToolExecutionResult, AgentToolRuntimeContext } from './types';
import { recordAgentToolMetrics } from '@/lib/observability/metrics';
import { runCrmUpdateContactCustomFieldsTool } from './crm-tools';
import { runSgpTool } from './sgp-tools';
import { normalizeMcpToolArguments } from './mcp-arguments';
import { callMcpServerTool, parseQualifiedMcpToolName } from '@/services/mcp/client';
import { getMcpWorkspaceConfig, recordMcpServerHealth } from '@/services/mcp/store';
import { classifyMcpToolSafety } from '@/services/mcp/tool-safety';
import {
  claimDurableAgentToolExecution,
  type DurableToolClaim,
} from '@/services/autopilot/runtime/durable-tool-claim';
import {
  DEFAULT_ORCHESTRATOR_BUDGET,
  recordOrchestratorToolCall,
  withTimeout,
  type OrchestratorRunHandle,
} from '@/services/orchestrator/runtime';
import { getWorkspaceTemplates } from '@/lib/workspace-config';
import { enqueueAiCaseMemoryRefresh, shouldEnqueueJob } from '@/lib/queue';
import { createTrustedActorContext } from '@/lib/security/trusted-server-context';
import { refreshCaseMemoryForChat } from '@/services/rag/case-memory';
import { evaluateAgentToolPolicy } from './policy';
import { abortActiveProcedures } from '@/services/autopilot/procedure-store';
import { broadcastChatUpdate } from '@/lib/realtime/chat-broadcast';
import { clearPendingToolConfirmation, setPendingToolConfirmation } from '@/services/autopilot/flow-state-store';
import { redactSensitiveLogValue } from '@/lib/observability/redaction';
import { recordDecisionOutcomesForChat, type AutopilotOutcomeTrigger } from '@/services/autopilot/outcome-tracker';
import type { PoolClient } from 'pg';
import { validateSchema } from 'genkit/schema';
import { normalizeToolArgumentsFromJsonSchema } from '@/services/workflow-runtime/tool-arguments';
import { authorizeAgentToolCapability } from '@/services/agent-runtime/capability-gateway';

const MAX_ACTIONS_PER_MESSAGE = 2;
const MAX_INTERNAL_NOTE_CHARS = 500;
const CLOSE_DB_ACQUIRE_TIMEOUT_MS = Math.max(
  1_000,
  Math.min(30_000, Number(process.env.AGENT_TOOL_CLOSE_DB_ACQUIRE_TIMEOUT_MS || 5_000) || 5_000),
);
const CLOSE_TEMPLATE_TIMEOUT_MS = Math.max(
  1_000,
  Math.min(30_000, Number(process.env.AGENT_TOOL_CLOSE_TEMPLATE_TIMEOUT_MS || 5_000) || 5_000),
);
const CLOSE_POST_COMMIT_EFFECT_TIMEOUT_MS = Math.max(
  1_000,
  Math.min(60_000, Number(process.env.AGENT_TOOL_CLOSE_POST_COMMIT_EFFECT_TIMEOUT_MS || 10_000) || 10_000),
);
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

async function recordOutcomeSafely(input: {
  workspaceId: string;
  chatId: string;
  trigger: AutopilotOutcomeTrigger;
  closedAt?: string | Date | null;
}) {
  try {
    await recordDecisionOutcomesForChat(input);
  } catch (error) {
    console.warn('[AGENT_TOOL_OUTCOME_TRACKER] Failed to record outcome:', error);
  }
}

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
    toolName: (
      action.type === 'mcp_call_tool'
        ? String(action.payload?.toolName || action.type)
        : action.type
    ) as AgentToolExecutionResult['toolName'],
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

async function acquireAgentToolDbClient(): Promise<PoolClient> {
  const pendingClient = db.connect();
  try {
    return await withTimeout(
      pendingClient,
      CLOSE_DB_ACQUIRE_TIMEOUT_MS,
      'close database connection',
    );
  } catch (error) {
    // A Promise timeout does not cancel pg.Pool.connect(). Release a client
    // that arrives after the deadline so the pool cannot leak capacity.
    void pendingClient.then((lateClient) => lateClient.release()).catch(() => undefined);
    throw error;
  }
}

function buildToolNotAllowedMessage(context: AgentToolRuntimeContext, toolName: string): string {
  if (context.turnPolicy.globallyEnabledToolNames.includes(toolName)) {
    return `Ferramenta habilitada no agente, mas nao liberada para o no atual do fluxo (${context.turnPolicy.reason}).`;
  }

  return 'Ferramenta desabilitada nas configuracoes deste agente.';
}

function resolveRequestedToolName(action: AgentToolAction): string {
  if (action.type === 'mcp_call_tool') {
    return action.payload?.toolName || '';
  }
  return action.type;
}

type ActionExecutionPolicy = {
  idempotent: boolean;
  useDurableClaim: boolean;
};

async function resolveActionExecutionPolicy(
  context: AgentToolRuntimeContext,
  action: AgentToolAction,
): Promise<ActionExecutionPolicy> {
  const definition = getAgentToolDefinition(action.type);
  if (action.type !== 'mcp_call_tool') {
    return {
      idempotent: Boolean(definition?.idempotent),
      useDurableClaim: !['read_only', 'compute_only', 'retrieval'].includes(definition?.class || ''),
    };
  }

  const qualifiedName = action.payload?.toolName?.trim() || '';
  const parsed = parseQualifiedMcpToolName(qualifiedName);
  if (!parsed) return { idempotent: false, useDurableClaim: true };
  try {
    const config = await getMcpWorkspaceConfig(context.workspaceId);
    const server = config.servers.find((item) => item.id === parsed.serverId && item.isActive);
    const tool = server?.tools?.find((item) => item.qualifiedName === qualifiedName);
    const safety = classifyMcpToolSafety(qualifiedName, tool);
    return {
      idempotent: safety.idempotent,
      // Durable claims protect mutations from duplicate side effects. Reads
      // are changing snapshots and must execute again (not reuse a persisted
      // pending result) when the agent polls an asynchronous command.
      useDurableClaim: !['read_only', 'compute_only', 'retrieval'].includes(safety.class),
    };
  } catch (error) {
    console.warn('[AGENT_TOOL_IDEMPOTENCY] Failed to resolve MCP safety:', error);
    return { idempotent: false, useDurableClaim: true };
  }
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
  try {
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
  } catch (error) {
    console.warn('[AGENT_TOOL_AUDIT] Failed to record orchestrator tool call:', error);
  }
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
        operationId: context.orchestratorRunId || context.sourceMessageId ? `tool:${context.orchestratorRunId ?? context.sourceMessageId}:${context.sourceMessageId ?? 'handoff'}` : randomUUID(),
        expectedAgentId: context.chat.agentId ?? context.chat.agent?.id ?? null,
        expectedTeamId: context.chat.team_id ?? null,
        expectedSystemAgentId: context.chat.assigned_system_agent_id ?? context.chat.assignedSystemAgent?.id ?? null,
        ...target,
      },
      createTrustedActorContext({
        user: {
          id: context.systemAgentId,
          name: context.systemAgentName,
        },
        isSystemAgent: true,
      })
    );

    if (!result.success) {
      if (result.outcomeUncertain) {
        return {
          toolName: 'transfer_chat',
          status: 'error',
          input: action,
          output: { disposition: 'uncertain', target },
          error: '[tool_idempotency:uncertain] Não foi possível confirmar a transferência; verifique o atendimento antes de repetir.',
        };
      }
      // Ramificar por `reasonCode`, nunca pelo texto do erro: com a comparacao
      // por string, todo motivo de indisponibilidade virava o aviso de "fora do
      // expediente" para o cliente — inclusive quando a equipe estava aberta e
      // apenas ocupada.
      if (result.reasonCode && target.teamId) {
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

          let messageText: string;
          if (result.reasonCode === 'outside_business_hours') {
            const businessHoursText = await formatTeamBusinessHours(target.teamId);
            messageText = `Agradeço o seu contato! No momento, a equipe ${teamName} está fora do expediente (${businessHoursText}). Seu atendimento foi colocado na fila para a equipe acompanhar quando estiver disponível.`;
          } else {
            messageText = `Agradeço o seu contato! No momento, todos os atendentes do setor ${teamName} estão ocupados. Seu atendimento já está na fila de espera e assim que um atendente ficar disponível você será atendido!`;
          }

          const queueUpdate = await db.query(
            `UPDATE chats
             SET agent_id = NULL,
                 assigned_system_agent_id = NULL,
                 is_autopilot_active = FALSE,
                 copilot_mode = 'off',
                 status = 'gerais',
                 team_id = $6,
                 tag = $1,
                 color = $2,
                 assigned_at = NULL,
                 updated_at = clock_timestamp()
             WHERE id = $3
               AND workspace_id = $4
               AND agent_id IS NULL
               AND assigned_system_agent_id = $5
               AND is_autopilot_active = TRUE
               AND status <> 'encerrados'
             RETURNING id`,
            [chatTag, chatColor, context.chat.id, context.workspaceId, context.systemAgentId, target.teamId]
          );
          if ((queueUpdate.rowCount ?? 0) === 0) {
            throw new Error('Chat mudou de responsavel antes da transferencia para a fila.');
          }
          // Same audit marker the flow handoff writes (chat-distribution/queue-unavailable-team): the queue SLA and the baseline read it.
          await db.query(
            `INSERT INTO messages (id, workspace_id, chat_id, type, content, metadata, created_at) VALUES ($1, $2, $3, 'system', $4, $5::jsonb, clock_timestamp())`,
            [randomUUID(), context.workspaceId, context.chat.id, `Atendimento encaminhado para a fila de ${teamName}.`,
              JSON.stringify({ event: 'transfer_queued', to_team_id: target.teamId, reason: result.reasonCode })],
          ).catch((markerError) => console.error('[TRANSFER_CHAT_FALLBACK] Queue marker failed:', markerError));

          let notificationDelivered = true;
          try {
            const notification = await sendAutomatedMessageAction(
              context.chat.id,
              messageText,
              context.systemAgentId,
              true
            );
            notificationDelivered = notification.success === true;
            if (!notificationDelivered) {
              console.error('[TRANSFER_CHAT_FALLBACK] Queue transition succeeded but customer notice failed:', notification.error);
            }
          } catch (notificationError) {
            notificationDelivered = false;
            console.error('[TRANSFER_CHAT_FALLBACK] Queue transition succeeded but customer notice failed:', notificationError);
          }

          await broadcastChatUpdate(context.workspaceId, context.chat.id, {
            agent_id: null,
            assigned_system_agent_id: null,
            is_autopilot_active: false,
            copilot_mode: 'off',
            status: 'gerais',
            team_id: target.teamId,
            tag: chatTag,
            color: chatColor,
            assigned_at: null,
          }).catch((broadcastError) => {
            console.error('[TRANSFER_CHAT_FALLBACK] Queue transition succeeded but realtime broadcast failed:', broadcastError);
          });
          await abortActiveProcedures(context.chat.id).catch((abortError) => {
            console.error('[TRANSFER_CHAT_FALLBACK] Queue transition succeeded but procedure cleanup failed:', abortError);
          });

          return {
            toolName: 'transfer_chat',
            status: 'success',
            input: action,
            output: {
              transferred: false,
              disposition: 'queued',
              fallbackExecuted: true,
              notificationDelivered,
              target,
              reasonCode: result.reasonCode,
              reason: result.error || 'Equipe indisponível no momento. Fila de espera ativada.',
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

    await abortActiveProcedures(context.chat.id).catch((error) => {
      console.error('[TRANSFER_CHAT] Transfer succeeded but procedure cleanup failed:', error);
    });
    return {
      toolName: 'transfer_chat',
      status: 'success',
      input: action,
      output: {
        transferred: true,
        disposition: 'assigned',
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

function normalizeClosedAt(value: unknown): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

async function runClosePostCommitEffects(input: {
  workspaceId: string;
  chatId: string;
  closedAt: unknown;
  reasonTagId: string | null;
  notes: string | null;
  tag: string | null;
  color: string | null;
  closeTemplate?: string;
  sendCloseMessage: boolean;
  systemAgentId: string;
  lastInstanceName: string | null;
}) {
  const closedAt = normalizeClosedAt(input.closedAt);
  const effects: Array<{ label: string; run: () => Promise<unknown> }> = [
    {
      label: 'abortar procedimentos',
      run: async () => abortActiveProcedures(input.chatId),
    },
    {
      label: 'publicar atualização',
      run: async () => broadcastChatUpdate(input.workspaceId, input.chatId, {
        status: 'encerrados',
        closed_at: closedAt,
        close_reason_tag_id: input.reasonTagId,
        close_notes: input.notes,
        tag: input.tag || '',
        color: input.color || '',
        assigned_system_agent_id: null,
        assigned_at: null,
        is_autopilot_active: false,
        copilot_mode: 'off',
      }),
    },
    {
      label: 'atualizar memória de caso',
      run: async () => {
        if (shouldEnqueueJob('ai_case_memory_refresh')) {
          await enqueueAiCaseMemoryRefresh({
            workspaceId: input.workspaceId,
            chatId: input.chatId,
            closedAt,
          });
        } else {
          await refreshCaseMemoryForChat({
            workspaceId: input.workspaceId,
            chatId: input.chatId,
            closedAt,
          });
        }
      },
    },
  ];
  if (input.closeTemplate && input.sendCloseMessage) {
    effects.push({
      label: 'enviar template de encerramento',
      run: async () => {
        const result = await sendAutomatedMessageAction(
          input.chatId,
          input.closeTemplate!,
          input.systemAgentId,
          true,
          input.lastInstanceName || undefined,
          {
            event: 'close_notice',
            authored_by_system_agent_id: input.systemAgentId,
            template_applied: true,
            reason_tag_id: input.reasonTagId,
          },
        );
        if (!result.success) {
          throw new Error(result.error || 'Falha ao enviar template de encerramento.');
        }
        return result;
      },
    });
  }

  const results = await Promise.allSettled(effects.map((effect) => withTimeout(
    Promise.resolve().then(effect.run),
    CLOSE_POST_COMMIT_EFFECT_TIMEOUT_MS,
    `close post-commit effect: ${effect.label}`,
  )));
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      console.error(
        `[AGENT_TOOL_CLOSE_CHAT] Falha pós-commit ao ${effects[index]?.label || 'executar efeito'}:`,
        result.reason,
      );
    }
  });
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

  let closeTemplate: string | undefined;
  if (sendCloseMessage) {
    try {
      const { closeMessageTemplate } = await withTimeout(
        getWorkspaceTemplates(context.workspaceId),
        CLOSE_TEMPLATE_TIMEOUT_MS,
        'close template lookup',
      );
      closeTemplate = closeMessageTemplate || undefined;
    } catch (templateLookupError) {
      console.error('[AGENT_TOOL_CLOSE_CHAT] Falha ao carregar template antes da transação:', templateLookupError);
    }
  }
  const client = await acquireAgentToolDbClient();
  let workspaceId = context.workspaceId;
  let lastInstanceName: string | null = null;
  let committed = false;
  let commitAttempted = false;
  let clientReleased = false;

  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '20s'");

    const chatRes = await client.query(
       `SELECT
          workspace_id,
          status,
          agent_id,
          assigned_system_agent_id,
          is_autopilot_active,
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

    if (
      chatRow.agent_id
      || chatRow.is_autopilot_active !== true
      || chatRow.assigned_system_agent_id !== context.systemAgentId
    ) {
      await client.query('ROLLBACK');
      return reject(action, 'Chat nao esta mais atribuido a este Atendente Inteligente.');
    }

    workspaceId = chatRow.workspace_id;
    lastInstanceName = chatRow.last_instance_name || null;

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

    const closeUpdateRes = await client.query(
      `UPDATE chats
       SET
          status = 'encerrados',
          closed_at = clock_timestamp(),
          close_reason_tag_id = $1,
          close_notes = $2,
          tag = $3,
          color = $4,
          assigned_system_agent_id = NULL,
          assigned_at = NULL,
          is_autopilot_active = FALSE,
          copilot_mode = 'off',
          updated_at = clock_timestamp()
       WHERE id = $5
         AND workspace_id = $6
         AND agent_id IS NULL
         AND assigned_system_agent_id = $7
         AND is_autopilot_active = TRUE
         AND status <> 'encerrados'
       RETURNING closed_at, close_reason_tag_id, close_notes, tag, color`,
      [
        reasonTagId,
        notes,
        tagInfo.label ?? chatRow.current_tag ?? '',
        tagInfo.color ?? chatRow.current_color ?? '',
        context.chat.id,
        workspaceId,
        context.systemAgentId,
      ]
    );

    if ((closeUpdateRes.rowCount ?? 0) === 0) {
      await client.query('ROLLBACK');
      return reject(action, 'Chat mudou de responsavel antes do encerramento.');
    }

    await client.query(
      `UPDATE meta_conversations
       SET status = 'closed', updated_at = timezone('utc', now())
       WHERE chat_id = $1`,
      [context.chat.id]
    );

    await client.query(
      `UPDATE autopilot_conversation_states
          SET pending_confirmation = NULL,
              active_node_id = NULL,
              metadata = jsonb_set(
                COALESCE(metadata, '{}'::jsonb),
                '{nativeState}',
                COALESCE(metadata->'nativeState', '{}'::jsonb) - 'collectionCompletionV1',
                true
              ),
              updated_at = clock_timestamp()
        WHERE chat_id = $1`,
      [context.chat.id],
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

    commitAttempted = true;
    await client.query('COMMIT');
    committed = true;

    const closedChatState = closeUpdateRes.rows[0] || {};
    await runClosePostCommitEffects({
      workspaceId,
      chatId: context.chat.id,
      closedAt: closedChatState.closed_at,
      reasonTagId: closedChatState.close_reason_tag_id ?? reasonTagId,
      notes: closedChatState.close_notes ?? notes,
      tag: closedChatState.tag ?? tagInfo.label ?? chatRow.current_tag ?? '',
      color: closedChatState.color ?? tagInfo.color ?? chatRow.current_color ?? '',
      closeTemplate,
      sendCloseMessage,
      systemAgentId: context.systemAgentId,
      lastInstanceName,
    });

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
    if (!committed && commitAttempted) {
      try {
        client.release(true);
        clientReleased = true;
      } catch {
        // The connection may already have been discarded by pg.
      }
      try {
        const reconciliation = await withTimeout(
          db.query(
            `SELECT status, closed_at, close_reason_tag_id, close_notes, tag, color
             FROM chats
             WHERE id = $1 AND workspace_id = $2
             LIMIT 1`,
            [context.chat.id, context.workspaceId],
          ),
          5_000,
          'close commit reconciliation',
        );
        const reconciledChat = reconciliation.rows[0];
        if (reconciledChat?.status === 'encerrados') {
          console.warn('[AGENT_TOOL_CLOSE_CHAT] COMMIT sem confirmação de rede; estado fechado reconciliado no banco.');
          await runClosePostCommitEffects({
            workspaceId: context.workspaceId,
            chatId: context.chat.id,
            closedAt: reconciledChat.closed_at,
            reasonTagId: reconciledChat.close_reason_tag_id ?? reasonTagId,
            notes: reconciledChat.close_notes ?? notes,
            tag: reconciledChat.tag ?? '',
            color: reconciledChat.color ?? '',
            closeTemplate,
            sendCloseMessage,
            systemAgentId: context.systemAgentId,
            lastInstanceName,
          });
          return {
            toolName: 'close_chat',
            status: 'success',
            input: action,
            output: {
              closed: true,
              reasonTagId,
              sendCloseMessage,
              commitOutcomeReconciled: true,
            },
          };
        }
      } catch (reconciliationError) {
        console.error('[AGENT_TOOL_CLOSE_CHAT] Não foi possível reconciliar COMMIT incerto:', reconciliationError);
      }
    }
    if (!committed) {
      if (!clientReleased) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // Ignore rollback errors after connection-level failures.
        }
      }
    } else {
      console.error('[AGENT_TOOL_CLOSE_CHAT] Falha pós-commit não reverte o encerramento:', error);
      return {
        toolName: 'close_chat',
        status: 'success',
        input: action,
        output: {
          closed: true,
          reasonTagId,
          sendCloseMessage,
          postCommitWarning: true,
        },
      };
    }

    return {
      toolName: 'close_chat',
      status: 'error',
      input: action,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    if (!clientReleased) client.release();
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
    const schemaArguments = normalizeToolArgumentsFromJsonSchema(
      normalizedArguments.arguments,
      tool.inputSchema,
    );
    if (tool.inputSchema && Object.keys(tool.inputSchema).length > 0) {
      const validation = validateSchema(schemaArguments, { jsonSchema: tool.inputSchema });
      if (!validation.valid) {
        const required = Array.isArray(tool.inputSchema.required)
          ? tool.inputSchema.required.map(String)
          : [];
        return reject(
          action,
          `Argumentos invalidos para ${qualifiedName}. Campos esperados: ${required.join(', ') || 'conforme o schema sincronizado'}.`,
        );
      }
    }
    const normalizedAction: typeof action = {
      ...action,
      payload: {
        ...action.payload,
        arguments: schemaArguments,
      },
    };

    const callStartedAt = Date.now();
    let result: Awaited<ReturnType<typeof callMcpServerTool>>;
    try {
      result = await callMcpServerTool({
        server,
        toolName: parsed.toolName,
        arguments: schemaArguments,
      });
      await recordMcpServerHealth({
        workspaceId: context.workspaceId,
        serverId: server.id,
        status: 'healthy',
        latencyMs: Date.now() - callStartedAt,
      }).catch((healthError) => {
        console.warn('[MCP_HEALTH] Failed to persist healthy status:', healthError);
      });
    } catch (error) {
      await recordMcpServerHealth({
        workspaceId: context.workspaceId,
        serverId: server.id,
        status: 'unreachable',
        latencyMs: Date.now() - callStartedAt,
        error: error instanceof Error ? error.message : String(error),
      }).catch((healthError) => {
        console.warn('[MCP_HEALTH] Failed to persist unreachable status:', healthError);
      });
      throw error;
    }

    const content = (result as any).content || null;
    const textError = Array.isArray(content)
      ? content
          .map((item: any) => item?.type === 'text' ? item.text : null)
          .filter(Boolean)
          .join('\n')
          .trim()
      : '';

    if ((result as any).isError) {
      const structured = (result as any).structuredContent;
      let errorMsg = textError || 'Ferramenta MCP retornou erro.';
      if (structured?.remedial_suggestion) {
        errorMsg += `\n[Instrução Corretiva do ACS]: ${structured.remedial_suggestion}`;
      }
      return {
        toolName: qualifiedName as any,
        status: 'error',
        input: normalizedAction,
        error: errorMsg,
        output: JSON.parse(JSON.stringify({
          content,
          structuredContent: structured || null,
          isError: true,
        })),
      };
    }

    return {
      toolName: qualifiedName as any,
      status: 'success',
      input: normalizedAction,
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
    if (!(await ensureChatStillAssignedToAgent(runtimeContext))) {
      const result = reject(action, 'Chat nao esta mais atribuido a este Atendente Inteligente.');
      await auditToolResult(runtimeContext, result, Date.now() - startedAt);
      results.push(result);
      break;
    }
    if (!ALLOWED_TOOLS.has(action.type)) {
      const result = reject(action, 'Ferramenta nao permitida para Atendente Inteligente.');
      await auditToolResult(runtimeContext, result, Date.now() - startedAt);
      results.push(result);
      continue;
    }

    const requestedToolName = resolveRequestedToolName(action);
    if (!isToolEnabledForAgent(runtimeContext, requestedToolName)) {
      const result = reject(action, buildToolNotAllowedMessage(runtimeContext, requestedToolName));
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

    const capabilityAuthorization = authorizeAgentToolCapability({
      action,
      intentResolution: runtimeContext.intent ? { intent: runtimeContext.intent } : undefined,
      slotExtraction: runtimeContext.slotExtraction,
      enabledToolNames: runtimeContext.turnPolicy.allowedToolNames,
      toolCatalog: listAgentToolCatalogItems(),
      confirmedActionFingerprint: runtimeContext.confirmedActionFingerprint,
      // The existing policy gate remains responsible for conversational
      // confirmation context. This preflight enforces the immutable contract
      // (scope, required fields, risk class and human-approval flag) first.
      enforceConfirmation: false,
    });
    if (!capabilityAuthorization.allowed) {
      const result = reject(
        action,
        `[capability_gateway:${capabilityAuthorization.code}] ${capabilityAuthorization.reason}`,
      );
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

    const executionPolicy = await resolveActionExecutionPolicy(runtimeContext, action);
    const actionIdempotent = executionPolicy.idempotent;
    let durableClaim: DurableToolClaim = { kind: 'disabled' };
    if (executionPolicy.useDurableClaim) {
      try {
        durableClaim = await claimDurableAgentToolExecution({
          workspaceId: runtimeContext.workspaceId,
          chatId: runtimeContext.chat.id,
          orchestratorRunId: runtimeContext.orchestratorRunId,
          action,
          toolName: requestedToolName,
          idempotent: actionIdempotent,
        });
      } catch (error) {
        console.error('[AGENT_TOOL_IDEMPOTENCY] Failed to acquire durable execution claim:', error);
        if (!actionIdempotent) {
          const result = reject(
            action,
            '[tool_idempotency:unavailable] Nao foi possivel garantir execucao unica. A acao foi bloqueada por seguranca.',
          );
          await auditToolResult(runtimeContext, result, Date.now() - startedAt);
          results.push(result);
          continue;
        }
      }
    }

    if (durableClaim.kind === 'reuse') {
      results.push(durableClaim.result);
      continue;
    }
    if (durableClaim.kind === 'blocked') {
      await auditToolResult(runtimeContext, durableClaim.result, Date.now() - startedAt);
      results.push(durableClaim.result);
      continue;
    }

    let result: AgentToolExecutionResult;
    try {
      const operation = (async () => {
        if (action.type === 'transfer_chat') return runTransferChatTool(runtimeContext, action);
        if (action.type === 'close_chat') return runCloseChatTool(runtimeContext, action);
        if (action.type === 'add_internal_note') return runAddInternalNoteTool(runtimeContext, action);
        if (action.type === 'mcp_call_tool') return runMcpCallTool(runtimeContext, action);
        if (action.type === 'crm_update_contact_custom_fields') {
          return runCrmUpdateContactCustomFieldsTool(runtimeContext, action);
        }
        return runSgpTool(runtimeContext, action as any);
      })();
      // These operations mutate chat ownership/state. A Promise timeout cannot
      // cancel their transaction and may report failure before it commits.
      // Wait for the authoritative result instead of triggering a duplicate.
      result = action.type === 'close_chat' || action.type === 'transfer_chat'
        ? await operation
        : await withTimeout(operation, definition.timeoutMs, `agent tool ${definition.name}`);
    } catch (error) {
      result = {
        toolName: requestedToolName as AgentToolExecutionResult['toolName'],
        status: 'error',
        input: action,
        error: error instanceof Error ? error.message : String(error),
      };
    }

    if (durableClaim.kind === 'execute') {
      try {
        await durableClaim.complete(result);
      } catch (error) {
        console.error('[AGENT_TOOL_IDEMPOTENCY] Failed to complete durable execution claim:', error);
      }
    }

    if (action.type === 'transfer_chat' && result.status === 'success') {
      transferExecuted = true;
    }
    if (result.status === 'success') {
      await clearPendingToolConfirmation(runtimeContext.chat.id, action).catch((error) => {
        console.warn('[AGENT_TOOL_CONFIRMATION] Failed to clear confirmation after successful tool:', error);
      });
    }

    await auditToolResult(runtimeContext, result, Date.now() - startedAt);
    if (result.status === 'success' && (action.type === 'transfer_chat' || action.type === 'close_chat')) {
      await recordOutcomeSafely({
        workspaceId: runtimeContext.workspaceId,
        chatId: runtimeContext.chat.id,
        trigger: action.type === 'transfer_chat'
          ? (result.output?.transferred === false ? 'manual' : 'handoff')
          : 'closed',
      });
    }
    results.push(result);
    if (result.status === 'success' && (action.type === 'transfer_chat' || action.type === 'close_chat')) {
      break;
    }
  }

  return results;
}
