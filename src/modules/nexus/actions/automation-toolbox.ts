'use server';

import { z } from 'zod';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { db } from '@/lib/db';
import { createClient } from '@/lib/supabase/server';
import { hasWorkspacePermission } from '@/lib/workspace-permissions';
import { redactWorkflowValue } from '@/services/workflow-runtime/events';
import { decryptPayload } from '../services/credentials';
import { saveConnectorDraft, publishConnector } from '../services/connectors';
import { assertAutomationToolboxEnabled, isAutomationToolboxEnabled } from '../services/toolbox-policy';
import { saveWorkflowFile } from '../services/workflow-files';
import { recoveryContext, recoverWithConfirmedResult } from '../services/automation-recovery';

async function manager(workspaceId: string, requireFeature = true) {
  z.string().uuid().parse(workspaceId);
  const { data: { user } } = await (await createClient()).auth.getUser();
  if (!user || !await hasWorkspacePermission(user.id, workspaceId, 'automations:manage')) throw new Error('Acesso não autorizado.');
  if (requireFeature) {
    assertAutomationToolboxEnabled(workspaceId);
    if (!(await db.query(`SELECT to_regclass('public.nexus_automation_jobs') AS name`)).rows[0]?.name) throw new Error('As ferramentas avançadas aguardam a atualização do sistema.');
  }
  return user;
}
export async function listAutomationConnectors(workspaceId: string) {
  await manager(workspaceId);
  const { rows } = await db.query(`SELECT id,version,name,status,encrypted_definition FROM nexus_connectors WHERE workspace_id=$1 ORDER BY name,version DESC LIMIT 200`, [workspaceId]);
  return rows.map(row => ({ id: String(row.id), version: Number(row.version), name: String(row.name), status: String(row.status), definition: decryptPayload(String(row.encrypted_definition)) }));
}
export async function getAutomationToolboxStatus(workspaceId: string) {
  await manager(workspaceId, false);
  if (!isAutomationToolboxEnabled(workspaceId)) return { enabled: false, reason: 'As ferramentas avançadas ainda não foram habilitadas neste workspace.', supportedMediaTypes: [] as string[] };
  if (!(await db.query(`SELECT to_regclass('public.nexus_automation_jobs') AS name`)).rows[0]?.name) return { enabled: false, reason: 'As ferramentas avançadas aguardam a atualização do sistema.', supportedMediaTypes: [] as string[] };
  let types: string[] = [];
  try { const model = await (await import('@/services/ai/platform-config')).platformModel(); types = (model.supportedMediaTypes || []).filter(type => type !== 'pdf' || model.id.startsWith('googleai/')); } catch { /* The inspector explains missing media configuration. */ }
  return { enabled: true, reason: '', supportedMediaTypes: types };
}
export async function saveAutomationConnector(input: { workspaceId: string; definition: unknown; connectorId?: string }) {
  const user = await manager(input.workspaceId);
  if (input.connectorId) z.string().uuid().parse(input.connectorId);
  return saveConnectorDraft(input.workspaceId, user.id, input.definition, input.connectorId);
}
export async function publishAutomationConnector(input: { workspaceId: string; id: string; version: number }) {
  await manager(input.workspaceId);
  z.string().uuid().parse(input.id); z.number().int().positive().parse(input.version);
  await publishConnector(input.workspaceId, input.id, input.version);
}
export async function revokeAutomationConnector(input: { workspaceId: string; id: string; version: number }) {
  await manager(input.workspaceId);
  await db.query(`UPDATE nexus_connectors SET status='revoked' WHERE workspace_id=$1 AND id=$2 AND version=$3`, [input.workspaceId, input.id, input.version]);
}
export async function listAutomationApprovals(workspaceId: string, executionId?: string) {
  await manager(workspaceId);
  const { rows } = await db.query(`SELECT id,title,status,encrypted_arguments,expires_at FROM nexus_automation_approvals WHERE workspace_id=$1 AND ($2::text IS NULL OR execution_id=$2) AND status='pending' ORDER BY created_at LIMIT 100`, [workspaceId, executionId || null]);
  return rows.map(row => ({ id: String(row.id), title: String(row.title), status: String(row.status), arguments: redactWorkflowValue(decryptPayload(String(row.encrypted_arguments))), expiresAt: new Date(row.expires_at).toISOString() }));
}
export async function decideAutomationApproval(input: { workspaceId: string; id: string; decision: 'approved' | 'denied' }) {
  const user = await manager(input.workspaceId);
  z.enum(['approved', 'denied']).parse(input.decision);
  const updated = await db.query(`UPDATE nexus_automation_approvals SET status=$3,decided_by=$4,decided_at=clock_timestamp() WHERE workspace_id=$1 AND id=$2 AND status='pending' AND expires_at>clock_timestamp() RETURNING id`, [input.workspaceId, input.id, input.decision, user.id]);
  if (!updated.rowCount) throw new Error('A aprovação expirou ou já foi decidida.');
}
export async function uploadAutomationFile(workspaceId: string, form: FormData) {
  await manager(workspaceId);
  const file = form.get('file');
  if (!(file instanceof File) || file.size > 10_000_000 || file.size === 0) throw new Error('Selecione um arquivo de até 10 MB.');
  return saveWorkflowFile({ workspaceId, name: file.name, mimeType: file.type || 'application/octet-stream', data: Buffer.from(await file.arrayBuffer()) });
}
export async function createWebhookTestSession(workspaceId: string) {
  const user = await manager(workspaceId);
  const id = randomUUID(), token = randomBytes(32).toString('hex');
  await db.query(`INSERT INTO nexus_webhook_test_sessions(id,workspace_id,token_hash,created_by) VALUES($1,$2,$3,$4)`, [id, workspaceId, createHash('sha256').update(token).digest('hex'), user.id]);
  return { id, token, path: `/api/nexus/webhooks/test/${id}`, expiresAt: new Date(Date.now() + 600000).toISOString() };
}
export async function readWebhookTestSample(workspaceId: string, sessionId: string) {
  await manager(workspaceId); z.string().uuid().parse(sessionId);
  const row = (await db.query(`SELECT encrypted_sample,expires_at FROM nexus_webhook_test_sessions WHERE workspace_id=$1 AND id=$2`, [workspaceId, sessionId])).rows[0];
  if (!row) throw new Error('Sessão indisponível.');
  return { expired: new Date(row.expires_at).getTime() < Date.now(), sample: row.encrypted_sample ? redactWorkflowValue(decryptPayload(String(row.encrypted_sample))) as Record<string, unknown> : null };
}
export async function setAutomationConcurrencyLimit(workspaceId: string, value: number) {
  await manager(workspaceId); z.number().int().min(1).max(5).parse(value);
  await db.query(`INSERT INTO nexus_automation_policies(workspace_id,max_concurrency) VALUES($1,$2) ON CONFLICT(workspace_id) DO UPDATE SET max_concurrency=EXCLUDED.max_concurrency`, [workspaceId, value]);
}
export async function listAutomationJobs(workspaceId: string, executionId?: string) {
  await manager(workspaceId);
  const { rows } = await db.query(`SELECT j.id,j.kind,j.execution_id,j.status,j.updated_at FROM nexus_automation_jobs j LEFT JOIN nexus_automation_jobs parent ON parent.id=j.parent_id AND parent.workspace_id=j.workspace_id
    WHERE j.workspace_id=$1 AND ($2::text IS NULL OR j.execution_id=$2 OR parent.execution_id=$2) ORDER BY j.updated_at DESC LIMIT 100`, [workspaceId, executionId || null]);
  return rows.map(row => ({ id: String(row.id), kind: String(row.kind), executionId: String(row.execution_id), status: String(row.status), updatedAt: new Date(row.updated_at).toISOString() }));
}
export async function getAutomationRecovery(workspaceId: string, executionId: string) {
  await manager(workspaceId);
  const { execution, node } = await recoveryContext(workspaceId, executionId);
  return { version: execution.version, nodeName: node.name, outputKey: String(node.config.outputKey || ''), ports: node.outputPorts.filter(port => port.connectionType === 'main').map(port => ({ id: port.id, label: port.label })) };
}
export async function confirmAutomationRecovery(workspaceId: string, value: unknown) {
  const user = await manager(workspaceId);
  await recoverWithConfirmedResult(workspaceId, user.id, value);
}
