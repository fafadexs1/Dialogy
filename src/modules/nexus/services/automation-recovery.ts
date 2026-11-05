import 'server-only';
import { db } from '@/lib/db';
import { PostgresWorkflowPersistence } from '@/services/workflow-runtime/postgres-persistence';
import { hashValue, sanitizeStatePatch, statePatchAtPath } from '@/services/workflow-runtime/utils';
import { encryptPayload } from './credentials';
import { loadPublishedNexusWorkflow } from './runtime';
import { z } from 'zod';

export const RECOVERABLE_AUTOMATION_NODES = new Set(['integration.http_request', 'integration.connector', 'whatsapp.send_text', 'whatsapp.send_media', 'dialogy.crm_update', 'output.respond', 'output.media', 'audio.elevenlabs', 'audio.transcribe', 'files.read', 'files.write']);
export const ConfirmedRecoverySchema = z.object({ executionId: z.string().min(1).max(300), expectedVersion: z.number().int().nonnegative(), selectedOutput: z.string().min(1), output: z.record(z.unknown()), statePatch: z.record(z.unknown()).default({}), evidence: z.string().min(5).max(2000) });

export async function recoveryContext(workspaceId: string, executionId: string) {
  const persistence = new PostgresWorkflowPersistence(db);
  const execution = await persistence.getExecution(executionId);
  if (!execution || execution.workspaceId !== workspaceId || execution.status !== 'failed' || !execution.workflowId.startsWith('nexus:')) throw new Error('Selecione uma execução Nexus com falha neste workspace.');
  const step = [...execution.executionPath].reverse().find(entry => entry.status === 'error');
  const workflow = await persistence.getWorkflowDefinition(execution.workflowId, execution.workflowVersion);
  const node = workflow?.nodes.find(entry => entry.id === step?.nodeId);
  if (!workflow || !node || !step || !RECOVERABLE_AUTOMATION_NODES.has(node.type)) throw new Error('Esta falha exige revisão do fluxo ou da sessão do Studio antes de uma nova execução.');
  if (execution.totalSteps >= workflow.settings.maxSteps || /^MAX_|EXECUTION_TIMEOUT/.test(execution.failure?.code || '')) throw new Error('Esta execução esgotou seu orçamento. Revise os limites antes de iniciar uma nova execução.');
  return { execution, workflow, node, step };
}
export async function recoverWithConfirmedResult(workspaceId: string, userId: string, value: unknown) {
  const input = ConfirmedRecoverySchema.parse(value);
  if (Buffer.byteLength(JSON.stringify(input)) > 1_000_000) throw new Error('O resultado excede 1 MB.');
  const { execution, workflow, node, step } = await recoveryContext(workspaceId, input.executionId);
  if (execution.version !== input.expectedVersion) throw new Error('A execução foi alterada. Recarregue antes de confirmar.');
  if (!node.outputPorts.some(port => port.id === input.selectedOutput && port.connectionType === 'main')) throw new Error('Escolha uma saída de continuação deste bloco.');
  if (!await loadPublishedNexusWorkflow({ workspaceId, nexusWorkflowId: workflow.id.replace(/^nexus:/, '') })) throw new Error('O fluxo precisa continuar publicado e disponível.');
  if ((await db.query(`SELECT id FROM nexus_automation_jobs WHERE workspace_id=$1 AND execution_id=$2 AND parent_id IS NOT NULL LIMIT 1`, [workspaceId, execution.executionId])).rowCount) throw new Error('Revise os resultados no fluxo pai para recuperar um processamento com subfluxos.');
  const defaultPatch = node.config.outputKey ? statePatchAtPath(String(node.config.outputKey), input.output.selected ?? input.output.data ?? input.output) : {};
  const patch = Object.keys(input.statePatch).length ? input.statePatch : defaultPatch;
  const result = { status: 'success' as const, selectedOutput: input.selectedOutput, output: input.output, statePatch: sanitizeStatePatch(Object.fromEntries(Object.entries(patch).filter(([key]) => !key.startsWith('__')))), metrics: { durationMs: 0, modelCalls: 0, toolCalls: 0 } };
  const next = { ...execution, status: 'queued' as const, currentNodeId: node.id, variables: structuredClone(step.stateBefore || {}), previousNodeId: [...execution.executionPath].reverse().find(entry => entry.sequence < step.sequence)?.nodeId || null, failure: undefined, finishedAt: undefined,
    context: { ...execution.context, __automationPausedMs: Math.max(0, Number(execution.context.__automationPausedMs || 0)) + Math.max(0, Date.now() - Date.parse(execution.updatedAt)), __automationRecovery: { nodeId: node.id, result, evidence: input.evidence, confirmedBy: userId, confirmedAt: new Date().toISOString() } }, updatedAt: new Date().toISOString() };
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const persistence = new PostgresWorkflowPersistence(client);
    await persistence.saveExecution(next, input.expectedVersion);
    const id = `recovery_${hashValue({ executionId: execution.executionId, version: input.expectedVersion })}`;
    await client.query(`INSERT INTO nexus_automation_jobs(id,workspace_id,kind,execution_id,encrypted_payload) VALUES($1,$2,'recovery',$3,$4)`, [id, workspaceId, execution.executionId, encryptPayload({ workflowId: workflow.id, version: workflow.version, input: execution.input })]);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}
