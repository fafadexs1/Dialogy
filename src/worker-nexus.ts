import { createServer } from 'node:http';

type DatabaseModule = typeof import('@/lib/db');
type ScheduleModule = typeof import('@/modules/nexus/services/schedule-runner');

type NexusMonitorCounts = {
  workflows: number;
  publishedWorkflows: number;
  executions24h: number;
  failedExecutions24h: number;
  stuckExecutions: number;
  failedSchedules24h: number;
};

type NexusMonitorSnapshot = {
  checkedAt: string | null;
  databaseOk: boolean;
  schemaOk: boolean;
  tables: Record<string, boolean>;
  counts: NexusMonitorCounts;
  error: string | null;
};

const startedAt = new Date().toISOString();
const emptyCounts: NexusMonitorCounts = {
  workflows: 0,
  publishedWorkflows: 0,
  executions24h: 0,
  failedExecutions24h: 0,
  stuckExecutions: 0,
  failedSchedules24h: 0,
};

let snapshot: NexusMonitorSnapshot = {
  checkedAt: null,
  databaseOk: false,
  schemaOk: false,
  tables: {},
  counts: { ...emptyCounts },
  error: null,
};

function positiveInteger(value: string | undefined, fallback: number, maximum: number) {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

function numeric(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function loadEnvironment() {
  if (process.env.NODE_ENV === 'production') return;
  try {
    await import('dotenv/config');
  } catch {
    console.warn('[NEXUS_WORKER] dotenv/config indisponível; usando apenas as variáveis do processo.');
  }
}

async function refreshSnapshot(dbModule: DatabaseModule) {
  const checkedAt = new Date().toISOString();
  try {
    const schemaResult = await dbModule.db.query(
      `SELECT
         to_regclass('public.nexus_workflows') IS NOT NULL AS nexus_workflows,
         to_regclass('public.nexus_credentials') IS NOT NULL AS nexus_credentials,
         to_regclass('public.nexus_schedule_runs') IS NOT NULL AS nexus_schedule_runs,
         to_regclass('public.nexus_workflow_versions') IS NOT NULL AS nexus_workflow_versions,
         to_regclass('public.workflow_definitions') IS NOT NULL AS workflow_definitions,
         to_regclass('public.workflow_executions') IS NOT NULL AS workflow_executions`,
    );
    const tables = Object.fromEntries(
      Object.entries(schemaResult.rows[0] || {}).map(([name, available]) => [name, available === true]),
    );
    const schemaOk = Object.keys(tables).length === 6 && Object.values(tables).every(Boolean);

    let counts = { ...emptyCounts };
    if (schemaOk) {
      const countResult = await dbModule.db.query(
        `SELECT
           (SELECT count(*) FROM public.nexus_workflows) AS workflows,
           (SELECT count(*) FROM public.nexus_workflows WHERE status = 'published') AS published_workflows,
           (SELECT count(*)
              FROM public.workflow_executions execution
             WHERE execution.workflow_id IN (
               SELECT published_workflow_id FROM public.nexus_workflows WHERE published_workflow_id IS NOT NULL
             )
               AND execution.started_at >= clock_timestamp() - interval '24 hours') AS executions_24h,
           (SELECT count(*)
              FROM public.workflow_executions execution
             WHERE execution.workflow_id IN (
               SELECT published_workflow_id FROM public.nexus_workflows WHERE published_workflow_id IS NOT NULL
             )
               AND execution.status = 'failed'
               AND execution.started_at >= clock_timestamp() - interval '24 hours') AS failed_executions_24h,
           (SELECT count(*)
              FROM public.workflow_executions execution
             WHERE execution.workflow_id IN (
               SELECT published_workflow_id FROM public.nexus_workflows WHERE published_workflow_id IS NOT NULL
             )
               AND execution.status IN ('queued', 'running')
               AND execution.updated_at < clock_timestamp() - interval '5 minutes') AS stuck_executions,
           (SELECT count(*)
              FROM public.nexus_schedule_runs
             WHERE status = 'failed'
               AND scheduled_for >= clock_timestamp() - interval '24 hours') AS failed_schedules_24h`,
      );
      const row = countResult.rows[0] || {};
      counts = {
        workflows: numeric(row.workflows),
        publishedWorkflows: numeric(row.published_workflows),
        executions24h: numeric(row.executions_24h),
        failedExecutions24h: numeric(row.failed_executions_24h),
        stuckExecutions: numeric(row.stuck_executions),
        failedSchedules24h: numeric(row.failed_schedules_24h),
      };
    }

    snapshot = {
      checkedAt,
      databaseOk: true,
      schemaOk,
      tables,
      counts,
      error: schemaOk ? null : 'Uma ou mais tabelas obrigatórias do Nexus não estão disponíveis.',
    };
  } catch (error) {
    snapshot = {
      ...snapshot,
      checkedAt,
      databaseOk: false,
      schemaOk: false,
      error: error instanceof Error ? error.message : 'Falha desconhecida ao consultar o banco.',
    };
  }
}

function unixTimestamp(value: string | null) {
  if (!value) return 0;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.floor(timestamp / 1000) : 0;
}

function monitorState(dbModule: DatabaseModule, scheduleModule: ScheduleModule, pollMs: number) {
  const scheduler = scheduleModule.getNexusScheduleRunnerStatus();
  const checkAgeMs = snapshot.checkedAt ? Date.now() - Date.parse(snapshot.checkedAt) : Number.POSITIVE_INFINITY;
  const fresh = checkAgeMs <= Math.max(90_000, pollMs * 3);
  const healthy = snapshot.databaseOk && snapshot.schemaOk && fresh;

  return {
    service: 'dialogy-nexus',
    healthy,
    startedAt,
    uptimeSeconds: Math.floor(process.uptime()),
    monitor: { ...snapshot, fresh },
    scheduler,
    databasePool: dbModule.getPoolStats(),
  };
}

function prometheusMetrics(dbModule: DatabaseModule, scheduleModule: ScheduleModule, pollMs: number) {
  const state = monitorState(dbModule, scheduleModule, pollMs);
  const pool = state.databasePool;
  const counts = snapshot.counts;
  const scheduler = state.scheduler;
  const values = [
    ['dialogy_nexus_up', state.healthy ? 1 : 0],
    ['dialogy_nexus_database_up', snapshot.databaseOk ? 1 : 0],
    ['dialogy_nexus_schema_ready', snapshot.schemaOk ? 1 : 0],
    ['dialogy_nexus_workflows_total', counts.workflows],
    ['dialogy_nexus_workflows_published', counts.publishedWorkflows],
    ['dialogy_nexus_executions_24h_total', counts.executions24h],
    ['dialogy_nexus_executions_failed_24h_total', counts.failedExecutions24h],
    ['dialogy_nexus_executions_stuck', counts.stuckExecutions],
    ['dialogy_nexus_schedule_runs_failed_24h_total', counts.failedSchedules24h],
    ['dialogy_nexus_schedule_runner_active', scheduler.active ? 1 : 0],
    ['dialogy_nexus_schedule_last_success_unixtime', unixTimestamp(scheduler.lastSuccessAt)],
    ['dialogy_nexus_db_pool_total', pool.total],
    ['dialogy_nexus_db_pool_idle', pool.idle],
    ['dialogy_nexus_db_pool_waiting', pool.waiting],
    ['dialogy_nexus_process_uptime_seconds', state.uptimeSeconds],
  ] as const;

  return `${values.map(([name, value]) => `${name} ${value}`).join('\n')}\n`;
}

async function main() {
  await loadEnvironment();
  const [dbModule, scheduleModule] = await Promise.all([
    import('@/lib/db'),
    import('@/modules/nexus/services/schedule-runner'),
  ]);
  const port = positiveInteger(process.env.NEXUS_MONITOR_PORT, 9050, 65_535);
  const pollMs = Math.max(10_000, positiveInteger(process.env.NEXUS_MONITOR_POLL_MS, 30_000, 300_000));

  await refreshSnapshot(dbModule);
  scheduleModule.startNexusScheduleRunner();
  const automationModule = await import('@/modules/nexus/services/automation-worker');
  const automationTimer = setInterval(() => { void automationModule.pollAutomationTasks().catch(() => console.error('[NEXUS_AUTOMATION] Falha na recuperação de tarefas.')); }, 2000);
  automationTimer.unref?.();

  const monitorTimer = setInterval(() => {
    void refreshSnapshot(dbModule);
  }, pollMs);
  (monitorTimer as unknown as { unref?: () => void }).unref?.();

  const server = createServer((request, response) => {
    const pathname = new URL(request.url || '/', 'http://dialogy-nexus').pathname;
    if (request.method !== 'GET') {
      response.writeHead(405, { 'content-type': 'application/json; charset=utf-8', allow: 'GET' });
      response.end(JSON.stringify({ error: 'method_not_allowed' }));
      return;
    }
    if (pathname === '/metrics') {
      response.writeHead(200, { 'content-type': 'text/plain; version=0.0.4; charset=utf-8' });
      response.end(prometheusMetrics(dbModule, scheduleModule, pollMs));
      return;
    }
    if (pathname === '/health' || pathname === '/ready' || pathname === '/status') {
      const state = monitorState(dbModule, scheduleModule, pollMs);
      response.writeHead(pathname === '/status' || state.healthy ? 200 : 503, {
        'content-type': 'application/json; charset=utf-8',
      });
      response.end(JSON.stringify(state));
      return;
    }
    response.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ error: 'not_found' }));
  });

  server.listen(port, '0.0.0.0', () => {
    console.log(`[NEXUS_WORKER] monitor ativo na porta ${port}; agendador=${process.env.NEXUS_SCHEDULE_ENABLED !== 'false'}`);
  });

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`[NEXUS_WORKER] ${signal} recebido; encerrando com segurança...`);
    clearInterval(monitorTimer);
    clearInterval(automationTimer);
    scheduleModule.stopNexusScheduleRunner();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await dbModule.db.end();
    process.exit(0);
  };

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
}

void main().catch((error) => {
  console.error('[NEXUS_WORKER] falha fatal:', error instanceof Error ? error.message : 'unknown_error');
  process.exit(1);
});
