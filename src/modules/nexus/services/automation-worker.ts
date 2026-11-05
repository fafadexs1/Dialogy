import 'server-only';
import { randomUUID } from 'node:crypto';
import { db } from '@/lib/db';
import { PostgresWorkflowPersistence } from '@/services/workflow-runtime/postgres-persistence';
import { decryptPayload, encryptPayload } from './credentials';
import type { BatchTask } from './automation-batches';
import { isAutomationToolboxEnabled } from './toolbox-policy';
import { cancelPublishedNexusWorkflowExecution, runPersistedNexusExecution, resumePublishedNexusWorkflow, terminalNexusOutput } from './runtime';
import type { WorkflowExecution } from '@/services/workflow-runtime/types';

async function defer(id: string, token: string, status = 'waiting') {
  await db.query(`UPDATE nexus_automation_jobs SET status=$3,lease_until=NULL,lease_token=NULL,available_at=clock_timestamp()+interval '2 seconds',updated_at=clock_timestamp() WHERE id=$1 AND lease_token=$2`, [id, token, status]);
}

/** Claims are atomic across the Nexus poller and the existing BullMQ worker. */
export async function processAutomationTask(id: string, workspaceId: string): Promise<void> {
  if (!isAutomationToolboxEnabled(workspaceId)) return;
  const token = randomUUID();
  const claimed = await db.query(`UPDATE nexus_automation_jobs SET lease_token=$3,lease_until=clock_timestamp()+interval '90 seconds',attempts=attempts+1,updated_at=clock_timestamp()
    WHERE id=$1 AND workspace_id=$2 AND status IN ('queued','running','waiting') AND (lease_until IS NULL OR lease_until<clock_timestamp()) AND available_at<=clock_timestamp() RETURNING *`, [id, workspaceId, token]);
  const row = claimed.rows[0];
  if (!row) return;
  const heartbeat = setInterval(() => { void db.query(`UPDATE nexus_automation_jobs SET lease_until=clock_timestamp()+interval '90 seconds' WHERE id=$1 AND lease_token=$2`, [id, token]).catch(() => undefined); }, 20000);
  heartbeat.unref?.();
  try {
    if (row.kind === 'batch') {
      const parent = await new PostgresWorkflowPersistence(db).getExecution(String(row.execution_id));
      if (!parent || ['failed', 'cancelled'].includes(parent.status)) {
        await db.query(`UPDATE nexus_automation_jobs SET status='cancelled',lease_until=NULL WHERE id=$1 AND lease_token=$2`, [id, token]);
        return;
      }
      const payload = decryptPayload(String(row.encrypted_payload));
      const children = await db.query(`SELECT status,encrypted_result,encrypted_payload,execution_id FROM nexus_automation_jobs WHERE workspace_id=$1 AND parent_id=$2`, [workspaceId, id]);
      const unfinished = children.rows.some(child => ['queued', 'running', 'waiting'].includes(child.status));
      if (unfinished) { await defer(id, token); return; }
      const items = children.rows.map(child => ({ index: Number(decryptPayload(String(child.encrypted_payload)).ordinal), executionId: String(child.execution_id), status: child.status, ...decryptPayload(String(child.encrypted_result || encryptPayload({ error: 'Execução interrompida.' }))) })).sort((a, b) => a.index - b.index);
      const failed = items.some(item => item.status !== 'completed');
      const result = { items, modelCalls: items.reduce((sum, item) => sum + Number((item as Record<string, unknown>).modelCalls || 0), 0), toolCalls: items.reduce((sum, item) => sum + Number((item as Record<string, unknown>).toolCalls || 0), 0) };
      await db.query(`UPDATE nexus_automation_jobs SET status=$3,encrypted_result=$4,lease_until=NULL,lease_token=NULL WHERE id=$1 AND lease_token=$2`, [id, token, failed && payload.errorMode !== 'collect' ? 'failed' : 'completed', encryptPayload(result)]);
      return;
    }
    let payload = decryptPayload(String(row.encrypted_payload));
    let execution: WorkflowExecution;
    if (row.kind === 'child') {
      const client = await db.connect();
      let released = false;
      let task: BatchTask;
      let stopRequested = false;
      try {
        await client.query('BEGIN');
        const parentRow = (await client.query(`SELECT * FROM nexus_automation_jobs WHERE workspace_id=$1 AND id=$2 FOR UPDATE`, [workspaceId, row.parent_id])).rows[0];
        if (!parentRow || ['failed', 'cancelled', 'uncertain'].includes(parentRow.status)) {
          await client.query('COMMIT');
          client.release(); released = true;
          const running = await new PostgresWorkflowPersistence(db).getExecution(String(row.execution_id));
          const stopped = running && !['completed', 'failed', 'cancelled'].includes(running.status)
            ? await cancelPublishedNexusWorkflowExecution({ workspaceId, executionId: running.executionId, reason: 'Execução pai interrompida.' }) : running;
          await db.query(`UPDATE nexus_automation_jobs SET status=$3,encrypted_result=$4,lease_until=NULL,lease_token=NULL WHERE id=$1 AND lease_token=$2`, [id, token,
            stopped?.status === 'completed' ? 'completed' : stopped?.status === 'failed' ? 'failed' : 'cancelled',
            encryptPayload({ ...(stopped ? { output: terminalNexusOutput(stopped) } : {}), modelCalls: stopped?.totalModelCalls || 0, toolCalls: stopped?.totalToolCalls || 0, ...(stopped?.status === 'completed' ? {} : { error: 'Execução pai interrompida.' }) })]);
          return;
        }
        const group = decryptPayload(String(parentRow.encrypted_payload));
        stopRequested = group.stopRequested === true;
        if (group.stopRequested === true && !row.budget_reserved) {
          await client.query(`UPDATE nexus_automation_jobs SET status='cancelled',encrypted_result=$3,lease_until=NULL,lease_token=NULL WHERE id=$1 AND lease_token=$2`, [id, token, encryptPayload({ error: 'Interrompido após a falha de outro item.', modelCalls: 0, toolCalls: 0 })]);
          await client.query('COMMIT');
          return;
        }
        task = (group.tasks as BatchTask[])[Number(payload.ordinal)]!;
        if (!task) throw new Error('Item de subfluxo indisponível.');
        payload = { ...payload, task, sessionId: group.sessionId, conversationId: group.conversationId };
        if (!row.budget_reserved) {
          const active = Number((await client.query(`SELECT count(*)::int AS count FROM nexus_automation_jobs WHERE parent_id=$1 AND budget_reserved AND status IN ('running','waiting')`, [row.parent_id])).rows[0]?.count || 0);
          if (active >= Number(parentRow.concurrency) || (active > 0 && ((task.modelCap > 0 && parentRow.model_available === 0) || (task.toolCap > 0 && parentRow.tool_available === 0)))) {
            await client.query('COMMIT'); await defer(id, token, 'queued'); return;
          }
          const models = Math.min(task.modelCap, Number(parentRow.model_available)), tools = Math.min(task.toolCap, Number(parentRow.tool_available));
          await client.query(`UPDATE nexus_automation_jobs SET model_available=model_available-$2,tool_available=tool_available-$3 WHERE id=$1`, [row.parent_id, models, tools]);
          await client.query(`UPDATE nexus_automation_jobs SET budget_reserved=true,model_reserved=$3,tool_reserved=$4,status='running' WHERE id=$1 AND lease_token=$2`, [id, token, models, tools]);
          row.model_reserved = models; row.tool_reserved = tools;
        }
        await client.query('COMMIT');
      } catch (error) { if (!released) await client.query('ROLLBACK'); throw error; } finally { if (!released) client.release(); }
      if (stopRequested) {
        const previous = await new PostgresWorkflowPersistence(db).getExecution(String(row.execution_id));
        if (!previous) {
          await db.query(`UPDATE nexus_automation_jobs SET status='cancelled',encrypted_result=$3,lease_token=NULL,lease_until=NULL WHERE id=$1 AND lease_token=$2`, [id, token, encryptPayload({ modelCalls: 0, toolCalls: 0, error: 'Interrompido antes de iniciar.' })]);
          return;
        }
        execution = ['completed', 'failed', 'cancelled'].includes(previous.status) ? previous : await cancelPublishedNexusWorkflowExecution({ workspaceId, executionId: previous.executionId, reason: 'Outro item falhou.' });
        if (previous.status === 'running') execution = { ...execution, totalModelCalls: Math.max(execution.totalModelCalls, Number(row.model_reserved)), totalToolCalls: Math.max(execution.totalToolCalls, Number(row.tool_reserved)) };
      } else execution = await runPersistedNexusExecution({ workspaceId, workflowId: task.workflowId, version: task.version, executionId: String(row.execution_id), input: task.input, context: task.context, sessionId: typeof payload.sessionId === 'string' ? payload.sessionId : undefined, conversationId: typeof payload.conversationId === 'string' ? payload.conversationId : undefined,
        limits: { maxModelCalls: Number(row.model_reserved), maxToolCalls: Number(row.tool_reserved), executionTimeoutMs: task.timeoutMs } });
    } else {
      execution = await runPersistedNexusExecution({ workspaceId, workflowId: String(payload.workflowId), version: String(payload.version), executionId: String(row.execution_id), input: payload.input as Record<string, unknown>, context: { source: row.kind === 'scheduled' ? 'agent_schedule' : 'webhook', automationManaged: true }, conversationId: typeof payload.conversationId === 'string' ? payload.conversationId : undefined });
    }
    if (!['completed', 'failed', 'cancelled'].includes(execution.status)) { await defer(id, token); return; }
    const result = { output: terminalNexusOutput(execution), error: execution.failure?.message, modelCalls: execution.totalModelCalls, toolCalls: execution.totalToolCalls };
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const settled = await client.query(`UPDATE nexus_automation_jobs SET status=$3,encrypted_result=$4,lease_until=NULL,lease_token=NULL WHERE id=$1 AND lease_token=$2 RETURNING *`, [id, token, execution.status, encryptPayload(result)]);
      if (settled.rowCount && row.parent_id) {
        await client.query(`UPDATE nexus_automation_jobs SET model_available=model_available+$2,tool_available=tool_available+$3 WHERE id=$1`, [row.parent_id, Math.max(0, Number(row.model_reserved) - execution.totalModelCalls), Math.max(0, Number(row.tool_reserved) - execution.totalToolCalls)]);
        const group = decryptPayload(String((await client.query(`SELECT encrypted_payload FROM nexus_automation_jobs WHERE id=$1 FOR UPDATE`, [row.parent_id])).rows[0]?.encrypted_payload));
        if (execution.status !== 'completed' && group.errorMode !== 'collect') await client.query(`UPDATE nexus_automation_jobs SET encrypted_payload=$2 WHERE id=$1`, [row.parent_id, encryptPayload({ ...group, stopRequested: true })]);
      }
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && ['WORKFLOW_EXECUTION_LOCKED', 'WORKFLOW_OPTIMISTIC_LOCK_CONFLICT'].includes(String(error.code))) { await defer(id, token); return; }
    if (row.kind === 'batch') { await defer(id, token); return; }
    // Intents persisted before side effects protect against replay after a worker crash.
    const uncertain = await db.query(`UPDATE nexus_automation_jobs SET status='uncertain',encrypted_result=$3,lease_until=NULL,lease_token=NULL WHERE id=$1 AND lease_token=$2`, [id, token, encryptPayload({ error: 'Resultado incerto. Inspecione a execução antes de repetir.', modelCalls: Number(row.model_reserved || 0), toolCalls: Number(row.tool_reserved || 0) })]);
    if (uncertain.rowCount && row.parent_id) {
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        const parent = (await client.query(`SELECT encrypted_payload FROM nexus_automation_jobs WHERE id=$1 AND workspace_id=$2 FOR UPDATE`, [row.parent_id, workspaceId])).rows[0];
        if (parent) { const group = decryptPayload(String(parent.encrypted_payload)); if (group.errorMode !== 'collect') await client.query(`UPDATE nexus_automation_jobs SET encrypted_payload=$2 WHERE id=$1`, [row.parent_id, encryptPayload({ ...group, stopRequested: true })]); }
        await client.query('COMMIT');
      } catch (failure) { await client.query('ROLLBACK'); throw failure; } finally { client.release(); }
    }
  } finally { clearInterval(heartbeat); }
}

let polling = false;
let lastCleanup = 0;
export async function processAutomationEvents() {
  const pending = await db.query(`SELECT v.id,v.workspace_id,v.execution_id,v.encrypted_payload,v.resume_token AS bound_token,e.resume_token
    FROM nexus_automation_events v JOIN workflow_executions e ON e.id=v.execution_id AND e.workspace_id=v.workspace_id
    WHERE v.consumed_at IS NULL AND ((v.resume_token IS NOT NULL AND v.resume_token IS DISTINCT FROM e.resume_token) OR
      (e.status='waiting' AND e.waiting_reason='event' AND e.node_results->e.current_node_id->'output'->>'resumeEvent'=v.event_name)) ORDER BY v.created_at LIMIT 50`);
  for (const row of pending.rows) {
    if (!isAutomationToolboxEnabled(String(row.workspace_id))) continue;
    if (row.bound_token && row.bound_token !== row.resume_token) { await db.query(`UPDATE nexus_automation_events SET consumed_at=clock_timestamp() WHERE id=$1`, [row.id]); continue; }
    const bound = await db.query(`UPDATE nexus_automation_events SET resume_token=$2 WHERE id=$1 AND consumed_at IS NULL AND (resume_token IS NULL OR resume_token=$2) RETURNING id`, [row.id, row.resume_token]);
    if (!bound.rowCount) continue;
    try {
      await resumePublishedNexusWorkflow({ workspaceId: String(row.workspace_id), resume: { resumeToken: String(row.resume_token), input: decryptPayload(String(row.encrypted_payload)) } });
      await db.query(`UPDATE nexus_automation_events SET consumed_at=clock_timestamp() WHERE id=$1`, [row.id]);
    } catch { /* The bound token prevents applying this event to a later wait after recovery. */ }
  }
}
export async function pollAutomationTasks() {
  if (polling) return;
  polling = true;
  try {
    const exists = await db.query(`SELECT to_regclass('public.nexus_automation_jobs') AS name`);
    if (!exists.rows[0]?.name) return;
    await processAutomationEvents();
    if (Date.now() - lastCleanup > 3600000) {
      lastCleanup = Date.now();
      await (await import('./workflow-files')).purgeExpiredWorkflowFiles().catch(() => undefined);
    }
    const due = await db.query(`SELECT id,workspace_id FROM nexus_automation_jobs WHERE status IN ('queued','running','waiting') AND available_at<=clock_timestamp() AND (lease_until IS NULL OR lease_until<clock_timestamp()) ORDER BY available_at LIMIT 25`);
    // Existing queue workers may claim the same outbox safely; polling also recovers lost enqueues.
    const { enqueueJob, shouldEnqueueJob } = await import('@/lib/queue');
    await Promise.allSettled(due.rows.map(async row => {
      if (!isAutomationToolboxEnabled(String(row.workspace_id))) return;
      if (shouldEnqueueJob('nexus_workflow')) {
        await enqueueJob('nexus_workflow', { workspaceId: String(row.workspace_id), automationJobId: String(row.id) }, { jobId: `${String(row.id)}_${Math.floor(Date.now() / 2000)}`, maxAttempts: 1 });
      } else await processAutomationTask(String(row.id), String(row.workspace_id));
    }));
    const wake = await db.query(`SELECT e.id,e.workspace_id,e.resume_token,e.waiting_reason FROM workflow_executions e WHERE e.status='waiting' AND e.workflow_id LIKE 'nexus:%' AND (
      ((e.waiting_reason='time' OR e.node_results->e.current_node_id->'output'->>'expireWait'='true') AND (e.node_results->e.current_node_id->'output'->>'expiresAt')::timestamptz<=clock_timestamp()) OR
      EXISTS(SELECT 1 FROM nexus_automation_jobs j WHERE j.workspace_id=e.workspace_id AND j.execution_id=e.id AND j.kind='batch' AND j.status IN ('completed','failed','uncertain') AND e.resume_token='batch_'||j.id) OR
      EXISTS(SELECT 1 FROM nexus_automation_approvals a WHERE a.workspace_id=e.workspace_id AND a.execution_id=e.id AND a.resume_token=e.resume_token AND (a.status<>'pending' OR a.expires_at<=clock_timestamp()))
    ) ORDER BY e.updated_at LIMIT 50`);
    for (const row of wake.rows) {
      if (!isAutomationToolboxEnabled(String(row.workspace_id))) continue;
      try {
        if (['time', 'event'].includes(String(row.waiting_reason))) await runPersistedNexusExecution({ workspaceId: String(row.workspace_id), executionId: String(row.id) });
        else await resumePublishedNexusWorkflow({ workspaceId: String(row.workspace_id), resume: { resumeToken: String(row.resume_token), input: {} } });
      } catch { /* Another worker may own or have resumed this execution. */ }
    }
  } finally { polling = false; }
}
