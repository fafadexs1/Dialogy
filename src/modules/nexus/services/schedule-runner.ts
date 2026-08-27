import { db } from '@/lib/db';
import { WorkflowDefinitionSchema, cronMatchesDate, hashValue, minuteFloor } from '@/services/workflow-runtime';
import { loadPublishedNexusWorkflow, startPublishedNexusWorkflow } from './runtime';

let interval: ReturnType<typeof setInterval> | null = null;
let running = false;

export type NexusScheduleDrainSummary = {
  claimed: number;
  completed: number;
  failed: number;
  skipped: boolean;
};

type NexusScheduleRunnerStatus = {
  enabled: boolean;
  active: boolean;
  running: boolean;
  startedAt: string | null;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastError: string | null;
  lastDrain: NexusScheduleDrainSummary | null;
};

const runnerStatus: NexusScheduleRunnerStatus = {
  enabled: process.env.NEXUS_SCHEDULE_ENABLED !== 'false',
  active: false,
  running: false,
  startedAt: null,
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastFailureAt: null,
  lastError: null,
  lastDrain: null,
};

function parseJson(value: unknown) {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return value; }
}

export async function drainNexusSchedules(now = new Date()) {
  if (running) return { claimed: 0, completed: 0, failed: 0, skipped: true };
  running = true;
  runnerStatus.running = true;
  runnerStatus.lastAttemptAt = new Date().toISOString();
  const summary: NexusScheduleDrainSummary = { claimed: 0, completed: 0, failed: 0, skipped: false };
  try {
    const candidates = await db.query(
      `SELECT nw.id, nw.workspace_id, nw.published_at, wd.definition,
              (SELECT MAX(nsr.scheduled_for) FROM public.nexus_schedule_runs nsr WHERE nsr.workflow_id = nw.id) AS last_scheduled_for
       FROM public.nexus_workflows nw
       JOIN public.workflow_definitions wd
         ON wd.workflow_id = nw.published_workflow_id
        AND wd.workflow_version = nw.published_workflow_version
       WHERE nw.status = 'published'
         AND wd.definition @> '{"nodes":[{"type":"trigger.schedule"}]}'::jsonb
       ORDER BY nw.updated_at
       LIMIT 200`,
    );
    const currentMinute = minuteFloor(now);
    const catchUpMinutes = Math.max(1, Math.min(10_080, Number(process.env.NEXUS_SCHEDULE_CATCHUP_MINUTES || 1_440)));
    for (const row of candidates.rows as Array<Record<string, unknown>>) {
      const definition = WorkflowDefinitionSchema.parse(parseJson(row.definition));
      const trigger = definition.nodes.find((node) => node.type === 'trigger.schedule');
      if (!trigger) continue;
      const cron = String(trigger.config.cron || '').trim();
      const timezone = String(trigger.config.timezone || 'UTC');
      const publishedAt = minuteFloor(new Date(String(row.published_at || now)));
      const lastRun = row.last_scheduled_for ? minuteFloor(new Date(String(row.last_scheduled_for))) : null;
      const lowerBound = new Date(currentMinute.getTime() - catchUpMinutes * 60_000);
      const startAt = new Date(Math.max(
        publishedAt.getTime(),
        lowerBound.getTime(),
        lastRun ? lastRun.getTime() + 60_000 : Number.NEGATIVE_INFINITY,
      ));
      for (let scheduledFor = startAt; scheduledFor <= currentMinute; scheduledFor = new Date(scheduledFor.getTime() + 60_000)) {
        if (!cronMatchesDate(cron, scheduledFor, timezone)) continue;
        const claim = await db.query(
          `INSERT INTO public.nexus_schedule_runs (workflow_id, scheduled_for)
           VALUES ($1, $2)
           ON CONFLICT (workflow_id, scheduled_for) DO NOTHING
           RETURNING workflow_id`,
          [String(row.id), scheduledFor.toISOString()],
        );
        if (!claim.rows[0]) continue;
        summary.claimed += 1;
        try {
          const published = await loadPublishedNexusWorkflow({ nexusWorkflowId: String(row.id), workspaceId: String(row.workspace_id) });
          if (!published) throw new Error('A versão publicada não foi encontrada.');
          const executionId = `nexus_schedule_${hashValue({ workflowId: row.id, scheduledFor: scheduledFor.toISOString() })}`;
          const result = await startPublishedNexusWorkflow({
            published,
            triggerType: 'trigger.schedule',
            payload: { scheduledFor: scheduledFor.toISOString(), timezone, cron },
            context: { source: 'schedule', scheduledFor: scheduledFor.toISOString() },
            executionId,
            workerId: `nexus_schedule_${row.id}`,
          });
          const failed = result.execution.status === 'failed';
          await db.query(
            `UPDATE public.nexus_schedule_runs
             SET execution_id = $3, status = $4, finished_at = timezone('utc', now()), error = $5
             WHERE workflow_id = $1 AND scheduled_for = $2`,
            [String(row.id), scheduledFor.toISOString(), executionId, failed ? 'failed' : 'completed', result.execution.failure?.message || null],
          );
          if (failed) summary.failed += 1;
          else summary.completed += 1;
        } catch (error) {
          summary.failed += 1;
          await db.query(
            `UPDATE public.nexus_schedule_runs
             SET status = 'failed', finished_at = timezone('utc', now()), error = $3
             WHERE workflow_id = $1 AND scheduled_for = $2`,
            [String(row.id), scheduledFor.toISOString(), error instanceof Error ? error.message.slice(0, 2_000) : 'Falha desconhecida.'],
          );
        }
      }
    }
    runnerStatus.lastDrain = summary;
    runnerStatus.lastSuccessAt = new Date().toISOString();
    runnerStatus.lastError = null;
    return summary;
  } catch (error) {
    runnerStatus.lastFailureAt = new Date().toISOString();
    runnerStatus.lastError = error instanceof Error ? error.message : 'Falha desconhecida.';
    throw error;
  } finally {
    running = false;
    runnerStatus.running = false;
  }
}

export function startNexusScheduleRunner() {
  runnerStatus.enabled = process.env.NEXUS_SCHEDULE_ENABLED !== 'false';
  if (interval || !runnerStatus.enabled) return;
  runnerStatus.active = true;
  runnerStatus.startedAt = new Date().toISOString();
  const pollMs = Math.max(10_000, Number(process.env.NEXUS_SCHEDULE_POLL_MS || 30_000));
  void drainNexusSchedules().catch((error) => console.error('[NEXUS_SCHEDULE] Initial drain failed:', error));
  interval = setInterval(() => {
    void drainNexusSchedules().catch((error) => console.error('[NEXUS_SCHEDULE] Drain failed:', error));
  }, pollMs);
  (interval as unknown as { unref?: () => void }).unref?.();
}

export function stopNexusScheduleRunner() {
  if (interval) clearInterval(interval);
  interval = null;
  runnerStatus.active = false;
}

export function getNexusScheduleRunnerStatus(): NexusScheduleRunnerStatus {
  return {
    ...runnerStatus,
    lastDrain: runnerStatus.lastDrain ? { ...runnerStatus.lastDrain } : null,
  };
}
