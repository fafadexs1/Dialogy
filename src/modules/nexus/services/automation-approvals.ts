import 'server-only';
import { db } from '@/lib/db';
import { hashValue, statePatchAtPath } from '@/services/workflow-runtime/utils';
import type { NodeExecutionResult, NodeRuntimeInput } from '@/services/workflow-runtime/types';
import { nodeInvocationKey } from './durable-effects';
import { encryptPayload } from './credentials';

export async function requestAutomationApproval(input: NodeRuntimeInput, args: Record<string, unknown>, title: string, fixedInvocationId?: string): Promise<NodeExecutionResult | null> {
  const workspaceId = input.workflow.workspaceId!;
  const invocationId = fixedInvocationId || nodeInvocationKey(input);
  const binding = hashValue({ workflowId: input.workflow.id, version: input.workflow.version, nodeId: input.node.id, config: input.node.config, args });
  const minutes = Number(input.node.config.expiresInMinutes || 1440);
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 43200) throw new Error('A aprovação deve expirar entre 1 minuto e 30 dias.');
  const resumeToken = `approval_${invocationId}`;
  await db.query(`INSERT INTO nexus_automation_approvals(id,workspace_id,execution_id,node_id,title,arguments_hash,encrypted_arguments,resume_token,expires_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,clock_timestamp()+($9::text||' minutes')::interval) ON CONFLICT DO NOTHING`, [invocationId, workspaceId, input.execution.executionId, input.node.id, title.slice(0, 300), binding, encryptPayload(args), resumeToken, minutes]);
  const { rows } = await db.query(`UPDATE nexus_automation_approvals SET status=CASE WHEN status='pending' AND expires_at<=clock_timestamp() THEN 'expired' ELSE status END WHERE workspace_id=$1 AND id=$2 RETURNING *`, [workspaceId, invocationId]);
  const row = rows[0];
  if (!row || row.arguments_hash !== binding) throw new Error('Os argumentos mudaram. A autorização anterior não pode ser reutilizada.');
  if (row.status === 'approved') return null;
  if (row.status !== 'pending') return { status: 'route', selectedOutput: row.status === 'expired' ? 'expired' : 'denied', output: { approvalId: invocationId, status: String(row.status) } };
  return { status: 'waiting', waitingReason: 'approval', resumeToken, output: { invocationId, approvalId: invocationId, title, status: 'pending', resumeMode: 'reexecute', pauseTimeoutWhileWaiting: true, waitingSince: new Date().toISOString(), expiresAt: new Date(row.expires_at).toISOString() } };
}

export async function executeApprovalNode(input: NodeRuntimeInput, args: Record<string, unknown>, title: string): Promise<NodeExecutionResult> {
  const pending = await requestAutomationApproval(input, args, title);
  if (pending) return pending;
  const result = { approved: true, approvalId: nodeInvocationKey(input) };
  return { status: 'route', selectedOutput: 'approved', output: result, statePatch: statePatchAtPath(String(input.node.config.outputKey || 'approval'), result) };
}
