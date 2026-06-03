import type { AgentToolAction } from "@/services/agent-tools/types";
import { db } from "@/lib/db";

const CONFIRMATION_TTL_MS = 10 * 60 * 1000;

export type PendingToolConfirmation = {
  action: AgentToolAction;
  requestedAt: string;
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
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
}

export function isExplicitAffirmativeMessage(message: string) {
  return /^(sim|s|confirmo|confirmado|pode|pode sim|pode fazer|autorizo|prosseguir|prossiga|ok|okay|certo)$/i
    .test(normalize(message));
}

export function resolveConfirmedPendingAction(input: {
  state: AutopilotConversationState | null;
  message: string;
  allowedToolNames: string[];
}) {
  const pending = input.state?.pendingConfirmation;
  if (!pending || !isExplicitAffirmativeMessage(input.message)) return null;
  if (!input.allowedToolNames.includes(pending.action.type)) return null;
  const requestedAt = Date.parse(pending.requestedAt);
  if (!Number.isFinite(requestedAt) || Date.now() - requestedAt > CONFIRMATION_TTL_MS) return null;
  return pending.action;
}
