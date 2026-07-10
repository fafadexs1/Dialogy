import { db } from '@/lib/db';
import { getWorkflowRuntimeV2FlagSnapshot } from './autopilot-rollout';

type Queryable = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }>;
};

type FlagConfig = {
  enabled?: boolean;
  workspaces?: string[];
  users?: string[];
  rollout?: number;
  releaseChannels?: string[];
};

type FlagStore = {
  defaults?: FlagConfig;
  flags?: Record<string, FlagConfig>;
};

export type WorkflowRuntimeV2WorkspaceStage =
  | 'off'
  | 'shadow_compile'
  | 'shadow_execution'
  | 'canary'
  | 'beta'
  | 'primary';

const FLAGS = [
  'workflow_runtime_v2_shadow_compile',
  'workflow_runtime_v2_shadow_execution',
  'workflow_runtime_v2_canary_execution',
  'workflow_runtime_v2_primary_execution',
] as const;

const STAGE_FLAGS: Record<WorkflowRuntimeV2WorkspaceStage, ReadonlySet<(typeof FLAGS)[number]>> = {
  off: new Set(),
  shadow_compile: new Set([FLAGS[0]]),
  shadow_execution: new Set([FLAGS[0], FLAGS[1]]),
  canary: new Set([FLAGS[0], FLAGS[1], FLAGS[2]]),
  beta: new Set([FLAGS[0], FLAGS[1], FLAGS[3]]),
  primary: new Set([FLAGS[0], FLAGS[1], FLAGS[3]]),
};

function parseStore(value: unknown): FlagStore {
  if (!value) return { flags: {} };
  if (typeof value === 'object') return structuredClone(value) as FlagStore;
  try {
    return JSON.parse(String(value)) as FlagStore;
  } catch {
    return { flags: {} };
  }
}

async function loadStore(database: Queryable, lock = false): Promise<FlagStore> {
  const result = await database.query(
    `SELECT value FROM public.system_settings WHERE key = $1${lock ? ' FOR UPDATE' : ''}`,
    ['feature_flags'],
  );
  return parseStore(result.rows[0]?.value);
}

export function buildWorkflowRuntimeV2WorkspaceFlagStore(
  value: unknown,
  workspaceId: string,
  stage: WorkflowRuntimeV2WorkspaceStage,
) {
  const store = parseStore(value);
  const flags = { ...(store.flags || {}) };
  for (const flag of FLAGS) {
    const current = { ...(flags[flag] || {}) };
    const targets = new Set(current.workspaces || []);
    if (STAGE_FLAGS[stage].has(flag)) targets.add(workspaceId);
    else targets.delete(workspaceId);
    flags[flag] = {
      ...current,
      // Target lists override disabled in evaluateFeatureFlag. Keeping enabled=false
      // prevents a workspace rollout from accidentally becoming a global rollout.
      enabled: current.enabled === true ? true : false,
      workspaces: [...targets].sort(),
    };
  }
  return { ...store, flags };
}

async function saveStore(database: Queryable, store: FlagStore) {
  await database.query(
    `INSERT INTO public.system_settings (key, value, updated_at)
     VALUES ($1, $2, clock_timestamp())
     ON CONFLICT (key) DO UPDATE
     SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
    ['feature_flags', JSON.stringify(store)],
  );
}

async function appendAudit(database: Queryable, entry: Record<string, unknown>) {
  const result = await database.query(
    'SELECT value FROM public.system_settings WHERE key = $1 FOR UPDATE',
    ['workflow_runtime_v2_rollout_audit'],
  );
  let entries: unknown[] = [];
  try {
    entries = JSON.parse(String(result.rows[0]?.value || '[]'));
    if (!Array.isArray(entries)) entries = [];
  } catch {
    entries = [];
  }
  entries.push(entry);
  await database.query(
    `INSERT INTO public.system_settings (key, value, updated_at)
     VALUES ($1, $2, clock_timestamp())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
    ['workflow_runtime_v2_rollout_audit', JSON.stringify(entries.slice(-100))],
  );
}

export async function getWorkflowRuntimeV2WorkspaceRolloutStatus(
  workspaceId: string,
  database: Queryable = db,
) {
  const [flags, configs, executions] = await Promise.all([
    getWorkflowRuntimeV2FlagSnapshot({ workspaceId }, database),
    database.query(
      `SELECT workflow_builder_mode, workflow_runtime_v2_mode, count(*)::int AS count
       FROM public.autopilot_configs
       WHERE workspace_id = $1
       GROUP BY workflow_builder_mode, workflow_runtime_v2_mode`,
      [workspaceId],
    ),
    database.query(
      `SELECT status, count(*)::int AS count
       FROM public.workflow_executions
       WHERE workspace_id = $1 AND started_at >= clock_timestamp() - interval '24 hours'
       GROUP BY status`,
      [workspaceId],
    ),
  ]);
  return {
    workspaceId,
    flags,
    configs: configs.rows,
    executionsLast24Hours: executions.rows,
  };
}

export async function promoteWorkflowRuntimeV2Workspace(input: {
  workspaceId: string;
  stage: WorkflowRuntimeV2WorkspaceStage;
  actor?: string;
  dryRun?: boolean;
  database?: Queryable;
}) {
  const database = input.database || db;
  const workspace = await database.query('SELECT id FROM public.workspaces WHERE id = $1 LIMIT 1', [input.workspaceId]);
  if (!workspace.rows[0]) throw new Error(`Workspace ${input.workspaceId} not found.`);
  const before = await getWorkflowRuntimeV2WorkspaceRolloutStatus(input.workspaceId, database);
  if (input.dryRun) {
    return { applied: false, stage: input.stage, before, after: before };
  }

  await database.query('BEGIN');
  try {
    const store = await loadStore(database, true);
    await saveStore(database, buildWorkflowRuntimeV2WorkspaceFlagStore(store, input.workspaceId, input.stage));
    const configMode = input.stage === 'primary'
      ? 'primary'
      : input.stage === 'off'
        ? 'off'
        : 'shadow';
    const updated = await database.query(
      `UPDATE public.autopilot_configs
       SET workflow_runtime_v2_mode = $2, updated_at = clock_timestamp()
       WHERE workspace_id = $1 AND workflow_builder_mode = 'native_v2'`,
      [input.workspaceId, configMode],
    );
    await appendAudit(database, {
      workspaceId: input.workspaceId,
      stage: input.stage,
      actor: input.actor || 'rollout_cli',
      updatedConfigs: updated.rowCount || 0,
      at: new Date().toISOString(),
    });
    await database.query('COMMIT');
  } catch (error) {
    await database.query('ROLLBACK');
    throw error;
  }
  const after = await getWorkflowRuntimeV2WorkspaceRolloutStatus(input.workspaceId, database);
  return { applied: true, stage: input.stage, before, after };
}

export async function verifyWorkflowRuntimeV2Rollback(input: {
  workspaceId: string;
  database?: Queryable;
}) {
  const database = input.database || db;
  await database.query('BEGIN');
  try {
    const before = await database.query(
      `SELECT id, active_workflow_id, active_workflow_version
       FROM public.autopilot_configs
       WHERE workspace_id = $1 AND workflow_builder_mode = 'native_v2'`,
      [input.workspaceId],
    );
    if (before.rows.length === 0) throw new Error('No native V2 automations found for rollback verification.');
    await database.query(
      `UPDATE public.autopilot_configs SET workflow_runtime_v2_mode = 'off'
       WHERE workspace_id = $1 AND workflow_builder_mode = 'native_v2'`,
      [input.workspaceId],
    );
    const after = await database.query(
      `SELECT id, workflow_runtime_v2_mode, active_workflow_id, active_workflow_version
       FROM public.autopilot_configs
       WHERE workspace_id = $1 AND workflow_builder_mode = 'native_v2'`,
      [input.workspaceId],
    );
    for (const config of after.rows) {
      const original = before.rows.find((row) => row.id === config.id);
      if (config.workflow_runtime_v2_mode !== 'off') throw new Error(`Rollback did not disable ${config.id}.`);
      if (config.active_workflow_id !== original?.active_workflow_id
        || config.active_workflow_version !== original?.active_workflow_version) {
        throw new Error(`Rollback modified the immutable workflow pointer for ${config.id}.`);
      }
      if (config.active_workflow_id && config.active_workflow_version) {
        const definition = await database.query(
          `SELECT 1 FROM public.workflow_definitions
           WHERE workflow_id = $1 AND workflow_version = $2 LIMIT 1`,
          [config.active_workflow_id, config.active_workflow_version],
        );
        if (!definition.rows[0]) throw new Error(`Published definition missing for ${config.id}.`);
      }
    }
    await database.query('ROLLBACK');
    return { valid: true, checkedConfigs: after.rows.length, sideEffects: 0, persistedChanges: 0 };
  } catch (error) {
    await database.query('ROLLBACK');
    throw error;
  }
}
