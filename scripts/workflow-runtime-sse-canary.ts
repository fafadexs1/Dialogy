import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { db } from '../src/lib/db';
import {
  PostgresWorkflowPersistence,
  WorkflowExecutor,
  createDefaultNodeHandlerRegistry,
  createWorkflowNode,
  type WorkflowDefinition,
} from '../src/services/workflow-runtime';

function executor() {
  const persistence = new PostgresWorkflowPersistence(db);
  return new WorkflowExecutor(persistence, createDefaultNodeHandlerRegistry());
}

async function start() {
  const timestamp = new Date().toISOString();
  const suffix = randomUUID().slice(0, 8);
  const trigger = createWorkflowNode('trigger.manual', {
    id: 'trigger',
    name: 'Início SSE',
    position: { x: 0, y: 0 },
  });
  const wait = createWorkflowNode('logic.wait', {
    id: 'wait',
    name: 'Aguardar retomada SSE',
    position: { x: 0, y: 160 },
    config: {
      mode: 'event',
      resumeEvent: 'qa.sse.resume',
      timeoutMs: 120_000,
    },
  });
  const end = createWorkflowNode('output.end', {
    id: 'end',
    name: 'Fim SSE',
    position: { x: 0, y: 320 },
    config: { output: { resumedThroughSseCanary: true } },
  });
  const workflow: WorkflowDefinition = {
    id: `qa-sse-${suffix}`,
    name: 'Live SSE canary',
    version: '1.0.0',
    status: 'published',
    nodes: [trigger, wait, end],
    connections: [{
      id: 'trigger-wait',
      sourceNodeId: trigger.id,
      sourcePortId: 'started',
      targetNodeId: wait.id,
      targetPortId: 'main',
      connectionType: 'main',
    }, {
      id: 'wait-end',
      sourceNodeId: wait.id,
      sourcePortId: 'resumed',
      targetNodeId: end.id,
      targetPortId: 'main',
      connectionType: 'main',
    }],
    settings: {
      executionTimeoutMs: 120_000,
      maxSteps: 10,
      maxModelCalls: 0,
      maxToolCalls: 0,
      maxAgentTurnsPerNode: 1,
      maxRepeatedDecisionSignatures: 2,
      maxTotalInputTokens: 0,
      maxTotalOutputTokens: 0,
      concurrencyLimit: 1,
    },
    metadata: {
      source: 'live_sse_canary',
      retainedForAudit: true,
    },
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const execution = await executor().start({
    workflow,
    input: { source: 'browser_sse_acceptance_canary' },
  });
  if (execution.status !== 'waiting' || !execution.resumeToken) {
    throw new Error(`Expected a waiting execution, received ${execution.status}.`);
  }
  return {
    action: 'start',
    executionId: execution.executionId,
    resumeToken: execution.resumeToken,
    status: execution.status,
  };
}

async function resume(resumeToken: string) {
  if (!resumeToken) throw new Error('A resume token is required.');
  const execution = await executor().resume({
    resumeToken,
    input: { approved: true, source: 'browser_sse_acceptance_canary' },
  });
  if (execution.status !== 'completed') {
    throw new Error(`Expected a completed execution, received ${execution.status}.`);
  }
  return {
    action: 'resume',
    executionId: execution.executionId,
    status: execution.status,
    totalSteps: execution.totalSteps,
  };
}

async function main() {
  const [command = 'start', argument = ''] = process.argv.slice(2);
  const result = command === 'resume'
    ? await resume(argument)
    : await start();
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

main()
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.end();
  });
