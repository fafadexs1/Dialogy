import 'server-only';
import { BatchConfigSchema } from '@/services/workflow-runtime/toolbox-validation';
import { db } from '@/lib/db';
import { PostgresWorkflowPersistence } from '@/services/workflow-runtime/postgres-persistence';
import { effectiveWorkflowLimits } from '@/services/workflow-runtime/runtime-limits';
import { isRecord, materializeValue, statePatchAtPath } from '@/services/workflow-runtime/utils';
import type { NodeExecutionResult, NodeRuntimeInput } from '@/services/workflow-runtime/types';
import { nodeInvocationKey } from './durable-effects';
import { decryptPayload, encryptPayload } from './credentials';
import { toolboxSource } from './runtime-source';
import { loadPublishedNexusWorkflow } from './runtime';

export type BatchTask = { ordinal: number; workflowId: string; version: string; input: Record<string, unknown>; context: Record<string, unknown>; modelCap: number; toolCap: number; timeoutMs: number };

export async function executeAutomationBatch(input: NodeRuntimeInput): Promise<NodeExecutionResult> {
  const workspaceId = input.workflow.workspaceId!;
  const invocationId = nodeInvocationKey(input);
  const existing = await db.query(`SELECT status,encrypted_result FROM nexus_automation_jobs WHERE workspace_id=$1 AND id=$2`, [workspaceId, invocationId]);
  if (existing.rows[0]) {
    if (existing.rows[0].status === 'completed') {
      const result = decryptPayload(String(existing.rows[0].encrypted_result));
      return { status: 'success', selectedOutput: 'success', output: result, statePatch: statePatchAtPath(String(input.node.config.outputKey || 'items'), result.items), metrics: { durationMs: 0, modelCalls: Number(result.modelCalls || 0), toolCalls: Number(result.toolCalls || 0) } };
    }
    if (['failed', 'cancelled', 'uncertain'].includes(String(existing.rows[0].status))) {
      const result = existing.rows[0].encrypted_result ? decryptPayload(String(existing.rows[0].encrypted_result)) : {};
      return { status: 'error', output: result, metrics: { durationMs: 0, modelCalls: Number(result.modelCalls || 0), toolCalls: Number(result.toolCalls || 0) }, error: { code: 'BATCH_FAILED', message: 'O processamento não foi concluído. Inspecione as execuções filhas.', retryable: false } };
    }
  } else {
    const { inputTemplate, ...baseConfig } = input.node.config;
    const materialized = materializeValue(baseConfig, toolboxSource(input)) as Record<string, unknown>;
    const config = BatchConfigSchema.parse(materialized);
    const candidateItems = input.node.type === 'logic.map_subflow' ? materialized.items : input.node.type === 'logic.async_subflow' ? [{ workflowId: materialized.workflowId, input: materialized.arguments }] : materialized.branches;
    if (!Array.isArray(candidateItems) || candidateItems.length > config.maxItems) throw new Error('Informe uma lista dentro do limite configurado.');
    let rawItems: unknown[] = candidateItems;
    if (input.node.type === 'logic.fork_subflows' && rawItems.length > 20) throw new Error('Use até 20 subfluxos por ramificação paralela.');
    const totalItems = rawItems.length;
    if (input.node.type === 'logic.map_subflow' && config.batchSize > 1) {
      const list = rawItems;
      rawItems = Array.from({ length: Math.ceil(list.length / config.batchSize) }, (_, index) => list.slice(index * config.batchSize, (index + 1) * config.batchSize));
    }
    const stack = Array.isArray(input.execution.context.nexusSubflowStack) ? input.execution.context.nexusSubflowStack.map(String) : [input.workflow.id.replace(/^nexus:/, '')];
    if (stack.length >= 4) throw new Error('O limite de quatro níveis de subfluxos foi atingido.');
    const persistence = new PostgresWorkflowPersistence(db);
    const targets = new Map<string, Awaited<ReturnType<typeof loadPublishedNexusWorkflow>>>();
    const tasks: BatchTask[] = [];
    for (let index = 0; index < rawItems.length; index++) {
      const item = rawItems[index];
      const branch = input.node.type !== 'logic.map_subflow' && isRecord(item) ? item : null;
      const workflowId = String(branch?.workflowId || materialized.workflowId || '').replace(/^nexus:/, '');
      if (stack.includes(workflowId)) throw new Error('O subfluxo criaria uma chamada circular.');
      if (!targets.has(workflowId)) {
        const target = await loadPublishedNexusWorkflow({ workspaceId, nexusWorkflowId: workflowId });
        targets.set(workflowId, target);
        if (target) await persistence.saveWorkflowDefinition(target.workflow);
      }
      const published = targets.get(workflowId);
      if (!published || !published.workflow.nodes.some(node => node.type === 'trigger.manual')) throw new Error('Selecione um subfluxo publicado deste workspace com gatilho manual.');
      const itemInput = branch ? isRecord(branch.input) ? branch.input : {} : materializeValue(inputTemplate || { item: '{{item}}', index: '{{index}}', total: '{{total}}' }, { ...toolboxSource(input), item, index: index * config.batchSize, total: totalItems });
      if (!isRecord(itemInput)) throw new Error('O mapeamento do subfluxo precisa produzir um objeto.');
      tasks.push({ ordinal: index, workflowId: published.workflow.id, version: published.workflow.version,
        input: itemInput,
        context: { source: 'automation_child', automationManaged: true, parentExecutionId: input.execution.executionId, nexusSubflowStack: [...stack, workflowId] },
        modelCap: Math.min(config.modelCallsPerChild, published.workflow.settings.maxModelCalls), toolCap: Math.min(config.toolCallsPerChild, published.workflow.settings.maxToolCalls), timeoutMs: published.workflow.settings.executionTimeoutMs });
    }
    const limits = effectiveWorkflowLimits(input.workflow.settings, input.execution.context.__workflowRuntimeCaps);
    const policy = (await db.query(`SELECT max_concurrency FROM nexus_automation_policies WHERE workspace_id=$1`, [workspaceId])).rows[0];
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const added = await client.query(`INSERT INTO nexus_automation_jobs(id,workspace_id,kind,execution_id,encrypted_payload,concurrency,model_available,tool_available)
        VALUES($1,$2,'batch',$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING RETURNING id`, [invocationId, workspaceId, input.execution.executionId,
        encryptPayload({ tasks, errorMode: config.errorMode, sessionId: input.execution.sessionId, conversationId: input.execution.conversationId }), Math.min(config.concurrency, Number(policy?.max_concurrency || 5)),
        Math.max(0, limits.maxModelCalls - input.execution.totalModelCalls), Math.max(0, limits.maxToolCalls - input.execution.totalToolCalls)]);
      if (added.rowCount) {
        for (const task of tasks) await client.query(`INSERT INTO nexus_automation_jobs(id,workspace_id,kind,parent_id,execution_id,encrypted_payload) VALUES($1,$2,'child',$3,$4,$5)`, [`${invocationId}_${task.ordinal}`, workspaceId, invocationId, `child_${invocationId}_${task.ordinal}`, encryptPayload({ ordinal: task.ordinal })]);
      }
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
  return { status: 'waiting', waitingReason: 'subflows', resumeToken: `batch_${invocationId}`, output: { invocationId, resumeMode: 'reexecute', pauseTimeoutWhileWaiting: true, waitingSince: new Date().toISOString() } };
}
