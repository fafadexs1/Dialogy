import 'server-only';
import { db } from '@/lib/db';
import type { StudioSession } from './engine';
import type { StudioReasoningState } from './reasoning-contract';

export type StudioResults = {
  periodDays: number;
  sessions: Array<{ status: string; count: number }>;
  averageResolutionSeconds: number | null;
  procedures: Array<{ id: string; name: string; selected: number; completed: number; failed: number; collectionFailures: number; integrationFailures: number }>;
  recent: Array<{ id: string; status: string; startedAt: string; updatedAt: string; releaseId: string; summary: { uncertainOperations?: Array<{ id: string; capabilityId: string; title?: string; at: string }>; events: StudioSession['events']; lastTurnMetrics?: StudioReasoningState['lastTurnMetrics']; usageTotals?: StudioReasoningState['usageTotals']; outcomeUnknown?: boolean; outcomeReview?: { resolution: string; reviewedAt: string } } }>;
};

/** One snapshot supplies all metrics; the denominator is sessions started in this period. */
export async function readStudioResults(workspaceId: string, agentId: string, periodDays: number): Promise<StudioResults> {
  if (!Number.isInteger(periodDays) || periodDays < 1 || periodDays > 90) throw new Error('Selecione um período entre 1 e 90 dias.');
  const result = await db.query(`WITH sessions AS MATERIALIZED (
    SELECT * FROM agent_studio_sessions WHERE workspace_id = $1 AND agent_id = $2
      AND started_at >= NOW() - make_interval(days => $3::int)
  ), status_counts AS (
    SELECT status, count(*)::int AS count FROM sessions GROUP BY status
  ), procedures AS (
    SELECT p->>'id' AS id, p->>'name' AS name,
      SUM((p->>'selected')::int)::int AS selected, SUM((p->>'completed')::int)::int AS completed,
      SUM((p->>'failed')::int)::int AS failed, SUM((p->>'collectionFailures')::int)::int AS "collectionFailures",
      SUM((p->>'integrationFailures')::int)::int AS "integrationFailures"
    FROM sessions CROSS JOIN LATERAL jsonb_array_elements(COALESCE(summary->'procedureStats', '[]'::jsonb)) p
    GROUP BY p->>'id', p->>'name'
  ), recent AS (
    SELECT id, status, started_at AS "startedAt", updated_at AS "updatedAt", release_id AS "releaseId", summary - 'recoveryCheckpoint' AS summary
    FROM sessions ORDER BY updated_at DESC LIMIT 20
  ) SELECT
    COALESCE((SELECT jsonb_agg(s) FROM status_counts s), '[]'::jsonb) AS sessions,
    (SELECT AVG(EXTRACT(EPOCH FROM completed_at - started_at))::float8 FROM sessions WHERE status = 'resolved') AS "averageResolutionSeconds",
    COALESCE((SELECT jsonb_agg(p ORDER BY p.selected DESC) FROM procedures p), '[]'::jsonb) AS procedures,
    COALESCE((SELECT jsonb_agg(r ORDER BY r."updatedAt" DESC) FROM recent r), '[]'::jsonb) AS recent`, [workspaceId, agentId, periodDays]);
  return { periodDays, ...result.rows[0] };
}
