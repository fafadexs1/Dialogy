import 'server-only';
import { z } from 'zod';
import { db } from '@/lib/db';
import type { NodeRuntimeInput, NodeExecutionResult } from '@/services/workflow-runtime/types';
import { hashValue } from '@/services/workflow-runtime/utils';
import { encryptPayload, decryptPayload } from './credentials';
import { requestAutomationApproval } from './automation-approvals';
import { assertAutomationToolboxEnabled } from './toolbox-policy';

export const ScheduledAgentTaskSchema = z.object({
  runAt: z.string().datetime({ offset: true }).describe('Data e hora futura em ISO 8601 com fuso explícito'),
  input: z.record(z.unknown()).default({}).describe('Dados para o fluxo autorizado'),
}).strict();

/** Schedule one immutable published workflow. Approval binds exact target, time and input. */
export async function scheduleAgentWorkflow(input: NodeRuntimeInput, args: unknown, invocationId: string): Promise<NodeExecutionResult> {
  const workspaceId = input.workflow.workspaceId;
  if (!workspaceId) throw new Error('Workspace ausente.');
  assertAutomationToolboxEnabled(workspaceId);
  const parsed = ScheduledAgentTaskSchema.parse(args);
  const runAt = new Date(parsed.runAt);
  const delay = runAt.getTime() - Date.now();
  if (!Number.isFinite(delay) || delay <= 0 || delay > 366 * 86_400_000) throw new Error('Agende uma data futura dentro de 366 dias.');
  if (Buffer.byteLength(JSON.stringify(parsed.input), 'utf8') > 16000) throw new Error('Os dados da tarefa excedem 16 KB.');
  const workflowId = String(input.node.config.workflowId || '').trim();
  if (!workflowId) throw new Error('Selecione o fluxo publicado autorizado para este agendamento.');
  const { loadPublishedNexusWorkflow } = await import('./runtime');
  const published = await loadPublishedNexusWorkflow({ workspaceId, nexusWorkflowId: workflowId });
  if (!published || !published.workflow.nodes.some((node) => node.type === 'trigger.manual')) throw new Error('O fluxo autorizado está indisponível ou não possui gatilho manual.');
  const proposal = { workflowId: published.workflow.id, version: published.workflow.version, runAt: runAt.toISOString(), input: parsed.input };
  const pending = await requestAutomationApproval(input, proposal, `Agendar fluxo ${published.workflow.name}`, invocationId);
  if (pending) return pending.status === 'route' ? { status: 'error', error: { code: 'SCHEDULE_APPROVAL_DENIED', message: 'O agendamento foi recusado ou expirou.', retryable: false } } : pending;
  const payload = { workflowId: proposal.workflowId, version: proposal.version, input: parsed.input, scheduledAt: proposal.runAt, source: 'agent_schedule' };
  const binding = hashValue(payload);
  const encrypted = encryptPayload({ ...payload, binding });
  const id = `scheduled_${hashValue({ workspaceId, invocationId })}`;
  await db.query(`INSERT INTO nexus_automation_jobs(id,workspace_id,kind,execution_id,encrypted_payload,available_at)
    VALUES($1,$2,'scheduled',$1,$3,$4::timestamptz) ON CONFLICT DO NOTHING`, [id, workspaceId, encrypted, proposal.runAt]);
  const existing = await db.query(`SELECT workspace_id, kind, encrypted_payload FROM nexus_automation_jobs WHERE id=$1 AND workspace_id=$2`, [id, workspaceId]);
  if (!existing.rows[0] || existing.rows[0].kind !== 'scheduled' || decryptPayload(String(existing.rows[0].encrypted_payload)).binding !== binding) throw new Error('O agendamento já existe com dados diferentes.');
  return { status: 'success', output: { scheduled: true, scheduleId: id, runAt: proposal.runAt, workflowId, version: proposal.version } };
}
