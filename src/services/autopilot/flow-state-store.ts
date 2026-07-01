import type { AgentToolAction } from "@/services/agent-tools/types";
import { fingerprintToolAction } from "@/services/agent-tools/action-fingerprint";
import { db } from "@/lib/db";

const CONFIRMATION_TTL_MS = 10 * 60 * 1000;

export type PendingToolConfirmation = {
  action: AgentToolAction;
  requestedAt: string;
  actionFingerprint?: string;
};

export type AutopilotConversationState = {
  chatId: string;
  workspaceId: string;
  autopilotConfigId: string | null;
  activeNodeId: string | null;
  pendingConfirmation: PendingToolConfirmation | null;
  lastAction: AgentToolAction | null;
  repetitionCount: number;
};

type StateRow = {
  chat_id: string;
  workspace_id: string;
  autopilot_config_id: string | null;
  active_node_id: string | null;
  pending_confirmation: PendingToolConfirmation | null;
  last_action: AgentToolAction | null;
  repetition_count: number;
};

function mapRow(row: StateRow): AutopilotConversationState {
  return {
    chatId: row.chat_id,
    workspaceId: row.workspace_id,
    autopilotConfigId: row.autopilot_config_id,
    activeNodeId: row.active_node_id,
    pendingConfirmation: row.pending_confirmation,
    lastAction: row.last_action,
    repetitionCount: row.repetition_count,
  };
}

export async function getAutopilotConversationState(chatId: string) {
  const result = await db.query<StateRow>(
    `SELECT chat_id, workspace_id, autopilot_config_id, active_node_id,
            pending_confirmation, last_action, repetition_count
       FROM autopilot_conversation_states
      WHERE chat_id = $1
      LIMIT 1`,
    [chatId],
  );
  return result.rows[0] ? mapRow(result.rows[0]) : null;
}

export async function saveAutopilotTurnState(input: {
  chatId: string;
  workspaceId: string;
  autopilotConfigId?: string | null;
  activeNodeId?: string | null;
}) {
  await db.query(
    `INSERT INTO autopilot_conversation_states (
       chat_id, workspace_id, autopilot_config_id, active_node_id, updated_at
     ) VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (chat_id) DO UPDATE SET
       workspace_id = EXCLUDED.workspace_id,
       autopilot_config_id = EXCLUDED.autopilot_config_id,
       active_node_id = EXCLUDED.active_node_id,
       updated_at = NOW()`,
    [input.chatId, input.workspaceId, input.autopilotConfigId ?? null, input.activeNodeId ?? null],
  );
}

export async function setPendingToolConfirmation(input: {
  chatId: string;
  workspaceId: string;
  autopilotConfigId?: string | null;
  activeNodeId?: string | null;
  action: AgentToolAction;
}) {
  const pending: PendingToolConfirmation = {
    action: input.action,
    requestedAt: new Date().toISOString(),
    actionFingerprint: fingerprintToolAction(input.action),
  };
  await db.query(
    `INSERT INTO autopilot_conversation_states (
       chat_id, workspace_id, autopilot_config_id, active_node_id,
       pending_confirmation, updated_at
     ) VALUES ($1, $2, $3, $4, $5::jsonb, NOW())
     ON CONFLICT (chat_id) DO UPDATE SET
       workspace_id = EXCLUDED.workspace_id,
       autopilot_config_id = EXCLUDED.autopilot_config_id,
       active_node_id = EXCLUDED.active_node_id,
       pending_confirmation = EXCLUDED.pending_confirmation,
       updated_at = NOW()`,
    [
      input.chatId,
      input.workspaceId,
      input.autopilotConfigId ?? null,
      input.activeNodeId ?? null,
      JSON.stringify(pending),
    ],
  );
}

export async function clearPendingToolConfirmation(chatId: string, action?: AgentToolAction) {
  await db.query(
    `UPDATE autopilot_conversation_states
        SET pending_confirmation = NULL,
            last_action = COALESCE($2::jsonb, last_action),
            updated_at = NOW()
      WHERE chat_id = $1
        AND ($2::jsonb IS NULL OR pending_confirmation->'action' = $2::jsonb)`,
    [chatId, action ? JSON.stringify(action) : null],
  );
}

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function requestedToolName(action: AgentToolAction) {
  return action.type === 'mcp_call_tool'
    ? String(action.payload?.toolName || '').trim()
    : action.type;
}

export function isExplicitAffirmativeMessage(message: string) {
  return /^(sim|s|sim confirmo|confirmo|confirmado|confirmo a acao|pode|pode sim|pode fazer|pode prosseguir|autorizo|autorizado|prosseguir|prossiga|ok|okay|certo)$/i
    .test(normalize(message));
}

export function isExplicitPendingActionCancellation(message: string) {
  return /^(nao|n|cancelar|cancela|cancele|desistir|desisto|deixa|deixa pra la|deixa para la|nao quero|melhor nao)$/i
    .test(normalize(message));
}

export function resolveConfirmedPendingAction(input: {
  state: AutopilotConversationState | null;
  message: string;
  allowedToolNames: string[];
}) {
  const pending = input.state?.pendingConfirmation;
  if (!pending || !isExplicitAffirmativeMessage(input.message)) return null;
  if (
    pending.actionFingerprint &&
    pending.actionFingerprint !== fingerprintToolAction(pending.action)
  ) {
    return null;
  }
  const requested = requestedToolName(pending.action);
  if (!input.allowedToolNames.includes(pending.action.type) && !input.allowedToolNames.includes(requested)) return null;
  const requestedAt = Date.parse(pending.requestedAt);
  if (!Number.isFinite(requestedAt) || Date.now() - requestedAt > CONFIRMATION_TTL_MS) return null;
  return pending.action;
}

async function consumePendingActionRow(input: {
  chatId: string;
  action: AgentToolAction;
  recordAsLastAction: boolean;
}) {
  const serializedAction = JSON.stringify(input.action);
  const result = await db.query(
    `UPDATE autopilot_conversation_states
        SET pending_confirmation = NULL,
            last_action = CASE WHEN $3::boolean THEN $2::jsonb ELSE last_action END,
            updated_at = NOW()
      WHERE chat_id = $1
        AND pending_confirmation->'action' = $2::jsonb
      RETURNING chat_id`,
    [input.chatId, serializedAction, input.recordAsLastAction],
  );
  return Boolean(result.rows[0]);
}

export async function consumeConfirmedPendingAction(input: {
  state: AutopilotConversationState | null;
  message: string;
  allowedToolNames: string[];
}) {
  const action = resolveConfirmedPendingAction(input);
  if (!action || !input.state) return null;
  const consumed = await consumePendingActionRow({
    chatId: input.state.chatId,
    action,
    recordAsLastAction: true,
  });
  return consumed ? action : null;
}

export async function consumePendingActionCancellation(input: {
  state: AutopilotConversationState | null;
  message: string;
}) {
  const pending = input.state?.pendingConfirmation;
  if (!pending || !input.state || !isExplicitPendingActionCancellation(input.message)) return false;
  return consumePendingActionRow({
    chatId: input.state.chatId,
    action: pending.action,
    recordAsLastAction: false,
  });
}

export async function consumeSupersededPendingAction(input: {
  state: AutopilotConversationState | null;
  message: string;
}) {
  const pending = input.state?.pendingConfirmation;
  const message = input.message.trim();
  if (
    !pending ||
    !input.state ||
    !message ||
    isExplicitAffirmativeMessage(message) ||
    isExplicitPendingActionCancellation(message)
  ) {
    return false;
  }
  return consumePendingActionRow({
    chatId: input.state.chatId,
    action: pending.action,
    recordAsLastAction: false,
  });
}
