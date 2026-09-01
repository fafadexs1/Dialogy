import 'server-only';

import { db } from '@/lib/db';
import { decryptWithKey, encryptWithKey } from '@/lib/security/secret-box';
import { StudioSessionSchema, type StudioSession } from './engine';

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
  if (stored?.outcomeUnknown && (stored.contextId !== scope.contextId || stored.agentId !== scope.agentId)) throw new Error('Há uma operação com resultado incerto nesta conversa. A equipe precisa revisá-la antes de iniciar outro agente.');
  if (stored && (stored.contextId !== scope.contextId || stored.agentId !== scope.agentId) && ['running', 'waiting_input'].includes(stored.status)) throw new Error('Outra execução está usando o agente nesta conversa.');
  const state = stored?.agentId === scope.agentId && stored?.contextId === scope.contextId && stored?.encrypted
    ? openStudioSession(scope, stored.encrypted) : null;
  const checkpoint = async (next: StudioSession) => {
    const encrypted = sealStudioSession(scope, next);
    const metadata = { agentId: scope.agentId, contextId: scope.contextId, revision: revision + 1, encrypted,
      releaseId: next.releaseId, status: next.status, phase: next.phase, outcomeUnknown: Boolean(next.inFlight),
      events: next.events, updatedAt: new Date().toISOString() };
    const summary = {
      events: next.events.map(({ stepId, label, kind, at }) => ({ stepId, label, kind, at })),
      procedureStats: next.procedureStats || [], procedureId: next.procedureId,
      outcomeUnknown: Boolean(next.inFlight),
    };
    // The checkpoint and its historical summary commit together. A failed history write
    // cannot erase the pre-dispatch reservation or cause an operation to be replayed.
    const saved = await db.query(
      `WITH saved AS (
        INSERT INTO autopilot_conversation_states (chat_id, workspace_id, config_id, metadata, updated_at)
        SELECT c.id, c.workspace_id, a.id, jsonb_build_object('agent_studio', $4::jsonb), NOW()
          FROM chats c JOIN autopilot_configs a ON a.workspace_id = c.workspace_id AND a.id = $3
          WHERE c.id = $1 AND c.workspace_id = $2
            AND ($5::int = 0 OR EXISTS (SELECT 1 FROM autopilot_conversation_states prior WHERE prior.chat_id = c.id AND prior.workspace_id = c.workspace_id))
        ON CONFLICT (chat_id) DO UPDATE SET
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
          completed_at = COALESCE(agent_studio_sessions.completed_at, EXCLUDED.completed_at)
        WHERE agent_studio_sessions.workspace_id = EXCLUDED.workspace_id
          AND agent_studio_sessions.agent_id = EXCLUDED.agent_id AND agent_studio_sessions.chat_id = EXCLUDED.chat_id
          AND agent_studio_sessions.release_id = EXCLUDED.release_id
        RETURNING id
      ) SELECT saved.chat_id FROM saved CROSS JOIN recorded`,
      [scope.chatId, scope.workspaceId, scope.agentId, JSON.stringify(metadata), revision, next.id, next.releaseId, next.status, next.phase === 'done', JSON.stringify(summary)],
    );
    if (!saved.rows.length) throw new Error('A conversa foi atualizada por outra execução ou não pôde ser reservada. A operação não será repetida.');
    revision++;
  };
  return { state, checkpoint };
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
