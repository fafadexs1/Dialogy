import 'server-only';

import { db } from '@/lib/db';
import { openStudioSession, sealStudioSession } from './session-store';
import { studioHasUncertainOperation } from './engine';

export type StudioOutcomeResolution = 'confirmed_succeeded' | 'confirmed_failed';

export function studioHistoryRetentionDays(value = process.env.AGENT_STUDIO_HISTORY_RETENTION_DAYS) {
  const parsed = Number.parseInt(value || '', 10);
  if (!Number.isInteger(parsed) || parsed < 7 || parsed > 3650) return 90;
  return parsed;
}

/** Never remove active/uncertain sessions or evidence backing durable conversation memory. */
export async function purgeExpiredStudioOperationalData(days = studioHistoryRetentionDays()) {
  if (!Number.isInteger(days) || days < 7 || days > 3650) throw new Error('A retenção precisa estar entre 7 e 3650 dias.');
  const result = await db.query(`WITH expired AS (
      DELETE FROM agent_studio_sessions
       WHERE completed_at < NOW() - make_interval(days => $1::int)
         AND status IN ('resolved', 'transferred', 'failed', 'cancelled')
         AND COALESCE((summary->>'outcomeUnknown')::boolean, false) = false
         AND NOT EXISTS (
           SELECT 1 FROM agent_studio_memory_events memory
            WHERE memory.workspace_id = agent_studio_sessions.workspace_id
              AND memory.chat_id = agent_studio_sessions.chat_id
              AND memory.agent_id = agent_studio_sessions.agent_id
         )
       RETURNING id, workspace_id, chat_id, agent_id
    ), cleaned AS (
      UPDATE autopilot_conversation_states state
         SET metadata = state.metadata - 'agent_studio', updated_at = NOW()
       WHERE state.metadata->'agent_studio'->>'status' IN ('resolved', 'transferred', 'failed', 'cancelled')
         AND COALESCE((state.metadata->'agent_studio'->>'outcomeUnknown')::boolean, false) = false
         AND (state.metadata->'agent_studio'->>'updatedAt')::timestamptz < NOW() - make_interval(days => $1::int)
         AND EXISTS (SELECT 1 FROM expired WHERE expired.chat_id = state.chat_id
           AND expired.workspace_id = state.workspace_id
           AND expired.agent_id::text = state.metadata->'agent_studio'->>'agentId'
           AND expired.id::text = state.metadata->'agent_studio'->>'sessionId')
       RETURNING state.chat_id
    ) SELECT (SELECT count(*)::int FROM expired) AS "deletedSessions", (SELECT count(*)::int FROM cleaned) AS "clearedStates"`, [days]);
  return { days, deletedSessions: Number(result.rows[0]?.deletedSessions || 0), clearedStates: Number(result.rows[0]?.clearedStates || 0) };
}

/** Human reconciliation clears the replay block but never resumes or repeats the external operation. */
export async function reviewStudioUncertainOutcome(input: { workspaceId: string; agentId: string; sessionId: string; userId: string; resolution: StudioOutcomeResolution; operationId?: string }) {
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
    if (!studio?.encrypted || studio.agentId !== input.agentId || studio.releaseId !== String(row.release_id)
      || (studio.contextId !== undefined && typeof studio.contextId !== 'string')) throw new Error('O estado criptografado desta operação não está disponível para revisão segura.');
    const scope = { workspaceId: input.workspaceId, agentId: input.agentId, chatId: String(row.chat_id),
      ...(studio.contextId !== undefined ? { contextId: studio.contextId as string } : {}) };
    const state = openStudioSession(scope, String(studio.encrypted));
    if (state.id !== input.sessionId || !studioHasUncertainOperation(state)) throw new Error('A reserva da operação incerta não corresponde ao histórico selecionado.');
    const uncertain = state.reasoning?.operations.filter((operation) => operation.status === 'unknown') || [];
    const reviewedOperation = input.operationId ? uncertain.find((operation) => operation.id === input.operationId)
      : uncertain.length === 1 ? uncertain[0] : undefined;
    if (input.operationId && !reviewedOperation) throw new Error('A operação selecionada não está pendente nesta sessão. Recarregue os resultados.');
    if (state.reasoning && !reviewedOperation) throw new Error('Não foi possível identificar uma única operação para esta revisão. As pendências foram preservadas.');
    const reviewedAt = new Date().toISOString();
    if (reviewedOperation) reviewedOperation.status = input.resolution === 'confirmed_succeeded' ? 'succeeded' : 'failed';
    state.inFlight = null; state.confirmation = null; state.pendingField = null; state.phase = 'done'; state.status = 'failed';
    const remaining = state.reasoning?.operations.find((operation) => operation.status === 'unknown');
    if (remaining) state.inFlight = { key: remaining.id, stepId: remaining.capabilityId };
    if (state.reasoning) state.reasoning.pendingAction = null;
    state.events = [...state.events, { stepId: 'operator_review', label: input.resolution === 'confirmed_succeeded' ? 'Equipe confirmou que a operação ocorreu' : 'Equipe confirmou que a operação não ocorreu', kind: 'outcome_reviewed', at: reviewedAt }].slice(-150);
    const metadata = { ...studio, sessionId: state.id, revision: Number(studio.revision || 0) + 1, encrypted: sealStudioSession(scope, state), status: state.status,
      phase: state.phase, outcomeUnknown: studioHasUncertainOperation(state), events: state.events, updatedAt: reviewedAt };
    const summary = { ...row.summary, outcomeUnknown: studioHasUncertainOperation(state),
      uncertainOperations: (state.reasoning?.operations || []).filter((operation) => operation.status === 'unknown')
        .map(({ id, capabilityId, title, at }) => ({ id, capabilityId, title, at })),
      recoveryCheckpoint: { version: 1, contextId: scope.contextId, encrypted: metadata.encrypted },
      events: state.events.map(({ stepId, label, kind, at }) => ({ stepId, label, kind, at })),
      outcomeReview: { resolution: input.resolution, reviewedAt, reviewedBy: input.userId, operationId: reviewedOperation?.id } };
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
