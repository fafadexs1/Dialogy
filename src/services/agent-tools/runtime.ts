import { db } from '@/lib/db';
import { transferChatAction } from '@/actions/chats';
import { auditAgentToolExecution } from './audit';
import type { AgentToolAction, AgentToolExecutionResult, AgentToolRuntimeContext } from './types';

const MAX_ACTIONS_PER_MESSAGE = 2;
const ALLOWED_TOOLS = new Set(['transfer_chat', 'add_internal_note']);

function reject(action: AgentToolAction, message: string): AgentToolExecutionResult {
  return {
    toolName: action.type as any,
    status: 'rejected',
    input: action,
    error: message,
  };
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
    const { rows } = await db.query(
      `SELECT id
       FROM teams
       WHERE workspace_id = $1 AND lower(name) = lower($2)
       ORDER BY name
       LIMIT 1`,
      [context.workspaceId, payload.teamName.trim()]
    );
    if (!rows[0]) {
      throw new Error(`Equipe "${payload.teamName}" nao encontrada neste workspace.`);
    }
    return { teamId: rows[0].id as string };
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
  const content = action.payload?.content?.trim() || action.reason?.trim();
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
      const result = reject(action, 'Chat nao esta atribuido a este Atendente Inteligente ou autopilot esta desligado.');
      await auditAgentToolExecution(context, result);
      results.push(result);
    }
    return results;
  }

  let transferExecuted = false;
  for (const action of normalizedActions) {
    if (!ALLOWED_TOOLS.has(action.type)) {
      const result = reject(action, 'Ferramenta nao permitida para Atendente Inteligente.');
      await auditAgentToolExecution(context, result);
      results.push(result);
      continue;
    }

    if (action.type === 'transfer_chat' && transferExecuted) {
      const result = reject(action, 'Apenas uma transferencia pode ser executada por mensagem.');
      await auditAgentToolExecution(context, result);
      results.push(result);
      continue;
    }

    const result =
      action.type === 'transfer_chat'
        ? await runTransferChatTool(context, action)
        : await runAddInternalNoteTool(context, action);

    if (action.type === 'transfer_chat' && result.status === 'success') {
      transferExecuted = true;
    }

    await auditAgentToolExecution(context, result);
    results.push(result);
  }

  return results;
}
