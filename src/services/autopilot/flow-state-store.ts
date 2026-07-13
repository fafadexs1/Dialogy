import type { AgentToolAction } from "@/services/agent-tools/types";
import { fingerprintToolAction } from "@/services/agent-tools/action-fingerprint";
import { db } from "@/lib/db";
import type { AutopilotExtractedSlots, AutopilotSlotName } from './intent-types';

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
  metadata?: Record<string, unknown>;
};

type StateRow = {
  chat_id: string;
  workspace_id: string;
  autopilot_config_id: string | null;
  active_node_id: string | null;
  pending_confirmation: PendingToolConfirmation | null;
  last_action: AgentToolAction | null;
  repetition_count: number;
  metadata: Record<string, unknown> | null;
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
    metadata: row.metadata || {},
  };
}

export async function getAutopilotConversationState(chatId: string) {
  const result = await db.query<StateRow>(
    `SELECT chat_id, workspace_id, autopilot_config_id, active_node_id,
            pending_confirmation, last_action, repetition_count, metadata
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

const STABLE_CONTACT_SLOT_NAMES = new Set<AutopilotSlotName>([
  'name',
  'customer_identifier',
  'phone',
  'email',
  'address',
  'location',
]);

const ALL_SLOT_NAMES = new Set<AutopilotSlotName>([
  'name',
  'customer_identifier',
  'date',
  'time',
  'phone',
  'email',
  'address',
  'order_or_request_id',
  'invoice_or_payment_id',
  'product_or_service_id',
  'product_or_service_preference',
  'quantity',
  'location',
]);

function sanitizeSlotRecord(value: unknown, allowed = ALL_SLOT_NAMES): AutopilotExtractedSlots {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const slots: AutopilotExtractedSlots = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!allowed.has(key as AutopilotSlotName) || typeof raw !== 'string') continue;
    const clean = raw.replace(/\s+/g, ' ').trim().slice(0, 500);
    if (clean) slots[key as AutopilotSlotName] = clean;
  }
  return slots;
}

export type AutopilotContactMemory = {
  slots: AutopilotExtractedSlots;
  nativeState: Record<string, unknown>;
  updatedAt: string | null;
};

type ContactMemoryRow = {
  chat_id: string;
  metadata: Record<string, unknown> | null;
  updated_at: string | Date;
  slot_memory_updated_at: string | Date;
};

/**
 * Hydrates stable contact facts across chats and turn-scoped facts from the
 * current chat. Operational tool outputs are deliberately not reused here.
 */
export async function loadAutopilotContactMemory(input: {
  workspaceId: string;
  contactId: string;
  chatId: string;
  maxAgeDays?: number;
}): Promise<AutopilotContactMemory> {
  const maxAgeDays = Math.min(730, Math.max(1, input.maxAgeDays || 180));
  const result = await db.query<ContactMemoryRow>(
    `SELECT
        state.chat_id,
        state.metadata,
        state.updated_at,
        COALESCE(
          CASE
            WHEN state.metadata->>'slotMemoryUpdatedAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
              THEN (state.metadata->>'slotMemoryUpdatedAt')::timestamptz
          END,
          state.updated_at
        ) AS slot_memory_updated_at
       FROM autopilot_conversation_states state
       JOIN chats chat ON chat.id = state.chat_id
      WHERE state.workspace_id = $1
        AND chat.contact_id = $2
        AND COALESCE(
          CASE
            WHEN state.metadata->>'slotMemoryUpdatedAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
              THEN (state.metadata->>'slotMemoryUpdatedAt')::timestamptz
          END,
          state.updated_at
        )
          >= clock_timestamp() - ($4::int * INTERVAL '1 day')
      ORDER BY slot_memory_updated_at DESC
      LIMIT 24`,
    [input.workspaceId, input.contactId, input.chatId, maxAgeDays],
  );

  const stableSlots: AutopilotExtractedSlots = {};
  const stableSlotTimes = new Map<AutopilotSlotName, number>();
  let currentSlots: AutopilotExtractedSlots = {};
  let nativeState: Record<string, unknown> = {};
  let updatedAt: string | null = null;
  let latestSlotTime = Number.NEGATIVE_INFINITY;

  for (const row of result.rows) {
    const metadata = row.metadata && typeof row.metadata === 'object' ? row.metadata : {};
    const rowSlotTime = new Date(row.slot_memory_updated_at || row.updated_at).getTime();
    const stableSlotUpdatedAt = metadata.stableSlotUpdatedAt && typeof metadata.stableSlotUpdatedAt === 'object' && !Array.isArray(metadata.stableSlotUpdatedAt)
      ? metadata.stableSlotUpdatedAt as Record<string, unknown>
      : {};
    const stable = sanitizeSlotRecord(metadata.stableSlots, STABLE_CONTACT_SLOT_NAMES);
    for (const [key, value] of Object.entries(stable)) {
      const slotName = key as AutopilotSlotName;
      const fieldTimestamp = new Date(String(stableSlotUpdatedAt[key] || row.slot_memory_updated_at || row.updated_at)).getTime();
      const comparableTimestamp = Number.isFinite(fieldTimestamp) ? fieldTimestamp : rowSlotTime;
      if (value && comparableTimestamp > (stableSlotTimes.get(slotName) ?? Number.NEGATIVE_INFINITY)) {
        stableSlots[slotName] = value;
        stableSlotTimes.set(slotName, comparableTimestamp);
      }
    }
    if (row.chat_id === input.chatId) {
      currentSlots = sanitizeSlotRecord(metadata.conversationSlots);
      for (const stableName of STABLE_CONTACT_SLOT_NAMES) {
        const currentValue = currentSlots[stableName];
        if (currentValue && rowSlotTime >= (stableSlotTimes.get(stableName) ?? Number.NEGATIVE_INFINITY)) {
          stableSlots[stableName] = currentValue;
          stableSlotTimes.set(stableName, rowSlotTime);
        }
        delete currentSlots[stableName];
      }
      nativeState = metadata.nativeState && typeof metadata.nativeState === 'object' && !Array.isArray(metadata.nativeState)
        ? metadata.nativeState as Record<string, unknown>
        : {};
    }
    if (Number.isFinite(rowSlotTime) && rowSlotTime > latestSlotTime) latestSlotTime = rowSlotTime;
  }

  if (Number.isFinite(latestSlotTime)) updatedAt = new Date(latestSlotTime).toISOString();

  return {
    slots: { ...stableSlots, ...currentSlots },
    nativeState,
    updatedAt,
  };
}

export async function saveAutopilotSlotMemory(input: {
  chatId: string;
  workspaceId: string;
  autopilotConfigId?: string | null;
  slots: AutopilotExtractedSlots;
}) {
  const conversationSlots = sanitizeSlotRecord(input.slots);
  const stableSlots = sanitizeSlotRecord(input.slots, STABLE_CONTACT_SLOT_NAMES);
  if (Object.keys(conversationSlots).length === 0) return;
  const persistedAt = new Date().toISOString();
  const stableSlotUpdatedAt = Object.fromEntries(
    Object.keys(stableSlots).map((key) => [key, persistedAt]),
  );

  await db.query(
    `INSERT INTO autopilot_conversation_states (
       chat_id, workspace_id, autopilot_config_id, metadata, updated_at
     ) VALUES (
       $1, $2, $3,
       jsonb_build_object(
         'conversationSlots', $4::jsonb,
         'stableSlots', $5::jsonb,
         'stableSlotUpdatedAt', $6::jsonb,
         'slotMemoryUpdatedAt', to_jsonb(clock_timestamp())
       ),
       clock_timestamp()
     )
     ON CONFLICT (chat_id) DO UPDATE SET
       workspace_id = EXCLUDED.workspace_id,
       autopilot_config_id = COALESCE(EXCLUDED.autopilot_config_id, autopilot_conversation_states.autopilot_config_id),
       metadata = COALESCE(autopilot_conversation_states.metadata, '{}'::jsonb)
         || jsonb_build_object(
           'conversationSlots', COALESCE(autopilot_conversation_states.metadata->'conversationSlots', '{}'::jsonb) || $4::jsonb,
           'stableSlots', COALESCE(autopilot_conversation_states.metadata->'stableSlots', '{}'::jsonb) || $5::jsonb,
           'stableSlotUpdatedAt', COALESCE(autopilot_conversation_states.metadata->'stableSlotUpdatedAt', '{}'::jsonb) || $6::jsonb,
           'slotMemoryUpdatedAt', to_jsonb(clock_timestamp())
         ),
       updated_at = clock_timestamp()`,
    [
      input.chatId,
      input.workspaceId,
      input.autopilotConfigId ?? null,
      JSON.stringify(conversationSlots),
      JSON.stringify(stableSlots),
      JSON.stringify(stableSlotUpdatedAt),
    ],
  );
}

export async function saveAutopilotNativeState(input: {
  chatId: string;
  workspaceId: string;
  autopilotConfigId?: string | null;
  state: Record<string, unknown>;
}) {
  const serialized = JSON.stringify(input.state || {});
  if (serialized.length > 64_000) throw new Error('Native workflow state exceeded 64KB.');
  await db.query(
    `INSERT INTO autopilot_conversation_states (
       chat_id, workspace_id, autopilot_config_id, metadata, updated_at
     ) VALUES ($1, $2, $3, jsonb_build_object('nativeState', $4::jsonb), clock_timestamp())
     ON CONFLICT (chat_id) DO UPDATE SET
       workspace_id = EXCLUDED.workspace_id,
       autopilot_config_id = COALESCE(EXCLUDED.autopilot_config_id, autopilot_conversation_states.autopilot_config_id),
       metadata = jsonb_set(
         COALESCE(autopilot_conversation_states.metadata, '{}'::jsonb),
         '{nativeState}',
         COALESCE(autopilot_conversation_states.metadata->'nativeState', '{}'::jsonb) || $4::jsonb,
         true
       ),
       updated_at = clock_timestamp()`,
    [input.chatId, input.workspaceId, input.autopilotConfigId ?? null, serialized],
  );
}

/**
 * Atomically claims a collection checkpoint before a close side effect. The
 * fingerprint binds the claim to the exact needs_input turn that created it.
 */
export async function claimAutopilotCollectionCompletion(input: {
  chatId: string;
  workspaceId: string;
  checkpointFingerprint: string;
  completionExecutionId: string;
}): Promise<boolean> {
  const claimTtlMs = Math.max(
    30_000,
    Math.min(30 * 60_000, Number(process.env.AUTOPILOT_COLLECTION_CLOSE_CLAIM_TTL_MS || 300_000) || 300_000),
  );
  const claimedAt = new Date().toISOString();
  const staleBefore = new Date(Date.now() - claimTtlMs).toISOString();
  const result = await db.query(
    `UPDATE autopilot_conversation_states
        SET metadata = jsonb_set(
              jsonb_set(
                jsonb_set(
                  COALESCE(metadata, '{}'::jsonb),
                  '{nativeState,collectionCompletionV1,status}',
                  to_jsonb('closing'::text),
                  false
                ),
                '{nativeState,collectionCompletionV1,closingExecutionId}',
                to_jsonb($4::text),
                true
              ),
              '{nativeState,collectionCompletionV1,closingClaimedAt}',
              to_jsonb($5::text),
              true
            ),
            updated_at = clock_timestamp()
      WHERE chat_id = $1
        AND workspace_id = $2
        AND metadata #>> '{nativeState,collectionCompletionV1,checkpointFingerprint}' = $3
        AND (
          metadata #>> '{nativeState,collectionCompletionV1,status}' = 'awaiting_fields'
          OR (
            metadata #>> '{nativeState,collectionCompletionV1,status}' = 'closing'
            AND COALESCE(metadata #>> '{nativeState,collectionCompletionV1,closingClaimedAt}', '') < $6
          )
        )
      RETURNING chat_id`,
    [
      input.chatId,
      input.workspaceId,
      input.checkpointFingerprint,
      input.completionExecutionId,
      claimedAt,
      staleBefore,
    ],
  );
  return Boolean(result.rows[0]);
}

export async function clearAutopilotCollectionCompletion(input: {
  chatId: string;
  workspaceId: string;
  checkpointFingerprint?: string | null;
}): Promise<boolean> {
  const result = await db.query(
    `UPDATE autopilot_conversation_states
        SET metadata = jsonb_set(
              COALESCE(metadata, '{}'::jsonb),
              '{nativeState}',
              COALESCE(metadata->'nativeState', '{}'::jsonb) - 'collectionCompletionV1',
              true
            ),
            updated_at = clock_timestamp()
      WHERE chat_id = $1
        AND workspace_id = $2
        AND (
          $3::text IS NULL
          OR metadata #>> '{nativeState,collectionCompletionV1,checkpointFingerprint}' = $3
        )
      RETURNING chat_id`,
    [input.chatId, input.workspaceId, input.checkpointFingerprint ?? null],
  );
  return Boolean(result.rows[0]);
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
