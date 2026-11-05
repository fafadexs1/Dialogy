import 'server-only';
import { randomUUID } from 'node:crypto';
import { db } from '@/lib/db';
import { PostgresWorkflowPersistence } from '@/services/workflow-runtime/postgres-persistence';
import type { WorkflowDefinition, WorkflowExecution } from '@/services/workflow-runtime/types';
import { hashValue, isRecord, readPath } from '@/services/workflow-runtime/utils';
import { encryptPayload } from './credentials';
import { loadWorkflowFile } from './workflow-files';
import { WorkflowFileReferenceSchema } from '@/services/workflow-runtime/file-reference';

export async function enqueueWebhookExecution(workspaceId: string, workflow: WorkflowDefinition, input: Record<string, unknown>, eventId?: string) {
  const chatPath = String(workflow.nodes.find(node => node.type === 'trigger.webhook')?.config.conversationIdPath || '');
  const conversationId = chatPath ? String(readPath(input, chatPath) || '') : undefined;
  if (chatPath && (!conversationId || !(await db.query(`SELECT id FROM chats WHERE workspace_id=$1 AND id::text=$2`, [workspaceId, conversationId])).rowCount)) throw new Error('Atendimento indisponível neste workspace.');
  const id = `webhook_${hashValue({ workspaceId, workflowId: workflow.id, eventId: eventId || randomUUID() })}`;
  await new PostgresWorkflowPersistence(db).saveWorkflowDefinition(workflow);
  await db.query(`INSERT INTO nexus_automation_jobs(id,workspace_id,kind,execution_id,encrypted_payload) VALUES($1,$2,'webhook',$1,$3) ON CONFLICT DO NOTHING`, [id, workspaceId, encryptPayload({ workflowId: workflow.id, version: workflow.version, input, conversationId })]);
  return id;
}
export async function customWebhookResponse(execution: WorkflowExecution, workspaceId: string): Promise<Response | null> {
  const step = [...execution.executionPath].reverse().find(entry => entry.nodeType === 'output.webhook_response');
  const config = step?.output?.response;
  if (!isRecord(config)) return null;
  const status = Number(config.status || 200);
  if (!Number.isInteger(status) || status < 200 || status > 599) throw new Error('Status de resposta inválido.');
  const headers = new Headers();
  for (const [key, value] of Object.entries(isRecord(config.headers) ? config.headers : {})) {
    if (['set-cookie', 'authorization', 'connection', 'transfer-encoding', 'content-length', 'content-type'].includes(key.toLowerCase())) continue;
    headers.set(key, String(value));
  }
  if (status === 204 || status === 304) return new Response(null, { status, headers });
  if (WorkflowFileReferenceSchema.safeParse(config.body).success) {
    const { file, data } = await loadWorkflowFile(workspaceId, config.body);
    headers.set('Content-Type', 'application/octet-stream');
    headers.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`);
    return new Response(new Uint8Array(data), { status, headers });
  }
  return Response.json(config.body ?? null, { status, headers });
}
