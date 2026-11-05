import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';
import { readFileSync } from 'node:fs';
import { createStudioFlowState } from '@/services/agent-studio/flow-execution';
import { STUDIO_FLOW_AGENT, STUDIO_FLOW_RELEASE, STUDIO_FLOW_WORKSPACE } from './fixtures/studio-flow-fixture';

const databaseUrl = process.env.STUDIO_FLOW_TEST_DATABASE_URL;
const database = vi.hoisted(() => ({ pool: null as Pool | null }));
vi.mock('@/lib/db', () => ({ db: { query: (...args: unknown[]) => (database.pool!.query as (...args: unknown[]) => unknown)(...args) } }));
import { cancelStudioFlowInvocations, studioFlowInvocationStore } from '@/services/agent-studio/flow-store';

describe.skipIf(!databaseUrl)('Studio flow checkpoints on disposable PostgreSQL', () => {
  const otherWorkspace = '30000000-0000-4000-8000-000000000001';
  const scope = { workspaceId: STUDIO_FLOW_WORKSPACE, invocationId: 'execution:agent:visit:0', workflowId: 'workflow', executionId: 'execution', nodeId: 'agent', agentId: STUDIO_FLOW_AGENT, releaseId: STUDIO_FLOW_RELEASE };
  beforeAll(async () => {
    const target = new URL(databaseUrl!);
    if (!['127.0.0.1', 'localhost'].includes(target.hostname) || target.pathname !== '/studio_flow_fixture') throw new Error('This suite requires the named disposable loopback database.');
    database.pool = new Pool({ connectionString: databaseUrl });
    vi.stubEnv('WORKSPACE_CREDENTIALS_ENCRYPTION_KEY', 'studio-flow-disposable-fixture-key-only');
    await database.pool.query('CREATE TABLE IF NOT EXISTS workspaces(id uuid PRIMARY KEY)');
    await database.pool.query('INSERT INTO workspaces VALUES($1),($2) ON CONFLICT DO NOTHING', [STUDIO_FLOW_WORKSPACE, otherWorkspace]);
    await database.pool.query(`DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$; DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);
    const migration = readFileSync('prisma/migrations/20261023180000_studio_flow_invocations/migration.sql', 'utf8');
    await database.pool.query(migration); await database.pool.query(migration);
  });
  beforeEach(async () => { await database.pool!.query('TRUNCATE studio_flow_invocations'); });
  afterAll(async () => { await database.pool?.end(); vi.unstubAllEnvs(); });
  it('stores encrypted state without requiring a conversation and can restore it', async () => {
    const store = await studioFlowInvocationStore(scope); const state = createStudioFlowState(scope.releaseId); state.data.customer = 'private-client-data';
    await store.checkpoint(state);
    const raw = await database.pool!.query('SELECT encrypted_state FROM studio_flow_invocations');
    expect(raw.rows[0].encrypted_state).not.toContain('private-client-data');
    expect((await studioFlowInvocationStore(scope)).state?.data.customer).toBe('private-client-data');
  });
  it('rejects concurrent creation and stale checkpoints', async () => {
    const a = await studioFlowInvocationStore(scope), b = await studioFlowInvocationStore(scope); const state = createStudioFlowState(scope.releaseId);
    await a.checkpoint(state); await expect(b.checkpoint(state)).rejects.toThrow('Outra execução');
    const c = await studioFlowInvocationStore(scope), d = await studioFlowInvocationStore(scope);
    await c.checkpoint({ ...state, modelCalls: 1 }); await expect(d.checkpoint(state)).rejects.toThrow('alterada ou cancelada');
  });
  it('keeps workspaces and fixed releases isolated', async () => {
    const store = await studioFlowInvocationStore(scope); await store.checkpoint(createStudioFlowState(scope.releaseId));
    expect((await studioFlowInvocationStore({ ...scope, workspaceId: otherWorkspace })).state).toBeUndefined();
    await expect(studioFlowInvocationStore({ ...scope, releaseId: '40000000-0000-4000-8000-000000000003' })).rejects.toThrow('outra versão');
  });
  it('cancels active calls, rejects late checkpoints and prevents repeating an uncertain effect', async () => {
    const store = await studioFlowInvocationStore(scope); const state = createStudioFlowState(scope.releaseId); state.operations.action = { status: 'running' };
    await store.checkpoint(state); await cancelStudioFlowInvocations(scope.workspaceId, scope.executionId);
    await expect(store.checkpoint(state)).rejects.toThrow('cancelada');
    await expect(studioFlowInvocationStore(scope)).rejects.toThrow('cancelada');
    await expect(studioFlowInvocationStore({ ...scope, invocationId: 'execution:agent:visit:1' })).rejects.toThrow('sem confirmação');
    expect((await studioFlowInvocationStore({ ...scope, executionId: 'different', invocationId: 'different:agent:visit:0' })).state).toBeUndefined();
  });
  it('preserves completed results when a surrounding execution is cancelled', async () => {
    const store = await studioFlowInvocationStore(scope); const state = { ...createStudioFlowState(scope.releaseId), status: 'completed' as const };
    await store.checkpoint(state); await cancelStudioFlowInvocations(scope.workspaceId, scope.executionId);
    expect((await studioFlowInvocationStore(scope)).state?.status).toBe('completed');
  });
  it('does not expose checkpoints to authenticated browser roles', async () => {
    const client = await database.pool!.connect();
    try { await client.query('BEGIN'); await client.query('SET LOCAL ROLE authenticated'); await expect(client.query('SELECT * FROM studio_flow_invocations')).rejects.toThrow('permission denied'); }
    finally { await client.query('ROLLBACK'); client.release(); }
  });
});
