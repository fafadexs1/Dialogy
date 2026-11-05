import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import type { NodeRuntimeInput, WorkflowExecution } from '@/services/workflow-runtime/types';
import { WorkflowExecutionSchema } from '@/services/workflow-runtime/schemas';
import { workflowNode, workflowDefinition } from './workflow-runtime-fixtures';

const databaseUrl = process.env.NEXUS_AUTOMATION_TEST_DATABASE_URL;
const fixture = vi.hoisted(() => ({ pool: null as Pool | null, executions: new Map<string, WorkflowExecution>(), run: vi.fn(), published: vi.fn(), request: vi.fn(), resume: vi.fn(), files: new Map<string, Buffer>() }));
vi.mock('@/lib/db', () => ({ db: { query: (...args: unknown[]) => (fixture.pool!.query as (...args: unknown[]) => unknown)(...args), connect: () => fixture.pool!.connect() } }));
vi.mock('@/services/workflow-runtime/postgres-persistence', () => ({ PostgresWorkflowPersistence: class { getExecution(id: string) { return fixture.executions.get(id) || null; } saveWorkflowDefinition() { return Promise.resolve(); } } }));
vi.mock('@/modules/nexus/services/public-http', () => ({ requestPublicHttps: (...args: unknown[]) => fixture.request(...args) }));
vi.mock('@/modules/nexus/services/runtime', () => ({ loadPublishedNexusWorkflow: (...args: unknown[]) => fixture.published(...args), runPersistedNexusExecution: (...args: unknown[]) => fixture.run(...args), resumePublishedNexusWorkflow: (...args: unknown[]) => fixture.resume(...args), terminalNexusOutput: (execution: WorkflowExecution) => ({ executionId: execution.executionId }), cancelPublishedNexusWorkflowExecution: vi.fn() }));
vi.mock('@/lib/storage/private-s3', () => ({ putPrivateObject: async (input: { key: string; body: Buffer }) => { fixture.files.set(input.key, input.body); }, readPrivateObject: async (key: string) => fixture.files.get(key), createPrivateObjectDownloadUrl: async (key: string) => `https://files.example.com/${key}` }));
import { executeDurableEffect } from '@/modules/nexus/services/durable-effects';
import { executeAutomationBatch } from '@/modules/nexus/services/automation-batches';
import { executeApprovalNode } from '@/modules/nexus/services/automation-approvals';
import { processAutomationTask, processAutomationEvents } from '@/modules/nexus/services/automation-worker';
import { saveWorkflowFile, loadWorkflowFile } from '@/modules/nexus/services/workflow-files';
import { encryptPayload, decryptPayload } from '@/modules/nexus/services/credentials';
import { loadConnector, saveConnectorDraft, publishConnector } from '@/modules/nexus/services/connectors';
import { resolveNexusOAuthToken } from '@/modules/nexus/services/oauth-credentials';
import { WorkflowExecutor } from '@/services/workflow-runtime/executor';
import { InMemoryWorkflowPersistence } from '@/services/workflow-runtime/persistence';
import { createDefaultNodeHandlerRegistry } from '@/services/workflow-runtime/node-handlers';
import { nodeInvocationKey } from '@/modules/nexus/services/durable-effects';
import { connect } from './workflow-runtime-fixtures';
import { executeNexusHttpOperation } from '@/modules/nexus/services/http-executor';
import { enqueueWebhookExecution, customWebhookResponse } from '@/modules/nexus/services/webhook-execution';
import { executeDataOperation } from '@/services/workflow-runtime/data-operations';

describe.skipIf(!databaseUrl)('automation toolbox on disposable PostgreSQL', () => {
  const workspaceId = '40000000-0000-4000-8000-000000000001', otherWorkspace = '40000000-0000-4000-8000-000000000002';
  const execution = (id: string, status = 'running'): WorkflowExecution => WorkflowExecutionSchema.parse({ executionId: id, workflowId: 'nexus:parent', workflowVersion: '1', workspaceId, status, currentNodeId: 'map', previousNodeId: null, pendingNodeIds: [], input: {}, variables: {}, context: {}, nodeResults: {}, executionPath: [], startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), totalSteps: 1, totalModelCalls: 0, totalToolCalls: 0 });
  const runtime = (type = 'logic.map_subflow', config: Record<string, unknown> = {}): NodeRuntimeInput => {
    const node = workflowNode(type, 'map', { items: [1, 2, 3], workflowId: 'child-flow', ...config });
    return { node, workflow: workflowDefinition([node], [], { id: 'nexus:parent', workspaceId, settings: { ...workflowDefinition([], []).settings, maxModelCalls: 10, maxToolCalls: 10 } }), execution: execution('parent'), input: {}, attachments: {}, signal: new AbortController().signal, emit: async () => undefined };
  };
  beforeAll(async () => {
    const target = new URL(databaseUrl!);
    if (!['127.0.0.1', 'localhost'].includes(target.hostname) || target.pathname !== '/automation_toolbox_fixture') throw new Error('Use the named disposable loopback database only.');
    fixture.pool = new Pool({ connectionString: databaseUrl, max: 10 });
    vi.stubEnv('WORKSPACE_CREDENTIALS_ENCRYPTION_KEY', 'automation-fixture-encryption-only');
    vi.stubEnv('NEXUS_AUTOMATION_WORKSPACES', 'all');
    await fixture.pool.query(`DROP SCHEMA public CASCADE; CREATE SCHEMA public; CREATE TABLE workspaces(id uuid PRIMARY KEY);
      INSERT INTO workspaces VALUES('${workspaceId}'),('${otherWorkspace}');
      DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      CREATE TABLE nexus_credentials(id uuid PRIMARY KEY,workspace_id uuid NOT NULL,credential_type text CONSTRAINT nexus_credentials_credential_type_check CHECK(credential_type IN ('bearer','api_key','basic','smtp','google_oauth','database')),encrypted_payload text,updated_at timestamptz);
      CREATE TABLE workflow_executions(id text PRIMARY KEY,workspace_id uuid,status text,workflow_id text,waiting_reason text,resume_token text,node_results jsonb,current_node_id text,updated_at timestamptz DEFAULT clock_timestamp()); GRANT USAGE ON SCHEMA public TO anon,authenticated;`);
    await fixture.pool.query(readFileSync('prisma/migrations/20261024120000_nexus_automation_toolbox/migration.sql', 'utf8'));
  });
  beforeEach(async () => {
    await fixture.pool!.query('TRUNCATE nexus_automation_jobs,nexus_automation_approvals,nexus_automation_effects,nexus_connectors,nexus_workflow_files,nexus_automation_policies,nexus_credentials,nexus_automation_events,workflow_executions CASCADE');
    fixture.executions.clear(); fixture.files.clear(); fixture.run.mockReset(); fixture.published.mockReset(); fixture.request.mockReset(); fixture.resume.mockReset();
    fixture.executions.set('parent', execution('parent'));
    fixture.published.mockResolvedValue({ workspaceId, workflow: workflowDefinition([workflowNode('trigger.manual', 'manual')], [], { id: 'nexus:child-flow', version: 'pinned-1', workspaceId }) });
    fixture.run.mockImplementation(async (input: { executionId: string }) => ({ ...execution(input.executionId, 'completed'), totalModelCalls: 1, totalToolCalls: 1 }));
  });
  afterAll(async () => { await fixture.pool?.end(); vi.unstubAllEnvs(); });

  it('records an external intent once and blocks uncertain writes', async () => {
    const write = vi.fn(async () => ({ ok: true }));
    expect(await executeDurableEffect(workspaceId, 'effect', { amount: 10 }, write)).toEqual({ ok: true });
    expect(await executeDurableEffect(workspaceId, 'effect', { amount: 10 }, write)).toEqual({ ok: true });
    expect(write).toHaveBeenCalledTimes(1);
    await expect(executeDurableEffect(workspaceId, 'effect', { amount: 11 }, write)).rejects.toThrow('incerto');
    const uncertain = vi.fn(async () => { throw new Error('lost response'); });
    await expect(executeDurableEffect(workspaceId, 'uncertain', {}, uncertain)).rejects.toThrow();
    await expect(executeDurableEffect(workspaceId, 'uncertain', {}, uncertain)).rejects.toThrow('incerto');
    expect(uncertain).toHaveBeenCalledTimes(1);
  });
  it('keeps binary bytes private, checks workspace ownership and expiry', async () => {
    const data = Buffer.from([255, 0, 128, 1]);
    const ref = await saveWorkflowFile({ workspaceId, name: 'audio.mp3', mimeType: 'audio/mpeg', data });
    expect((await loadWorkflowFile(workspaceId, { ...ref, name: 'forged.txt' })).file.name).toBe('audio.mp3');
    expect((await loadWorkflowFile(workspaceId, ref)).data).toEqual(data);
    await expect(loadWorkflowFile(otherWorkspace, ref)).rejects.toThrow('workspace');
    await fixture.pool!.query(`UPDATE nexus_workflow_files SET expires_at=clock_timestamp()-interval '1 second'`);
    await expect(loadWorkflowFile(workspaceId, ref)).rejects.toThrow('expirado');
  });
  it('pins versions and survives a worker restart with ordered results', async () => {
    const input = runtime();
    const waiting = await executeAutomationBatch(input), id = String(waiting.output!.invocationId);
    const raw = (await fixture.pool!.query('SELECT encrypted_payload FROM nexus_automation_jobs WHERE id=$1', [id])).rows[0];
    expect(raw.encrypted_payload).not.toContain('pinned-1');
    expect((decryptPayload(raw.encrypted_payload).tasks as Array<{ version: string }>)[0].version).toBe('pinned-1');
    for (const index of [2, 0, 1]) await processAutomationTask(`${id}_${index}`, workspaceId);
    await processAutomationTask(id, workspaceId);
    input.execution.nodeResults.map = waiting;
    const completed = await executeAutomationBatch(input);
    expect(completed.status).toBe('success');
    expect((completed.output!.items as Array<{ index: number }>).map(item => item.index)).toEqual([0, 1, 2]);
    expect(completed.metrics).toMatchObject({ modelCalls: 3, toolCalls: 3 });
    await processAutomationTask(`${id}_0`, workspaceId);
    expect(fixture.run).toHaveBeenCalledTimes(3);
  });
  it('atomically limits simultaneous children and prevents oversubscribing budgets', async () => {
    const input = runtime('logic.map_subflow', { concurrency: 2, modelCallsPerChild: 5 });
    const waiting = await executeAutomationBatch(input), id = String(waiting.output!.invocationId);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let active = 0, maximum = 0;
    fixture.run.mockImplementation(async (value: { executionId: string }) => { active++; maximum = Math.max(maximum, active); await gate; active--; return { ...execution(value.executionId, 'completed'), totalModelCalls: 2 }; });
    const first = processAutomationTask(`${id}_0`, workspaceId), second = processAutomationTask(`${id}_1`, workspaceId);
    for (let tries = 0; tries < 100 && active < 2; tries++) await new Promise(resolve => setTimeout(resolve, 5));
    await processAutomationTask(`${id}_2`, workspaceId);
    expect(maximum).toBe(2);
    const reserved = (await fixture.pool!.query(`SELECT sum(model_reserved)::int AS reserved FROM nexus_automation_jobs WHERE parent_id=$1`, [id])).rows[0].reserved;
    expect(reserved).toBeLessThanOrEqual(10);
    release(); await Promise.all([first, second]);
  });
  it('honors the smaller workspace concurrency policy', async () => {
    await fixture.pool!.query(`INSERT INTO nexus_automation_policies VALUES($1,1)`, [workspaceId]);
    const waiting = await executeAutomationBatch(runtime('logic.map_subflow', { concurrency: 5 }));
    expect((await fixture.pool!.query('SELECT concurrency FROM nexus_automation_jobs WHERE id=$1', [waiting.output!.invocationId])).rows[0].concurrency).toBe(1);
  });
  it('collects partial errors without hiding results', async () => {
    const input = runtime('logic.map_subflow', { errorMode: 'collect' }), waiting = await executeAutomationBatch(input), id = String(waiting.output!.invocationId);
    fixture.run.mockImplementation(async (value: { executionId: string }) => execution(value.executionId, value.executionId.endsWith('_1') ? 'failed' : 'completed'));
    for (const index of [0, 1, 2]) await processAutomationTask(`${id}_${index}`, workspaceId);
    await processAutomationTask(id, workspaceId); input.execution.nodeResults.map = waiting;
    const result = await executeAutomationBatch(input);
    expect(result.status).toBe('success');
    expect((result.output!.items as Array<{ status: string }>).map(item => item.status)).toEqual(['completed', 'failed', 'completed']);
  });
  it('stops dispatching new items after the first failure', async () => {
    const input = runtime(), waiting = await executeAutomationBatch(input), id = String(waiting.output!.invocationId);
    fixture.run.mockImplementation(async (value: { executionId: string }) => execution(value.executionId, 'failed'));
    for (const index of [0, 1, 2]) await processAutomationTask(`${id}_${index}`, workspaceId);
    await processAutomationTask(id, workspaceId); input.execution.nodeResults.map = waiting;
    expect((await executeAutomationBatch(input)).status).toBe('error');
    expect(fixture.run).toHaveBeenCalledTimes(1);
  });
  it('binds approval to exact arguments and rejects an altered continuation', async () => {
    const input = runtime('logic.approval', { title: 'Enviar pedido', arguments: {} });
    const pending = await executeApprovalNode(input, { amount: 10 }, 'Enviar pedido');
    expect(pending.status).toBe('waiting');
    const id = String(pending.output!.invocationId);
    await fixture.pool!.query(`UPDATE nexus_automation_approvals SET status='approved' WHERE id=$1`, [id]);
    input.execution.nodeResults.map = pending;
    expect((await executeApprovalNode(input, { amount: 10 }, 'Enviar pedido')).selectedOutput).toBe('approved');
    await expect(executeApprovalNode(input, { amount: 11 }, 'Enviar pedido')).rejects.toThrow('mudaram');
  });
  it('expires approval without executing any operation', async () => {
    const input = runtime('logic.approval'); const pending = await executeApprovalNode(input, {}, 'Aprovar'); input.execution.nodeResults.map = pending;
    await fixture.pool!.query(`UPDATE nexus_automation_approvals SET expires_at=clock_timestamp()-interval '1 second'`);
    expect((await executeApprovalNode(input, {}, 'Aprovar')).selectedOutput).toBe('expired');
  });
  it('publishes immutable connector versions and blocks revoked/cross-workspace bindings', async () => {
    const definition = { name: 'Pedidos', approval: 'automatic', http: { method: 'GET', url: 'https://api.example.com/orders' } };
    const first = await saveConnectorDraft(workspaceId, workspaceId, definition); await publishConnector(workspaceId, first.id, first.version);
    const next = await saveConnectorDraft(workspaceId, workspaceId, { ...definition, name: 'Pedidos novos' }, first.id);
    expect(next.version).toBe(2); expect((await loadConnector(workspaceId, first.id, 1)).name).toBe('Pedidos');
    await expect(loadConnector(otherWorkspace, first.id, 1)).rejects.toThrow('publicada');
    await fixture.pool!.query(`UPDATE nexus_connectors SET status='revoked' WHERE id=$1 AND version=1`, [first.id]);
    await expect(loadConnector(workspaceId, first.id, 1)).rejects.toThrow('revogada');
  });
  it('denies browser roles direct access to private automation state', async () => {
    for (const table of ['nexus_automation_jobs', 'nexus_automation_effects', 'nexus_automation_approvals', 'nexus_connectors', 'nexus_workflow_files']) {
      const client = await fixture.pool!.connect();
      try { await client.query('BEGIN'); await client.query('SET LOCAL ROLE authenticated'); await expect(client.query(`SELECT * FROM ${table}`)).rejects.toThrow('permission denied'); } finally { await client.query('ROLLBACK'); client.release(); }
    }
  });
  it('renews OAuth tokens once across concurrent requests and restricts their origin', async () => {
    const id = '50000000-0000-4000-8000-000000000001';
    await fixture.pool!.query(`INSERT INTO nexus_credentials(id,workspace_id,credential_type,encrypted_payload) VALUES($1,$2,'oauth2',$3)`, [id, workspaceId, encryptPayload({ tokenUrl: 'https://auth.example.com/token', allowedOrigin: 'https://api.example.com', clientId: 'client', clientSecret: 'private-secret', refreshToken: 'old-refresh' })]);
    fixture.request.mockImplementation(async () => { await new Promise(resolve => setTimeout(resolve, 30)); return { status: 200, headers: {}, body: Buffer.from('{"access_token":"new-token","refresh_token":"rotated-refresh","expires_in":3600,"token_type":"Bearer"}') }; });
    const signal = new AbortController().signal;
    expect(await Promise.all([resolveNexusOAuthToken(workspaceId, id, 'https://api.example.com', signal), resolveNexusOAuthToken(workspaceId, id, 'https://api.example.com', signal)])).toEqual(['new-token', 'new-token']);
    expect(fixture.request).toHaveBeenCalledTimes(1);
    await expect(resolveNexusOAuthToken(workspaceId, id, 'https://other.example.com', signal)).rejects.toThrow('origem');
    const encrypted = (await fixture.pool!.query('SELECT encrypted_payload FROM nexus_credentials WHERE id=$1', [id])).rows[0].encrypted_payload;
    expect(encrypted).not.toContain('new-token'); expect(decryptPayload(encrypted).refreshToken).toBe('rotated-refresh');
  });
  it('does not repeat a confirmed external write after a checkpoint failure and worker restart', async () => {
    class CrashingPersistence extends InMemoryWorkflowPersistence {
      crash = true;
      override async saveExecution(value: WorkflowExecution, expected: number) {
        if (this.crash && value.nodeResults.http) throw new Error('simulated checkpoint outage');
        return super.saveExecution(value, expected);
      }
    }
    const start = workflowNode('trigger.manual', 'start'), http = workflowNode('integration.http_request', 'http', { permissionScope: 'integrations:http', method: 'POST', url: 'https://api.example.com', outputKey: 'response' }), end = workflowNode('output.end', 'end');
    const workflow = workflowDefinition([start, http, end], [connect(start, 'started', http, 'main'), connect(http, 'success', end, 'main')], { workspaceId });
    const write = vi.fn(async () => ({ selected: { ok: true }, statePatch: { response: { ok: true } } }));
    const registry = createDefaultNodeHandlerRegistry({ executeHttp: write });
    registry.wrapExecutions(async (handler, input) => handler.type === 'integration.http_request' ? executeDurableEffect(workspaceId, `step_${nodeInvocationKey(input)}`, { config: input.node.config, input: input.input }, () => handler.execute(input)) : handler.execute(input));
    const persistence = new CrashingPersistence();
    await expect(new WorkflowExecutor(persistence, registry).start({ workflow, executionId: 'crash-restart', input: {} })).rejects.toThrow('checkpoint');
    expect(write).toHaveBeenCalledTimes(1);
    persistence.crash = false;
    const restored = await new WorkflowExecutor(persistence, registry).runExecution('crash-restart');
    expect(restored.status).toBe('completed'); expect(restored.variables.response).toEqual({ ok: true }); expect(write).toHaveBeenCalledTimes(1);
  });
  it('composes real HTTP orchestration, list filtering and binary file transfer with private metadata', async () => {
    const signal = new AbortController().signal;
    fixture.request.mockResolvedValueOnce({ status: 200, headers: {}, body: Buffer.from('{"items":[{"active":true,"name":"Maria"},{"active":false,"name":"João"}]}') });
    const response = await executeNexusHttpOperation({ workspaceId, config: { method: 'GET', url: 'https://api.example.com/leads', responsePath: 'items' }, runtimeSource: {}, signal });
    expect(executeDataOperation({ operation: 'filter', field: 'active', value: true }, response.selected)).toEqual([{ active: true, name: 'Maria' }]);
    const audio = Buffer.from([0, 255, 128, 7]);
    fixture.request.mockResolvedValueOnce({ status: 200, headers: { 'content-type': 'audio/mpeg' }, body: audio });
    const file = (await executeNexusHttpOperation({ workspaceId, config: { method: 'GET', url: 'https://api.example.com/audio', responseFormat: 'file', fileName: 'voice.mp3' }, runtimeSource: {}, signal })).selected;
    fixture.request.mockResolvedValueOnce({ status: 200, headers: {}, body: Buffer.from('{"accepted":true}') });
    await executeNexusHttpOperation({ workspaceId, config: { method: 'POST', url: 'https://api.example.com/upload', bodyType: 'form-data', body: { file } }, runtimeSource: {}, signal });
    expect(fixture.request.mock.calls[2][0].body.includes(audio)).toBe(true);
    expect((await fixture.pool!.query('SELECT byte_size FROM nexus_workflow_files')).rows[0].byte_size).toBe(audio.length);
  });
  it('correlates early events and never applies a consumed token to a later wait', async () => {
    await fixture.pool!.query(`INSERT INTO workflow_executions(id,workspace_id,status,waiting_reason,resume_token,node_results,current_node_id) VALUES('event-execution',$1,'running','event','token-1',$2,'wait')`, [workspaceId, JSON.stringify({ wait: { output: { resumeEvent: 'paid' } } })]);
    await fixture.pool!.query(`INSERT INTO nexus_automation_events(id,workspace_id,execution_id,event_name,encrypted_payload) VALUES('early-event',$1,'event-execution','paid',$2)`, [workspaceId, encryptPayload({ receipt: 'R42' })]);
    await processAutomationEvents(); expect(fixture.resume).not.toHaveBeenCalled();
    await fixture.pool!.query(`UPDATE workflow_executions SET status='waiting'`);
    await processAutomationEvents(); expect(fixture.resume).toHaveBeenCalledTimes(1);
    expect(fixture.resume.mock.calls[0][0]).toMatchObject({ resume: { resumeToken: 'token-1', input: { receipt: 'R42' } } });
    await fixture.pool!.query(`UPDATE nexus_automation_events SET consumed_at=NULL; UPDATE workflow_executions SET resume_token='token-2'`);
    await processAutomationEvents(); expect(fixture.resume).toHaveBeenCalledTimes(1);
  });
  it('preserves completed children when the parent is cancelled', async () => {
    const waiting = await executeAutomationBatch(runtime()), id = String(waiting.output!.invocationId);
    await processAutomationTask(`${id}_0`, workspaceId);
    fixture.executions.set('parent', execution('parent', 'cancelled'));
    await processAutomationTask(id, workspaceId);
    await processAutomationTask(`${id}_1`, workspaceId);
    const rows = await fixture.pool!.query(`SELECT id,status FROM nexus_automation_jobs WHERE parent_id=$1 ORDER BY id`, [id]);
    expect(rows.rows[0].status).toBe('completed'); expect(rows.rows[1].status).toBe('cancelled'); expect(fixture.run).toHaveBeenCalledTimes(1);
  });
  it('defers a busy execution lock without reserving a second budget', async () => {
    const waiting = await executeAutomationBatch(runtime()), id = String(waiting.output!.invocationId);
    fixture.run.mockRejectedValueOnce(Object.assign(new Error('busy'), { code: 'WORKFLOW_EXECUTION_LOCKED' }));
    await processAutomationTask(`${id}_0`, workspaceId);
    expect((await fixture.pool!.query('SELECT status FROM nexus_automation_jobs WHERE id=$1', [`${id}_0`])).rows[0].status).toBe('waiting');
    await fixture.pool!.query(`UPDATE nexus_automation_jobs SET available_at=clock_timestamp()-interval '1 second' WHERE id=$1`, [`${id}_0`]);
    await processAutomationTask(`${id}_0`, workspaceId);
    const parent = (await fixture.pool!.query('SELECT model_available FROM nexus_automation_jobs WHERE id=$1', [id])).rows[0];
    expect(parent.model_available).toBe(9);
  });
  it('keeps a completed execution when cancellation follows a lost job checkpoint', async () => {
    const waiting = await executeAutomationBatch(runtime()), id = String(waiting.output!.invocationId);
    const childId = `${id}_0`, executionId = `child_${childId}`;
    fixture.executions.set(executionId, { ...execution(executionId, 'completed'), totalModelCalls: 2, totalToolCalls: 3 });
    await fixture.pool!.query(`UPDATE nexus_automation_jobs SET status='cancelled' WHERE id=$1`, [id]);
    await processAutomationTask(childId, workspaceId);
    const child = (await fixture.pool!.query(`SELECT status,encrypted_result FROM nexus_automation_jobs WHERE id=$1`, [childId])).rows[0];
    expect(child.status).toBe('completed');
    expect(decryptPayload(child.encrypted_result)).toMatchObject({ modelCalls: 2, toolCalls: 3 });
    expect(fixture.run).not.toHaveBeenCalled();
  });
  it('does not stop siblings when an obsolete worker has lost its job lease', async () => {
    const waiting = await executeAutomationBatch(runtime()), id = String(waiting.output!.invocationId);
    fixture.run.mockImplementationOnce(async () => {
      await fixture.pool!.query(`UPDATE nexus_automation_jobs SET lease_token='50000000-0000-4000-8000-000000000001' WHERE id=$1`, [`${id}_0`]);
      throw new Error('old worker lost its response');
    });
    await processAutomationTask(`${id}_0`, workspaceId);
    const parent = (await fixture.pool!.query(`SELECT encrypted_payload FROM nexus_automation_jobs WHERE id=$1`, [id])).rows[0];
    expect(decryptPayload(parent.encrypted_payload).stopRequested).not.toBe(true);
    expect((await fixture.pool!.query(`SELECT status FROM nexus_automation_jobs WHERE id=$1`, [`${id}_0`])).rows[0].status).toBe('running');
  });
  it('durably deduplicates webhook ingress and keeps the first pinned payload', async () => {
    const flow = workflowDefinition([workflowNode('trigger.webhook', 'hook')], [], { id: 'nexus:webhook', version: 'release-1', workspaceId });
    const [first, duplicate] = await Promise.all([enqueueWebhookExecution(workspaceId, flow, { body: { lead: 1 } }, 'event-1'), enqueueWebhookExecution(workspaceId, flow, { body: { lead: 1 } }, 'event-1')]);
    expect(first).toBe(duplicate);
    await enqueueWebhookExecution(workspaceId, { ...flow, version: 'release-2' }, { body: { lead: 2 } }, 'event-1');
    const row = (await fixture.pool!.query(`SELECT status,encrypted_payload FROM nexus_automation_jobs WHERE id=$1`, [first])).rows[0];
    expect(row.status).toBe('queued');
    expect(decryptPayload(row.encrypted_payload)).toMatchObject({ version: 'release-1', input: { body: { lead: 1 } } });
    expect(await enqueueWebhookExecution(otherWorkspace, { ...flow, workspaceId: otherWorkspace }, {}, 'event-1')).not.toBe(first);
    expect(fixture.run).not.toHaveBeenCalled();
  });
  it('responds with controlled JSON headers or intact workspace-owned file bytes', async () => {
    const completed = execution('hook', 'completed'), stamp = new Date().toISOString();
    const responseExecution = (body: unknown) => ({ ...completed, executionPath: [{ sequence: 1, nodeId: 'respond', nodeType: 'output.webhook_response', attempt: 1, status: 'success' as const, startedAt: stamp, finishedAt: stamp, durationMs: 1, output: { response: { status: 201, headers: { 'X-Receipt': 'accepted', 'Set-Cookie': 'secret', Authorization: 'secret', 'Content-Type': 'text/html' }, body } } }] });
    const json = await customWebhookResponse(responseExecution({ accepted: true }), workspaceId);
    expect(json?.status).toBe(201); expect(json?.headers.get('X-Receipt')).toBe('accepted');
    expect(json?.headers.get('set-cookie')).toBeNull(); expect(json?.headers.get('authorization')).toBeNull();
    expect(json?.headers.get('content-type')).toContain('application/json'); expect(await json?.json()).toEqual({ accepted: true });
    const bytes = Buffer.from([0, 255, 128, 67]), file = await saveWorkflowFile({ workspaceId, name: 'voz.mp3', mimeType: 'audio/mpeg', data: bytes });
    const binary = await customWebhookResponse(responseExecution(file), workspaceId);
    expect(Buffer.from(await binary!.arrayBuffer())).toEqual(bytes);
    await expect(customWebhookResponse(responseExecution(file), otherWorkspace)).rejects.toThrow();
  });
});
