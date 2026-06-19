import { db } from '@/lib/db';

export type AutopilotOutcomeTrigger = 'closed' | 'handoff' | 'timeout' | 'manual';

export type AutopilotDecisionOutcome = {
  resolved: boolean;
  resolutionType: 'automated' | 'human_handoff' | 'manual_close' | 'timeout' | 'open' | 'unknown';
  turnsToResolve: number;
  timeToResolutionSeconds: number | null;
  customerAskedForHuman: boolean;
  customerSentimentFinal: 'positive' | 'neutral' | 'negative';
  toolsExecuted: string[];
  toolsFailed: string[];
  escalationNeeded: boolean;
  closedBy: 'agent' | 'human' | 'system' | null;
  chatStatus: string | null;
  stepOutcomes: Array<{
    procedureId: string | null;
    stepId: string;
    turnsOnStep: number;
    decisionCount: number;
    customerConfused: boolean;
    escalated: boolean;
  }>;
};

type OutcomeMessage = {
  id?: string | null;
  content?: string | null;
  fromMe?: boolean | null;
  createdAt?: string | Date | null;
};

type OutcomeToolCall = {
  toolName: string;
  status: string;
  createdAt?: string | Date | null;
};

type OutcomeLedgerDecision = {
  messageId?: string | null;
  decisionType: string;
  procedureId?: string | null;
  stepId?: string | null;
  selectedTools?: string[];
  createdAt?: string | Date | null;
};

export type BuildDecisionOutcomeInput = {
  trigger?: AutopilotOutcomeTrigger;
  chatStatus?: string | null;
  chatCreatedAt?: string | Date | null;
  closedAt?: string | Date | null;
  messages?: OutcomeMessage[];
  toolCalls?: OutcomeToolCall[];
  decisions?: OutcomeLedgerDecision[];
};

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function unique(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)));
}

function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return unique(value.map((item) => typeof item === 'string' ? item : null));
  if (typeof value === 'string') {
    try {
      return parseStringArray(JSON.parse(value));
    } catch {
      return [];
    }
  }
  return [];
}

function inferCustomerSentiment(messages: OutcomeMessage[]): AutopilotDecisionOutcome['customerSentimentFinal'] {
  const lastCustomerMessage = [...messages]
    .reverse()
    .find((message) => !message.fromMe && message.content?.trim());
  const text = String(lastCustomerMessage?.content || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  if (/\b(obrigad|valeu|perfeito|resolvid|deu certo|show|otimo|excelente)\b/.test(text)) return 'positive';
  if (/\b(ruim|horrivel|pessim|reclama|cancel|irritad|nao resolveu|problema continua|demora)\b/.test(text)) return 'negative';
  return 'neutral';
}

function customerAskedForHuman(messages: OutcomeMessage[]) {
  return messages.some((message) => {
    if (message.fromMe) return false;
    const text = String(message.content || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
    return /\b(humano|atendente|pessoa|supervisor|gerente|falar com alguem)\b/.test(text);
  });
}

function buildStepOutcomes(decisions: OutcomeLedgerDecision[]): AutopilotDecisionOutcome['stepOutcomes'] {
  const grouped = new Map<string, OutcomeLedgerDecision[]>();
  for (const decision of decisions) {
    const stepId = decision.stepId?.trim();
    if (!stepId) continue;
    const key = `${decision.procedureId || 'none'}:${stepId}`;
    grouped.set(key, [...(grouped.get(key) || []), decision]);
  }

  return Array.from(grouped.values()).map((items) => {
    const first = items[0];
    const messageIds = unique(items.map((item) => item.messageId));
    const selectedTools = items.flatMap((item) => item.selectedTools || []);
    return {
      procedureId: first?.procedureId || null,
      stepId: first?.stepId || '',
      turnsOnStep: messageIds.length || items.length,
      decisionCount: items.length,
      customerConfused: items.some((item) => item.decisionType === 'fallback' || item.decisionType === 'ask_slot'),
      escalated: selectedTools.includes('transfer_chat'),
    };
  });
}

export function buildDecisionOutcome(input: BuildDecisionOutcomeInput): AutopilotDecisionOutcome {
  const messages = input.messages || [];
  const toolCalls = input.toolCalls || [];
  const decisions = input.decisions || [];
  const successfulTools = unique(toolCalls
    .filter((tool) => tool.status === 'success')
    .map((tool) => tool.toolName));
  const failedTools = unique(toolCalls
    .filter((tool) => tool.status !== 'success')
    .map((tool) => tool.toolName));
  const hasSuccessfulTransfer = successfulTools.includes('transfer_chat');
  const hasSuccessfulClose = successfulTools.includes('close_chat');
  const askedHuman = customerAskedForHuman(messages);

  let resolutionType: AutopilotDecisionOutcome['resolutionType'] = 'open';
  if (input.trigger === 'timeout') {
    resolutionType = 'timeout';
  } else if (input.trigger === 'handoff' || hasSuccessfulTransfer) {
    resolutionType = 'human_handoff';
  } else if (input.chatStatus === 'encerrados' || input.trigger === 'closed') {
    resolutionType = hasSuccessfulClose ? 'automated' : 'manual_close';
  } else if (!input.chatStatus) {
    resolutionType = 'unknown';
  }

  const closedAt = toDate(input.closedAt)
    || (hasSuccessfulTransfer
      ? toDate(toolCalls.find((tool) => tool.toolName === 'transfer_chat' && tool.status === 'success')?.createdAt)
      : null);
  const firstMessageAt = messages
    .map((message) => toDate(message.createdAt))
    .filter((date): date is Date => Boolean(date))
    .sort((a, b) => a.getTime() - b.getTime())[0] || null;
  const startedAt = firstMessageAt || toDate(input.chatCreatedAt);
  const timeToResolutionSeconds = startedAt && closedAt
    ? Math.max(0, Math.round((closedAt.getTime() - startedAt.getTime()) / 1000))
    : null;

  return {
    resolved: resolutionType === 'automated' || resolutionType === 'manual_close',
    resolutionType,
    turnsToResolve: messages.filter((message) => !message.fromMe).length,
    timeToResolutionSeconds,
    customerAskedForHuman: askedHuman,
    customerSentimentFinal: inferCustomerSentiment(messages),
    toolsExecuted: successfulTools,
    toolsFailed: failedTools,
    escalationNeeded: resolutionType === 'human_handoff' || askedHuman,
    closedBy: resolutionType === 'automated' ? 'agent'
      : resolutionType === 'manual_close' ? 'human'
        : resolutionType === 'timeout' ? 'system'
          : null,
    chatStatus: input.chatStatus || null,
    stepOutcomes: buildStepOutcomes(decisions),
  };
}

function shouldSuppressOutcomeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('agent_decision_ledger')
    || message.includes('orchestrator_tool_calls')
    || message.includes('messages')
    || message.includes('chats');
}

export async function recordDecisionOutcomesForChat(input: {
  workspaceId: string;
  chatId: string;
  trigger?: AutopilotOutcomeTrigger;
  closedAt?: string | Date | null;
}): Promise<AutopilotDecisionOutcome | null> {
  try {
    const chatRes = await db.query(
      `SELECT id, status, created_at, closed_at
       FROM chats
       WHERE id = $1 AND workspace_id = $2
       LIMIT 1`,
      [input.chatId, input.workspaceId],
    );
    const chat = chatRes.rows[0];
    if (!chat) return null;

    const [messagesRes, toolsRes, decisionsRes] = await Promise.all([
      db.query(
        `SELECT id, content, from_me, created_at
         FROM messages
         WHERE chat_id = $1
         ORDER BY created_at ASC`,
        [input.chatId],
      ),
      db.query(
        `SELECT tool_name, status, created_at
         FROM orchestrator_tool_calls
         WHERE workspace_id = $1 AND chat_id = $2
         ORDER BY created_at ASC`,
        [input.workspaceId, input.chatId],
      ),
      db.query(
        `SELECT id, message_id, decision_type, procedure_id, step_id, selected_tools_json, created_at
         FROM agent_decision_ledger
         WHERE workspace_id = $1 AND chat_id = $2
         ORDER BY created_at ASC`,
        [input.workspaceId, input.chatId],
      ),
    ]);

    const outcome = buildDecisionOutcome({
      trigger: input.trigger,
      chatStatus: chat.status,
      chatCreatedAt: chat.created_at,
      closedAt: input.closedAt || chat.closed_at || null,
      messages: messagesRes.rows.map((row) => ({
        id: row.id,
        content: row.content,
        fromMe: row.from_me,
        createdAt: row.created_at,
      })),
      toolCalls: toolsRes.rows.map((row) => ({
        toolName: row.tool_name,
        status: row.status,
        createdAt: row.created_at,
      })),
      decisions: decisionsRes.rows.map((row) => ({
        messageId: row.message_id,
        decisionType: row.decision_type,
        procedureId: row.procedure_id,
        stepId: row.step_id,
        selectedTools: parseStringArray(row.selected_tools_json),
        createdAt: row.created_at,
      })),
    });

    await db.query(
      `UPDATE agent_decision_ledger
       SET outcome_json = $3::jsonb,
           outcome_recorded_at = clock_timestamp()
       WHERE workspace_id = $1
         AND chat_id = $2
         AND outcome_recorded_at IS NULL`,
      [input.workspaceId, input.chatId, JSON.stringify(outcome)],
    );

    return outcome;
  } catch (error) {
    if (!shouldSuppressOutcomeError(error)) {
      console.error('[AUTOPILOT_OUTCOME_TRACKER] Failed to record decision outcomes:', error);
    }
    return null;
  }
}
