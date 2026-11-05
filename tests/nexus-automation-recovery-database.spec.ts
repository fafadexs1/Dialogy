import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
const databaseUrl = process.env.NEXUS_AUTOMATION_TEST_DATABASE_URL;
const fixture = vi.hoisted(() => ({ pool: null as Pool | null }));
vi.mock('@/lib/db', () => ({ db: { query: (...args: unknown[]) => (fixture.pool!.query as (...args: unknown[]) => unknown)(...args), connect: () => fixture.pool!.connect() } }));
vi.mock('@/modules/nexus/services/runtime', () => ({ loadPublishedNexusWorkflow: async () => ({ active: true }) }));
import { recoverWithConfirmedResult, recoveryContext } from '@/modules/nexus/services/automation-recovery';
import { PostgresWorkflowPersistence } from '@/services/workflow-runtime/postgres-persistence';
import { WorkflowExecutor } from '@/services/workflow-runtime/executor';
import { createDefaultNodeHandlerRegistry } from '@/services/workflow-runtime/node-handlers';
import type { NodeExecutionResult } from '@/services/workflow-runtime/types';
import { workflowNode, workflowDefinition, connect } from './workflow-runtime-fixtures';

describe.skipIf(!databaseUrl)('confirmed recovery on real disposable PostgreSQL', () => {
  const workspaceId = '70000000-0000-4000-8000-000000000001';
  beforeAll(async () => {
    const target = new URL(databaseUrl!);
    if (!['127.0.0.1', 'localhost'].includes(target.hostname) || target.pathname !== '/automation_toolbox_fixture') throw new Error('Use the named disposable loopback database only.');
    const admin = new Pool({ connectionString: target.toString() });
    if (!(await admin.query(`SELECT 1 FROM pg_database WHERE datname='automation_recovery_fixture'`)).rowCount) await admin.query('CREATE DATABASE automation_recovery_fixture');
    await admin.end(); target.pathname = '/automation_recovery_fixture';
    fixture.pool = new Pool({ connectionString: target.toString() });
    await fixture.pool.query(`DROP SCHEMA public CASCADE; CREATE SCHEMA public; CREATE TABLE workspaces(id uuid PRIMARY KEY); INSERT INTO workspaces VALUES('${workspaceId}');
      CREATE TABLE nexus_credentials(id uuid PRIMARY KEY,workspace_id uuid,credential_type text CONSTRAINT nexus_credentials_credential_type_check CHECK(credential_type IN ('bearer','api_key','basic','smtp','google_oauth','database')),encrypted_payload text);
      GRANT USAGE ON SCHEMA public TO anon,authenticated;`);
    await fixture.pool.query(readFileSync('prisma/migrations/20260702140000_workflow_runtime_v2/migration.sql', 'utf8'));
    await fixture.pool.query(readFileSync('prisma/migrations/20261024120000_nexus_automation_toolbox/migration.sql', 'utf8'));
    vi.stubEnv('WORKSPACE_CREDENTIALS_ENCRYPTION_KEY', 'automation-recovery-disposable-fixture-only');
  });
  beforeEach(async () => { await fixture.pool!.query('TRUNCATE workflow_definitions,nexus_automation_jobs CASCADE'); });
  afterAll(async () => { await fixture.pool?.end(); vi.unstubAllEnvs(); });

  async function failedWorkflow() {
    const trigger = workflowNode('trigger.manual', 'start'), prepared = workflowNode('data.set', 'prepared', { assignments: { lead: 'preserved' } });
    const http = workflowNode('integration.http_request', 'http', { permissionScope: 'integrations:http', method: 'POST', url: 'https://api.example.com/orders', outputKey: 'order' }), end = workflowNode('output.end', 'end');
    const workflow = workflowDefinition([trigger, prepared, http, end], [connect(trigger, 'started', prepared, 'main'), connect(prepared, 'success', http, 'main'), connect(http, 'success', end, 'main')], { id: 'nexus:recovery-fixture', workspaceId });
    const write = vi.fn(async () => { throw Object.assign(new Error('Resposta externa não confirmada.'), { code: 'EXTERNAL_OUTCOME_UNKNOWN', retryable: false }); });
    const handlers = createDefaultNodeHandlerRegistry({ executeHttp: write });
    handlers.wrapExecutions(async (handler, input) => {
      const context = input.execution.context.__automationRecovery as { nodeId?: string; result?: NodeExecutionResult } | undefined;
      return context?.nodeId === input.node.id && context.result ? context.result : handler.execute(input);
    });
    const persistence = new PostgresWorkflowPersistence(fixture.pool!);
    const executor = new WorkflowExecutor(persistence, handlers);
    const execution = await executor.start({ workflow, input: {}, executionId: 'recovery-execution' });
    expect(execution.status).toBe('failed');
    return { execution: (await persistence.getExecution(execution.executionId))!, executor, persistence, write };
  }
  it('preserves completed steps, applies the confirmed output and never repeats the external write', async () => {
    const { execution, executor, persistence, write } = await failedWorkflow();
    await recoverWithConfirmedResult(workspaceId, workspaceId, { executionId: execution.executionId, expectedVersion: execution.version, selectedOutput: 'success', output: { selected: { orderId: 'confirmed-42' } }, evidence: 'Pedido confirmado 42' });
    const restored = await executor.runExecution(execution.executionId);
    expect(restored.status).toBe('completed'); expect(restored.variables).toMatchObject({ lead: 'preserved', order: { orderId: 'confirmed-42' } });
    expect(restored.executionPath.filter(step => step.nodeId === 'prepared')).toHaveLength(1);
    expect(write).toHaveBeenCalledTimes(1);
    expect((await persistence.getExecution(execution.executionId))?.context.__automationRecovery).toBeUndefined();
    expect(restored.context.__lastAutomationRecovery).toMatchObject({ confirmedBy: workspaceId, evidence: 'Pedido confirmado 42' });
  });
  it('rejects invalid routes, stale versions and cross-workspace access before changing state', async () => {
    const { execution, persistence } = await failedWorkflow();
    await expect(recoveryContext('70000000-0000-4000-8000-000000000002', execution.executionId)).rejects.toThrow('workspace');
    await expect(recoverWithConfirmedResult(workspaceId, workspaceId, { executionId: execution.executionId, expectedVersion: execution.version - 1, selectedOutput: 'success', output: {}, evidence: 'Verificado' })).rejects.toThrow('alterada');
    await expect(recoverWithConfirmedResult(workspaceId, workspaceId, { executionId: execution.executionId, expectedVersion: execution.version, selectedOutput: 'fake', output: {}, evidence: 'Verificado' })).rejects.toThrow('saída');
    expect((await persistence.getExecution(execution.executionId))?.status).toBe('failed');
    expect((await fixture.pool!.query('SELECT * FROM nexus_automation_jobs')).rowCount).toBe(0);
  });
  it('accepts only one of two concurrent confirmations', async () => {
    const { execution } = await failedWorkflow();
    const input = { executionId: execution.executionId, expectedVersion: execution.version, selectedOutput: 'success', output: {}, evidence: 'Protocolo validado' };
    const results = await Promise.allSettled([recoverWithConfirmedResult(workspaceId, workspaceId, input), recoverWithConfirmedResult(workspaceId, workspaceId, input)]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect((await fixture.pool!.query('SELECT * FROM nexus_automation_jobs')).rowCount).toBe(1);
  });
});
