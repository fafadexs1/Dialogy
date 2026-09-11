import 'server-only';

import { db } from '@/lib/db';
import { decryptWithKey, encryptWithKey } from '@/lib/security/secret-box';
import { StudioSessionSchema, studioHasUncertainOperation, type StudioSession } from './engine';
import type { StudioMemoryEvent } from './durable-memory';
import { sealStudioMemoryEvent } from './durable-memory-store';

type Scope = { workspaceId: string; agentId: string; chatId: string; contextId?: string };
const keyName = 'WORKSPACE_CREDENTIALS_ENCRYPTION_KEY';
const secret = () => process.env.WORKSPACE_CREDENTIALS_ENCRYPTION_KEY || process.env.META_PAYLOAD_ENCRYPTION_KEY;
const MAX_SESSION_BYTES = 262_144;

export function sealStudioSession(scope: Scope, state: StudioSession) {
  if (state.agentId !== scope.agentId) throw new Error('Sessão fora do escopo do agente.');
  const payload = JSON.stringify({ ...scope, state });
  if (Buffer.byteLength(payload) > MAX_SESSION_BYTES) throw new Error('A sessão excedeu o limite seguro de dados.');
  return encryptWithKey(payload, secret(), keyName);
}

export function openStudioSession(scope: Scope, encrypted: string): StudioSession {
  if (encrypted.length > MAX_SESSION_BYTES * 3) throw new Error('Estado de sessão inválido.');
  const payload = JSON.parse(decryptWithKey(encrypted, secret(), keyName));
  if (payload.workspaceId !== scope.workspaceId || payload.chatId !== scope.chatId || payload.agentId !== scope.agentId || payload.contextId !== scope.contextId) {
    throw new Error('A sessão não pertence a esta conversa.');
  }
  const state = StudioSessionSchema.parse(payload.state);
  if (state.agentId !== scope.agentId) throw new Error('Sessão de outro agente.');
  return state;
}

/** Scoped CAS checkpoints preserve all other runtimes' metadata. No customer values enter the public summary. */
export async function studioSessionStore(scope: Scope) {
  const result = await db.query(
    `SELECT s.metadata->'agent_studio' AS studio
       FROM chats c LEFT JOIN autopilot_conversation_states s ON s.chat_id = c.id AND s.workspace_id = c.workspace_id
       WHERE c.id = $1 AND c.workspace_id = $2`, [scope.chatId, scope.workspaceId],
  );
  if (!result.rows[0]) throw new Error('Conversa não encontrada neste workspace.');
  const stored = result.rows[0].studio;
  let revision: number = Number(stored?.revision || 0);
  const replacingExecution = stored && (stored.contextId !== scope.contextId || stored.agentId !== scope.agentId);
  if (replacingExecution) {
    // Older public summaries only inspected inFlight. Inspect the authenticated
    // encrypted state before allowing replacement, without sharing it with the new agent.
    if (typeof stored.agentId !== 'string' || !stored.agentId
      || (stored.contextId !== undefined && typeof stored.contextId !== 'string')
      || typeof stored.encrypted !== 'string' || !stored.encrypted) {
      throw new Error('Não foi possível verificar a execução anterior desta conversa. Preserve-a para revisão.');
    }
    const prior = openStudioSession({ workspaceId: scope.workspaceId, chatId: scope.chatId,
      agentId: stored.agentId, ...(stored.contextId !== undefined ? { contextId: stored.contextId } : {}) }, stored.encrypted);
    if (stored.outcomeUnknown || studioHasUncertainOperation(prior)) throw new Error('Há uma operação com resultado incerto nesta conversa. A equipe precisa revisá-la antes de iniciar outro agente.');
    if (['running', 'waiting_input'].includes(prior.status)) throw new Error('Outra execução está usando o agente nesta conversa.');
  }
  const state = stored?.agentId === scope.agentId && stored?.contextId === scope.contextId && stored?.encrypted
    ? openStudioSession(scope, stored.encrypted) : null;
  const checkpoint = async (next: StudioSession, memoryEvents: StudioMemoryEvent[] = []) => {
    if (memoryEvents.length > 100) throw new Error('O checkpoint excedeu o limite de registros de memória.');
    const memory = memoryEvents.map((entry) => {
      if (entry.source.sessionId !== next.id || entry.source.releaseId !== next.releaseId) {
        throw new Error('A origem da memória não pertence à execução atual.');
      }
      return sealStudioMemoryEvent(scope, entry);
    });
    const encrypted = sealStudioSession(scope, next);
    const metadata = { agentId: scope.agentId, sessionId: next.id, contextId: scope.contextId, revision: revision + 1, encrypted,
      releaseId: next.releaseId, status: next.status, phase: next.phase, outcomeUnknown: studioHasUncertainOperation(next),
      events: next.events, updatedAt: new Date().toISOString() };
    const summary = {
      lastTurnMetrics: next.reasoning?.lastTurnMetrics,
      usageTotals: next.reasoning?.usageTotals,
      uncertainOperations: (next.reasoning?.operations || []).filter((operation) => operation.status === 'unknown')
        .map(({ id, capabilityId, title, at }) => ({ id, capabilityId, title, at })),
      // Server-only recovery snapshot; result projections must exclude this field.
      recoveryCheckpoint: { version: 1, contextId: scope.contextId, encrypted },
      operationRequestIds: [...new Set((next.reasoning?.operations || []).map((operation) =>
        operation.memoryRequestId || `${next.id}:${operation.requestId}`))],
      events: next.events.map(({ stepId, label, kind, at }) => ({ stepId, label, kind, at })),
      procedureStats: next.procedureStats || [], procedureId: next.procedureId,
      outcomeUnknown: studioHasUncertainOperation(next),
    };
    // The checkpoint and its historical summary commit together. A failed history write
    // cannot erase the pre-dispatch reservation or cause an operation to be replayed.
    const saved = await db.query(
      `WITH saved AS (
        INSERT INTO autopilot_conversation_states (chat_id, workspace_id, autopilot_config_id, metadata, updated_at)
        SELECT c.id, c.workspace_id, a.id, jsonb_build_object('agent_studio', $4::jsonb), NOW()
          FROM chats c JOIN autopilot_configs a ON a.workspace_id = c.workspace_id AND a.id = $3
          WHERE c.id = $1 AND c.workspace_id = $2
            AND ($5::int = 0 OR EXISTS (SELECT 1 FROM autopilot_conversation_states prior WHERE prior.chat_id = c.id AND prior.workspace_id = c.workspace_id))
        ON CONFLICT (chat_id) DO UPDATE SET
          autopilot_config_id = EXCLUDED.autopilot_config_id,
          metadata = COALESCE(autopilot_conversation_states.metadata, '{}'::jsonb) || jsonb_build_object('agent_studio', $4::jsonb),
          updated_at = NOW()
        WHERE autopilot_conversation_states.workspace_id = $2
          AND COALESCE((autopilot_conversation_states.metadata->'agent_studio'->>'revision')::int, 0) = $5
        RETURNING chat_id
      ), recorded AS (
        INSERT INTO agent_studio_sessions (id, workspace_id, agent_id, chat_id, release_id, status, completed_at, summary)
        SELECT $6::uuid, $2::uuid, $3::uuid, saved.chat_id, $7::uuid, $8,
          CASE WHEN $9::boolean THEN NOW() ELSE NULL END, $10::jsonb FROM saved
        ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, summary = EXCLUDED.summary, updated_at = NOW(),
          completed_at = CASE WHEN EXCLUDED.completed_at IS NULL THEN NULL
            ELSE COALESCE(agent_studio_sessions.completed_at, EXCLUDED.completed_at) END
        WHERE agent_studio_sessions.workspace_id = EXCLUDED.workspace_id
          AND agent_studio_sessions.agent_id = EXCLUDED.agent_id AND agent_studio_sessions.chat_id = EXCLUDED.chat_id
          AND agent_studio_sessions.release_id = EXCLUDED.release_id
        RETURNING id
      )${memory.length ? `, remembered AS (
        INSERT INTO agent_studio_memory_events (workspace_id, chat_id, agent_id, event_id, entity_key, encrypted)
        SELECT $2::uuid, saved.chat_id, $3::uuid, entry->>'eventId', entry->>'entityKey', entry->>'encrypted'
          FROM saved CROSS JOIN recorded CROSS JOIN jsonb_array_elements($11::jsonb) entry
        ON CONFLICT (workspace_id, chat_id, agent_id, event_id) DO NOTHING
        RETURNING sequence
      )` : ''} SELECT saved.chat_id FROM saved CROSS JOIN recorded`,
      [scope.chatId, scope.workspaceId, scope.agentId, JSON.stringify(metadata), revision, next.id, next.releaseId, next.status, next.phase === 'done', JSON.stringify(summary),
        ...(memory.length ? [JSON.stringify(memory)] : [])],
    );
    if (!saved.rows.length) throw new Error('A conversa foi atualizada por outra execução ou não pôde ser reservada. A operação não será repetida.');
    revision++;
  };
  return { state, checkpoint };
}

/** Historical evidence only. Callers must not treat this as the active session or consent. */
export async function readStudioRequestOperationHistory(scope: Omit<Scope, 'contextId'>, requestId: string, currentSessionId: string) {
  const originSessionId = requestId.split(':', 1)[0];
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(originSessionId)) {
    throw new Error('A origem do pedido não permite verificar suas operações anteriores.');
  }
  const result = await db.query(`SELECT history.id, history.release_id, history.summary->'recoveryCheckpoint' AS checkpoint
    FROM agent_studio_sessions history
    JOIN chats c ON c.id=history.chat_id AND c.workspace_id=history.workspace_id
    WHERE history.workspace_id=$1 AND history.agent_id=$2 AND history.chat_id=$3 AND history.id<>$4
      AND (history.summary->'operationRequestIds' ? $5
        OR history.id=$6::uuid
        OR (history.summary ? 'recoveryCheckpoint' AND NOT (history.summary ? 'operationRequestIds')))
    ORDER BY history.started_at DESC, history.id DESC LIMIT 101`,
  [scope.workspaceId, scope.agentId, scope.chatId, currentSessionId, requestId, originSessionId]);
  if (result.rows.length > 100) throw new Error('O histórico deste pedido exige revisão antes de outra alteração.');
  if (originSessionId !== currentSessionId && !result.rows.some((row) => String(row.id) === originSessionId)) {
    throw new Error('A sessão de origem deste pedido não está disponível para verificar ações anteriores.');
  }
  const records = [];
  for (const row of result.rows) {
    const archived = openArchivedStudioRow(scope, String(row.id), row);
    if (!archived) throw new Error('O registro de operações deste pedido está incompleto.');
    records.push({ releaseId: archived.releaseId, operations: (archived.reasoning?.operations || []).filter((operation) =>
      (operation.memoryRequestId || `${archived.id}:${operation.requestId}`) === requestId) });
  }
  return records;
}

/** Historical evidence only. Callers must not treat this as the active session or consent. */
export async function readArchivedStudioSession(scope: Omit<Scope, 'contextId'>, sessionId: string): Promise<StudioSession | null> {
  const result = await db.query(`SELECT history.release_id, history.summary->'recoveryCheckpoint' AS checkpoint
    FROM agent_studio_sessions history JOIN chats c ON c.id=history.chat_id AND c.workspace_id=history.workspace_id
    WHERE history.id=$1 AND history.workspace_id=$2 AND history.agent_id=$3 AND history.chat_id=$4`,
  [sessionId, scope.workspaceId, scope.agentId, scope.chatId]);
  return openArchivedStudioRow(scope, sessionId, result.rows[0]);
}

function openArchivedStudioRow(scope: Omit<Scope, 'contextId'>, sessionId: string,
  row: { release_id: unknown; checkpoint?: { version?: unknown; encrypted?: unknown; contextId?: unknown } } | undefined): StudioSession | null {
  if (!row?.checkpoint) return null;
  const checkpoint = row.checkpoint;
  if (checkpoint.version !== 1 || typeof checkpoint.encrypted !== 'string'
    || (checkpoint.contextId !== undefined && typeof checkpoint.contextId !== 'string')) {
    throw new Error('O registro histórico da sessão é inválido.');
  }
  const state = openStudioSession({ ...scope,
    ...(checkpoint.contextId !== undefined ? { contextId: checkpoint.contextId } : {}) }, checkpoint.encrypted);
  if (state.id !== sessionId || state.releaseId !== String(row.release_id)) throw new Error('A origem do registro histórico não corresponde à sessão.');
  return state;
}

/** Lifecycle cleanup only: never dispatch tools, erase uncertain outcomes, or take over another invocation. */
export async function stopStudioSession(scope: Scope, reason: 'cancelled' | 'expired' | 'failed') {
  const result = await db.query(`SELECT metadata->'agent_studio' AS studio FROM autopilot_conversation_states
    WHERE chat_id = $1 AND workspace_id = $2`, [scope.chatId, scope.workspaceId]);
  const current = result.rows[0]?.studio;
  if (!current || current.agentId !== scope.agentId || current.contextId !== scope.contextId) return;
  const store = await studioSessionStore(scope);
  if (!store.state || store.state.phase === 'done') return;
  const next = structuredClone(store.state);
  next.phase = 'done'; next.status = reason === 'cancelled' ? 'cancelled' : 'failed';
  next.pendingField = null; next.confirmation = null; delete next.topicChange;
  // inFlight remains available to an operator; cancellation does not prove that a write was undone.
  next.events = [...next.events, { stepId: 'session', label: reason === 'cancelled' ? 'Invocação cancelada pelo fluxo' : reason === 'expired' ? 'Prazo de resposta encerrado' : 'Invocação interrompida pelo fluxo', kind: reason, at: new Date().toISOString() }].slice(-150);
  await store.checkpoint(next);
}
