import { db } from '@/lib/db';
import {
  describeCopilotSuggestionStage,
  type CopilotSuggestion,
  type CopilotSuggestionInsights,
  type CopilotSuggestionStage,
  type CopilotSuggestionStatus,
  type CopilotToolTrace,
} from '@/lib/copilot-suggestion-types';

/**
 * Copilot suggestions: the reply the autopilot orchestrator proposes for a chat
 * that is still owned by a human agent.
 *
 * The same orchestrator that drives an Intelligent Attendant produces these, so a
 * suggestion carries the full reasoning trail (intent, knowledge sources, tools it
 * consulted, validator verdict). The inbox renders that trail instead of a bare
 * blob of text, and the operator accepts, edits or dismisses it.
 */

export type {
  CopilotSuggestion,
  CopilotSuggestionInsights,
  CopilotSuggestionStage,
  CopilotSuggestionStatus,
  CopilotToolTrace,
};

type SuggestionRow = {
  id: string;
  chat_id: string;
  workspace_id: string;
  autopilot_config_id: string | null;
  system_agent_id: string | null;
  source_message_id: string | null;
  orchestrator_run_id: string | null;
  stage: string;
  suggestion: string;
  message_blocks: unknown;
  insights: unknown;
  status: string;
  created_at: string | Date;
};

function parseJsonArray(value: unknown): string[] {
  const parsed = typeof value === 'string' ? safeJsonParse(value) : value;
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0);
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function parseInsights(value: unknown): CopilotSuggestionInsights {
  const parsed = typeof value === 'string' ? safeJsonParse(value) : value;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  return parsed as CopilotSuggestionInsights;
}

function mapRow(row: SuggestionRow, agentName: string): CopilotSuggestion {
  const insights = parseInsights(row.insights);
  return {
    id: row.id,
    chatId: row.chat_id,
    workspaceId: row.workspace_id,
    autopilotConfigId: row.autopilot_config_id,
    systemAgentId: row.system_agent_id,
    sourceMessageId: row.source_message_id,
    orchestratorRunId: row.orchestrator_run_id,
    stage: (row.stage as CopilotSuggestionStage) || 'model_response',
    agentName,
    suggestion: row.suggestion,
    messageBlocks: parseJsonArray(row.message_blocks),
    insights,
    status: (row.status as CopilotSuggestionStatus) || 'pending',
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  };
}

/**
 * Blocks are what the customer would actually receive: one WhatsApp bubble each.
 * Falling back to the whole response keeps the preview honest when the model did
 * not split anything.
 */
function normalizeBlocks(response: string, blocks?: string[] | null): string[] {
  const normalized = (blocks || [])
    .map((block) => (typeof block === 'string' ? block.trim() : ''))
    .filter((block) => block.length > 0);
  if (normalized.length > 0) return normalized;
  return response.trim() ? [response.trim()] : [];
}

function compactInsights(insights: CopilotSuggestionInsights): CopilotSuggestionInsights {
  const entries = Object.entries(insights).filter(([, value]) => {
    if (value === null || value === undefined) return false;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === 'string') return value.trim().length > 0;
    return true;
  });
  return Object.fromEntries(entries) as CopilotSuggestionInsights;
}

export type PublishCopilotSuggestionInput = {
  workspaceId: string;
  chatId: string;
  autopilotConfigId: string | null;
  autopilotConfigName?: string | null;
  systemAgentId?: string | null;
  sourceMessageId?: string | null;
  orchestratorRunId?: string | null;
  stage: CopilotSuggestionStage;
  suggestion: string;
  messageBlocks?: string[] | null;
  insights?: CopilotSuggestionInsights;
  assertCurrent?: () => Promise<void>;
};

/**
 * Persists the suggestion (so it survives a reload and feeds acceptance metrics)
 * and pushes it to every operator watching the chat.
 *
 * Persistence is best effort: if the table is missing on an environment that has
 * not run the migration yet, the realtime payload still reaches the inbox.
 */
export async function publishCopilotSuggestion(
  input: PublishCopilotSuggestionInput,
): Promise<CopilotSuggestion | null> {
  const suggestion = (input.suggestion || '').trim();
  if (!suggestion) return null;
  await input.assertCurrent?.();

  const blocks = normalizeBlocks(suggestion, input.messageBlocks);
  const insights = compactInsights(input.insights || {});
  const agentName = input.autopilotConfigName?.trim() || 'IA';

  let stored: CopilotSuggestion | null = null;
  try {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      // A new turn invalidates whatever was still on the operator's screen.
      await client.query(
        `UPDATE public.autopilot_chat_suggestions
            SET status = 'superseded',
                resolved_at = NOW()
          WHERE chat_id = $1
            AND status = 'pending'`,
        [input.chatId],
      );
      const { rows } = await client.query<SuggestionRow>(
        `INSERT INTO public.autopilot_chat_suggestions (
            workspace_id, chat_id, autopilot_config_id, system_agent_id,
            source_message_id, orchestrator_run_id, stage, suggestion,
            message_blocks, insights, status
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, 'pending')
         RETURNING id, chat_id, workspace_id, autopilot_config_id, system_agent_id,
                   source_message_id, orchestrator_run_id, stage, suggestion,
                   message_blocks, insights, status, created_at`,
        [
          input.workspaceId,
          input.chatId,
          input.autopilotConfigId,
          input.systemAgentId ?? null,
          input.sourceMessageId ?? null,
          input.orchestratorRunId ?? null,
          input.stage,
          suggestion,
          JSON.stringify(blocks),
          JSON.stringify(insights),
        ],
      );
      await client.query('COMMIT');
      stored = rows[0] ? mapRow(rows[0], agentName) : null;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.warn('[COPILOT_SUGGESTION] Failed to persist suggestion:', error);
  }

  await input.assertCurrent?.();
  await broadcastCopilotSuggestion({
    chatId: input.chatId,
    agentName,
    suggestion,
    blocks,
    insights,
    stage: input.stage,
    stored,
    sourceMessageId: input.sourceMessageId ?? null,
  });

  return stored;
}

async function broadcastCopilotSuggestion(input: {
  chatId: string;
  agentName: string;
  suggestion: string;
  blocks: string[];
  insights: CopilotSuggestionInsights;
  stage: CopilotSuggestionStage;
  stored: CopilotSuggestion | null;
  sourceMessageId: string | null;
}): Promise<void> {
  try {
    const { broadcastRealtimeEvent } = await import('@/lib/realtime/broadcast');
    await broadcastRealtimeEvent(`chat:${input.chatId}`, 'ai_suggestion', {
      // Legacy fields kept so older clients keep working during a rollout.
      suggestion: input.suggestion,
      chatId: input.chatId,
      configName: input.agentName,
      // Rich payload consumed by the copilot card.
      id: input.stored?.id ?? null,
      agentName: input.agentName,
      messageBlocks: input.blocks,
      insights: input.insights,
      stage: input.stage,
      stageLabel: describeCopilotSuggestionStage(input.stage),
      sourceMessageId: input.sourceMessageId,
      createdAt: input.stored?.createdAt ?? new Date().toISOString(),
    });
  } catch (error) {
    console.error('[COPILOT_SUGGESTION] Failed to broadcast suggestion:', error);
  }
}

export async function getPendingCopilotSuggestionForChat(input: {
  chatId: string;
  workspaceId: string;
}): Promise<CopilotSuggestion | null> {
  try {
    const { rows } = await db.query<SuggestionRow & { agent_name: string | null }>(
      `SELECT s.id, s.chat_id, s.workspace_id, s.autopilot_config_id, s.system_agent_id,
              s.source_message_id, s.orchestrator_run_id, s.stage, s.suggestion,
              s.message_blocks, s.insights, s.status, s.created_at,
              COALESCE(sa.name, ac.name) AS agent_name
         FROM public.autopilot_chat_suggestions s
         JOIN public.chats c ON c.id = s.chat_id AND c.workspace_id = s.workspace_id
         LEFT JOIN public.autopilot_configs ac ON ac.id = s.autopilot_config_id
         LEFT JOIN public.system_agents sa ON sa.id = s.system_agent_id
        WHERE s.chat_id = $1
          AND s.workspace_id = $2
          AND s.status = 'pending'
          AND c.copilot_mode = 'suggest' AND c.is_autopilot_active = TRUE AND c.status <> 'encerrados'
          AND c.autopilot_config_id = s.autopilot_config_id AND c.assigned_system_agent_id IS NULL
          AND (s.insights->>'contextMessageId' IS NULL OR s.insights->>'contextMessageId' = (
            SELECT m.id::text FROM messages m WHERE m.chat_id = c.id AND m.workspace_id = c.workspace_id
              AND COALESCE(m.type, '') <> 'system'
              AND COALESCE(m.metadata->>'isInternalNote', 'false') <> 'true'
              AND LOWER(COALESCE(m.api_message_status, '')) NOT IN ('internal', 'failed', 'error')
            ORDER BY m.created_at DESC, m.id DESC LIMIT 1))
        ORDER BY s.created_at DESC
        LIMIT 1`,
      [input.chatId, input.workspaceId],
    );
    const row = rows[0];
    if (!row) return null;
    return mapRow(row, row.agent_name?.trim() || 'IA');
  } catch (error) {
    console.warn('[COPILOT_SUGGESTION] Failed to load pending suggestion:', error);
    return null;
  }
}

export async function resolveCopilotSuggestion(input: {
  chatId: string;
  workspaceId: string;
  status: Exclude<CopilotSuggestionStatus, 'pending' | 'superseded'>;
  suggestionId?: string | null;
  userId?: string | null;
}): Promise<void> {
  try {
    await db.query(
      `UPDATE public.autopilot_chat_suggestions
          SET status = $3,
              resolved_at = NOW(),
              resolved_by_user_id = $4
        WHERE chat_id = $1
          AND workspace_id = $2
          AND status = 'pending'
          AND ($5::uuid IS NULL OR id = $5::uuid)`,
      [input.chatId, input.workspaceId, input.status, input.userId ?? null, input.suggestionId ?? null],
    );
  } catch (error) {
    console.warn('[COPILOT_SUGGESTION] Failed to resolve suggestion:', error);
  }
}

/**
 * Called when the AI stops assisting a chat (toggle off, transfer, close), so a
 * stale card never lingers on the operator's screen.
 */
export async function discardPendingCopilotSuggestions(chatId: string): Promise<void> {
  try {
    await db.query(
      `UPDATE public.autopilot_chat_suggestions
          SET status = 'superseded',
              resolved_at = NOW()
        WHERE chat_id = $1
          AND status = 'pending'`,
      [chatId],
    );
  } catch (error) {
    console.warn('[COPILOT_SUGGESTION] Failed to discard pending suggestions:', error);
  }
  try {
    const { broadcastRealtimeEvent } = await import('@/lib/realtime/broadcast');
    await broadcastRealtimeEvent(`chat:${chatId}`, 'ai_suggestion_cleared', { chatId });
  } catch (error) {
    console.warn('[COPILOT_SUGGESTION] Failed to broadcast suggestion clear:', error);
  }
}
