import 'server-only';

import { db } from '@/lib/db';
import { openStudioSession, sealStudioSession } from './session-store';

export type StudioOutcomeResolution = 'confirmed_succeeded' | 'confirmed_failed';

export function studioHistoryRetentionDays(value = process.env.AGENT_STUDIO_HISTORY_RETENTION_DAYS) {
  const parsed = Number.parseInt(value || '', 10);
  if (!Number.isInteger(parsed) || parsed < 7 || parsed > 3650) return 90;
  return parsed;
}

/** Intended for a controlled maintenance job. It never removes active or uncertain sessions. */
export async function purgeExpiredStudioOperationalData(days = studioHistoryRetentionDays()) {
  if (!Number.isInteger(days) || days < 7 || days > 3650) throw new Error('A retenção precisa estar entre 7 e 3650 dias.');
  const result = await db.query(`WITH expired AS (
      DELETE FROM agent_studio_sessions
       WHERE completed_at < NOW() - make_interval(days => $1::int)
         AND COALESCE((summary->>'outcomeUnknown')::boolean, false) = false
       RETURNING chat_id, agent_id
    ), cleaned AS (
      UPDATE autopilot_conversation_states state
         SET metadata = state.metadata - 'agent_studio', updated_at = NOW()
       WHERE state.metadata->'agent_studio'->>'status' IN ('resolved', 'transferred', 'failed', 'cancelled')
         AND COALESCE((state.metadata->'agent_studio'->>'outcomeUnknown')::boolean, false) = false
         AND (state.metadata->'agent_studio'->>'updatedAt')::timestamptz < NOW() - make_interval(days => $1::int)
         AND EXISTS (SELECT 1 FROM expired WHERE expired.chat_id = state.chat_id AND expired.agent_id::text = state.metadata->'agent_studio'->>'agentId')
       RETURNING state.chat_id
    ) SELECT (SELECT count(*)::int FROM expired) AS "deletedSessions", (SELECT count(*)::int FROM cleaned) AS "clearedStates"`, [days]);
  return { days, deletedSessions: Number(result.rows[0]?.deletedSessions || 0), clearedStates: Number(result.rows[0]?.clearedStates || 0) };
}

/** Human reconciliation clears the replay block but never resumes or repeats the external operation. */
export async function reviewStudioUncertainOutcome(input: { workspaceId: string; agentId: string; sessionId: string; userId: string; resolution: StudioOutcomeResolution }) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL statement_timeout = '10s'");
    const found = await client.query(`SELECT history.id, history.chat_id, history.release_id, history.summary,
        state.metadata->'agent_studio' AS studio
      FROM agent_studio_sessions history
      JOIN autopilot_conversation_states state ON state.chat_id = history.chat_id AND state.workspace_id = history.workspace_id
      WHERE history.id = $1 AND history.workspace_id = $2 AND history.agent_id = $3
      FOR UPDATE OF history, state`, [input.sessionId, input.workspaceId, input.agentId]);
    const row = found.rows[0];
    if (!row || row.summary?.outcomeUnknown !== true) throw new Error('Resultado incerto não encontrado ou já revisado.');
    const studio = row.studio;
    if (!studio?.encrypted || studio.agentId !== input.agentId || studio.releaseId !== String(row.release_id) || !studio.contextId) throw new Error('O estado criptografado desta operação não está disponível para revisão segura.');
    const scope = { workspaceId: input.workspaceId, agentId: input.agentId, chatId: String(row.chat_id), contextId: String(studio.contextId) };
    const state = openStudioSession(scope, String(studio.encrypted));
    if (state.id !== input.sessionId || !state.inFlight) throw new Error('A reserva da operação incerta não corresponde ao histórico selecionado.');
    const reviewedAt = new Date().toISOString();
    state.inFlight = null; state.confirmation = null; state.pendingField = null; state.phase = 'done'; state.status = 'failed';
    state.events = [...state.events, { stepId: 'operator_review', label: input.resolution === 'confirmed_succeeded' ? 'Equipe confirmou que a operação ocorreu' : 'Equipe confirmou que a operação não ocorreu', kind: 'outcome_reviewed', at: reviewedAt }].slice(-150);
    const metadata = { ...studio, revision: Number(studio.revision || 0) + 1, encrypted: sealStudioSession(scope, state), status: state.status,
      phase: state.phase, outcomeUnknown: false, events: state.events, updatedAt: reviewedAt };
    const summary = { ...row.summary, outcomeUnknown: false,
      events: state.events.map(({ stepId, label, kind, at }) => ({ stepId, label, kind, at })),
      outcomeReview: { resolution: input.resolution, reviewedAt, reviewedBy: input.userId } };
    const updated = await client.query(`UPDATE autopilot_conversation_states SET metadata = metadata - 'agent_studio' || jsonb_build_object('agent_studio', $4::jsonb), updated_at = NOW()
      WHERE chat_id = $1 AND workspace_id = $2 AND COALESCE((metadata->'agent_studio'->>'revision')::int, 0) = $3 RETURNING chat_id`,
      [row.chat_id, input.workspaceId, Number(studio.revision || 0), JSON.stringify(metadata)]);
    if (!updated.rows.length) throw new Error('A conversa mudou durante a revisão. Recarregue antes de confirmar.');
    await client.query(`UPDATE agent_studio_sessions SET status = 'failed', completed_at = COALESCE(completed_at, NOW()), summary = $4::jsonb, updated_at = NOW()
      WHERE id = $1 AND workspace_id = $2 AND agent_id = $3`, [input.sessionId, input.workspaceId, input.agentId, JSON.stringify(summary)]);
    await client.query('COMMIT');
    return { reviewedAt, resolution: input.resolution };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally { client.release(); }
}
