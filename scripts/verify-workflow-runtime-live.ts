import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { db } from '../src/lib/db';
import {
  PostgresWorkflowPersistence,
  WorkflowEventBus,
  WorkflowExecutor,
  createDefaultNodeHandlerRegistry,
  createWorkflowNode,
  type WorkflowConnection,
  type WorkflowDefinition,
  type WorkflowNode,
} from '../src/services/workflow-runtime';

type Check = {
  name: string;
  passed: boolean;
  details: Record<string, unknown>;
};

const REQUIRED_TABLES = [
  'workflow_definitions',
  'workflow_executions',
  'workflow_node_runs',
  'workflow_tool_calls',
  'workflow_events',
  'workflow_model_capabilities',
] as const;

function connect(
  source: WorkflowNode,
  sourcePortId: string,
  target: WorkflowNode,
  targetPortId: string,
  id = `${source.id}_${sourcePortId}_${target.id}_${targetPortId}`,
): WorkflowConnection {
  return {
    id,
    sourceNodeId: source.id,
    sourcePortId,
    targetNodeId: target.id,
    targetPortId,
    connectionType: 'main',
  };
}

function definition(
  id: string,
  nodes: WorkflowNode[],
  connections: WorkflowConnection[],
): WorkflowDefinition {
  const timestamp = new Date().toISOString();
  return {
    id,
    name: `Live canary ${id}`,
    version: '1.0.0',
    status: 'published',
    nodes,
    connections,
    settings: {
      executionTimeoutMs: 30_000,
      maxSteps: 100,
      maxModelCalls: 0,
      maxToolCalls: 0,
      maxAgentTurnsPerNode: 1,
      maxRepeatedDecisionSignatures: 2,
      maxTotalInputTokens: 0,
      maxTotalOutputTokens: 0,
      concurrencyLimit: 1,
    },
    metadata: {
      source: 'live_canary',
      retainedForAudit: true,
    },
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function createExecutor() {
  const persistence = new PostgresWorkflowPersistence(db);
  const handlers = createDefaultNodeHandlerRegistry();
  return {
    executor: new WorkflowExecutor(persistence, handlers),
    persistence,
  };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function verifyTables(): Promise<Check> {
  const result = await db.query<{ table_name: string }>(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name = ANY($1::text[])
     ORDER BY table_name`,
    [REQUIRED_TABLES],
  );
  const found = result.rows.map((row) => row.table_name);
  const missing = REQUIRED_TABLES.filter((table) => !found.includes(table));
  return {
    name: 'required_tables',
    passed: missing.length === 0,
    details: { found, missing },
  };
}

async function verifyIfRouting(runId: string): Promise<Check> {
  const trigger = createWorkflowNode('trigger.manual', {
    id: 'trigger',
    name: 'Manual',
    position: { x: 0, y: 0 },
  });
  const condition = createWorkflowNode('logic.if', {
    id: 'condition',
    name: 'Flag ativa?',
    position: { x: 0, y: 160 },
    config: {
      left: '$.input.flag',
      operator: 'equals',
      right: true,
    },
  });
  const trueEnd = createWorkflowNode('output.end', {
    id: 'true-end',
    name: 'Fim verdadeiro',
    position: { x: -120, y: 320 },
    config: { output: { route: 'true' } },
  });
  const falseEnd = createWorkflowNode('output.end', {
    id: 'false-end',
    name: 'Fim falso',
    position: { x: 120, y: 320 },
    config: { output: { route: 'false' } },
  });
  const workflow = definition(
    `qa-if-${runId}`,
    [trigger, condition, trueEnd, falseEnd],
    [
      connect(trigger, 'started', condition, 'main'),
      connect(condition, 'true', trueEnd, 'main'),
      connect(condition, 'false', falseEnd, 'main'),
    ],
  );
  const { executor, persistence } = createExecutor();
  const trueExecution = await executor.start({
    workflow,
    input: { flag: true, source: 'browser_acceptance_canary' },
  });
  const falseExecution = await executor.start({
    workflow,
    input: { flag: false, source: 'browser_acceptance_canary' },
  });
  const trueEvents = await persistence.listEvents(trueExecution.executionId);
  const falseEvents = await persistence.listEvents(falseExecution.executionId);
  const nodeRuns = await db.query<{ execution_id: string; count: number }>(
    `SELECT execution_id, COUNT(*)::int AS count
     FROM workflow_node_runs
     WHERE execution_id = ANY($1::text[])
     GROUP BY execution_id`,
    [[trueExecution.executionId, falseExecution.executionId]],
  );
  const nodeRunCounts = new Map(
    nodeRuns.rows.map((row) => [row.execution_id, Number(row.count)]),
  );
  assert(
    trueExecution.status === 'completed',
    `True execution did not complete: ${JSON.stringify({
      executionId: trueExecution.executionId,
      status: trueExecution.status,
      failure: trueExecution.failure,
      path: trueExecution.executionPath,
    })}`,
  );
  assert(
    falseExecution.status === 'completed',
    `False execution did not complete: ${JSON.stringify({
      executionId: falseExecution.executionId,
      status: falseExecution.status,
      failure: falseExecution.failure,
      path: falseExecution.executionPath,
    })}`,
  );
  assert(trueExecution.previousNodeId === 'true-end', 'True route selected the wrong terminal node.');
  assert(falseExecution.previousNodeId === 'false-end', 'False route selected the wrong terminal node.');
  assert(trueEvents.at(-1)?.type === 'execution.completed', 'True execution event stream is incomplete.');
  assert(falseEvents.at(-1)?.type === 'execution.completed', 'False execution event stream is incomplete.');
  assert(
    nodeRunCounts.get(trueExecution.executionId) === 3,
    'True execution node runs were not normalized into workflow_node_runs.',
  );
  assert(
    nodeRunCounts.get(falseExecution.executionId) === 3,
    'False execution node runs were not normalized into workflow_node_runs.',
  );
  return {
    name: 'if_true_false_persisted',
    passed: true,
    details: {
      trueExecutionId: trueExecution.executionId,
      falseExecutionId: falseExecution.executionId,
      trueEventCount: trueEvents.length,
      falseEventCount: falseEvents.length,
      trueNodeRunCount: nodeRunCounts.get(trueExecution.executionId),
      falseNodeRunCount: nodeRunCounts.get(falseExecution.executionId),
    },
  };
}

async function verifyRestartResume(runId: string): Promise<Check> {
  const trigger = createWorkflowNode('trigger.manual', {
    id: 'trigger',
    name: 'Manual',
    position: { x: 0, y: 0 },
  });
  const wait = createWorkflowNode('logic.wait', {
    id: 'wait',
    name: 'Aguardar aprovação',
    position: { x: 0, y: 160 },
    config: {
      mode: 'event',
      resumeEvent: 'qa.approved',
      timeoutMs: 30_000,
    },
  });
  const end = createWorkflowNode('output.end', {
    id: 'end',
    name: 'Fim',
    position: { x: 0, y: 320 },
    config: { output: { resumed: true } },
  });
  const workflow = definition(
    `qa-resume-${runId}`,
    [trigger, wait, end],
    [
      connect(trigger, 'started', wait, 'main'),
      connect(wait, 'resumed', end, 'main'),
    ],
  );
  const firstRuntime = createExecutor();
  const waiting = await firstRuntime.executor.start({
    workflow,
    input: { request: 'real persistence restart check' },
  });
  assert(waiting.status === 'waiting', 'Execution was not persisted as waiting.');
  assert(waiting.resumeToken, 'Waiting execution has no resume token.');

  // A new executor and persistence instance emulate a process restart. No in-memory
  // object from the first runtime is reused to locate or resume this execution.
  const restartedRuntime = createExecutor();
  const resumed = await restartedRuntime.executor.resume({
    resumeToken: waiting.resumeToken,
    input: { approved: true, actor: 'live_canary' },
  });
  const reloaded = await restartedRuntime.persistence.getExecution(waiting.executionId);
  const events = await restartedRuntime.persistence.listEvents(waiting.executionId);
  const nodeRuns = await db.query<{ count: number }>(
    'SELECT COUNT(*)::int AS count FROM workflow_node_runs WHERE execution_id = $1',
    [waiting.executionId],
  );
  assert(resumed.status === 'completed', 'Restarted runtime did not complete the execution.');
  assert(reloaded?.status === 'completed', 'Completed status was not persisted after resume.');
  assert(events.some((event) => event.type === 'execution.waiting'), 'Waiting event was not persisted.');
  assert(events.at(-1)?.type === 'execution.completed', 'Resume event stream did not finish.');
  assert(Number(nodeRuns.rows[0]?.count) === 3, 'Resumed node runs were not persisted.');
  return {
    name: 'resume_after_runtime_restart',
    passed: true,
    details: {
      executionId: waiting.executionId,
      eventCount: events.length,
      nodeRunCount: Number(nodeRuns.rows[0]?.count),
      finalVersion: reloaded?.version,
    },
  };
}

async function verifyParallelMerge(runId: string): Promise<Check> {
  const trigger = createWorkflowNode('trigger.manual', {
    id: 'trigger',
    name: 'Manual',
    position: { x: 0, y: 0 },
  });
  const parallel = createWorkflowNode('logic.parallel', {
    id: 'parallel',
    name: 'Executar ramos',
    position: { x: 0, y: 120 },
    config: { outputs: ['branches'], joinMode: 'wait_all' },
  });
  const branchA = createWorkflowNode('data.set', {
    id: 'branch-a',
    name: 'Ramo A',
    position: { x: -140, y: 260 },
    config: { assignments: { branchA: 'completed' } },
  });
  const branchB = createWorkflowNode('data.set', {
    id: 'branch-b',
    name: 'Ramo B',
    position: { x: 140, y: 260 },
    config: { assignments: { branchB: 'completed' } },
  });
  const merge = createWorkflowNode('logic.merge', {
    id: 'merge',
    name: 'Unir ramos',
    position: { x: 0, y: 420 },
    config: { mode: 'wait_all' },
  });
  const end = createWorkflowNode('output.end', {
    id: 'end',
    name: 'Fim',
    position: { x: 0, y: 560 },
  });
  const workflow = definition(
    `qa-parallel-${runId}`,
    [trigger, parallel, branchA, branchB, merge, end],
    [
      connect(trigger, 'started', parallel, 'main'),
      connect(parallel, 'branches', branchA, 'main', 'parallel-a'),
      connect(parallel, 'branches', branchB, 'main', 'parallel-b'),
      connect(branchA, 'success', merge, 'branches', 'a-merge'),
      connect(branchB, 'success', merge, 'branches', 'b-merge'),
      connect(merge, 'success', end, 'main'),
    ],
  );
  const { executor, persistence } = createExecutor();
  const execution = await executor.start({ workflow, input: { runId } });
  const events = await persistence.listEvents(execution.executionId);
  const nodeRuns = await db.query<{ count: number }>(
    'SELECT COUNT(*)::int AS count FROM workflow_node_runs WHERE execution_id = $1',
    [execution.executionId],
  );
  assert(execution.status === 'completed', 'Parallel execution did not complete.');
  assert(execution.variables.branchA === 'completed', 'Branch A state was not merged.');
  assert(execution.variables.branchB === 'completed', 'Branch B state was not merged.');
  assert(
    Boolean(execution.nodeResults.merge?.output?.branches),
    'Merge did not retain branch outputs.',
  );
  assert(Number(nodeRuns.rows[0]?.count) === 6, 'Parallel node runs were not persisted.');
  return {
    name: 'parallel_merge_persisted',
    passed: true,
    details: {
      executionId: execution.executionId,
      executionPath: execution.executionPath.map((step) => step.nodeId),
      eventCount: events.length,
      nodeRunCount: Number(nodeRuns.rows[0]?.count),
    },
  };
}

async function verifyLockAndCancellation(runId: string): Promise<Check> {
  const trigger = createWorkflowNode('trigger.manual', {
    id: 'trigger',
    name: 'Manual',
    position: { x: 0, y: 0 },
  });
  const wait = createWorkflowNode('logic.wait', {
    id: 'wait',
    name: 'Aguardar',
    position: { x: 0, y: 160 },
    config: { mode: 'event', resumeEvent: 'qa.cancel', timeoutMs: 30_000 },
  });
  const end = createWorkflowNode('output.end', {
    id: 'end',
    name: 'Fim',
    position: { x: 0, y: 320 },
  });
  const workflow = definition(
    `qa-lock-${runId}`,
    [trigger, wait, end],
    [
      connect(trigger, 'started', wait, 'main'),
      connect(wait, 'resumed', end, 'main'),
    ],
  );
  const { executor, persistence } = createExecutor();
  const waiting = await executor.start({ workflow, input: { runId } });
  const workerA = await persistence.acquireExecutionLock(waiting.executionId, 'qa-worker-a', 30_000);
  const workerB = await persistence.acquireExecutionLock(waiting.executionId, 'qa-worker-b', 30_000);
  assert(workerA, 'Worker A did not acquire the execution lock.');
  assert(workerB === null, 'Worker B acquired an execution already locked by worker A.');
  await persistence.releaseExecutionLock(waiting.executionId, 'qa-worker-a');
  const cancelled = await executor.cancel(waiting.executionId, 'Live canary cancellation');
  const events = await persistence.listEvents(waiting.executionId);
  assert(cancelled.status === 'cancelled', 'Cancellation was not persisted.');
  assert(events.at(-1)?.type === 'execution.cancelled', 'Cancellation event was not persisted.');
  return {
    name: 'exclusive_lock_and_cancellation',
    passed: true,
    details: {
      executionId: waiting.executionId,
      competingWorkerRejected: workerB === null,
      finalStatus: cancelled.status,
    },
  };
}

async function verifyEventRedaction(runId: string): Promise<Check> {
  const workflowId = `qa-redaction-${runId}`;
  const trigger = createWorkflowNode('trigger.manual', {
    id: 'trigger',
    name: 'Manual',
    position: { x: 0, y: 0 },
  });
  const end = createWorkflowNode('output.end', {
    id: 'end',
    name: 'Fim',
    position: { x: 0, y: 160 },
  });
  const workflow = definition(
    workflowId,
    [trigger, end],
    [connect(trigger, 'started', end, 'main')],
  );
  const { executor, persistence } = createExecutor();
  const execution = await executor.start({ workflow, input: { runId } });
  const eventBus = new WorkflowEventBus(persistence);
  await eventBus.publish({
    executionId: execution.executionId,
    workflowId,
    type: 'message.delta',
    safeSummary: 'Redaction canary',
    data: {
      apiKey: 'must-not-be-persisted',
      nested: { accessToken: 'must-not-be-persisted', safe: 'visible' },
    },
  });
  const events = await persistence.listEvents(execution.executionId);
  const event = events.find((candidate) => candidate.safeSummary === 'Redaction canary');
  assert(event?.data?.apiKey === '[REDACTED]', 'API key was persisted without redaction.');
  assert(
    (event?.data?.nested as Record<string, unknown> | undefined)?.accessToken === '[REDACTED]',
    'Nested token was persisted without redaction.',
  );
  return {
    name: 'durable_event_redaction',
    passed: true,
    details: {
      executionId: execution.executionId,
      safeFieldPreserved:
        (event?.data?.nested as Record<string, unknown> | undefined)?.safe === 'visible',
    },
  };
}

async function main() {
  const runId = `${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}-${randomUUID().slice(0, 8)}`;
  const checks: Check[] = [];
  checks.push(await verifyTables());
  assert(checks[0]?.passed, `Required tables are missing: ${JSON.stringify(checks[0]?.details)}`);
  checks.push(await verifyIfRouting(runId));
  checks.push(await verifyRestartResume(runId));
  checks.push(await verifyParallelMerge(runId));
  checks.push(await verifyLockAndCancellation(runId));
  checks.push(await verifyEventRedaction(runId));

  const result = {
    runId,
    database: 'configured DATABASE_URL',
    mode: 'live_postgresql_no_mocks',
    passed: checks.every((check) => check.passed),
    checks,
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main()
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.end();
  });
