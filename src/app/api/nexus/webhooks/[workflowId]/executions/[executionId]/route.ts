import { db } from '@/lib/db';
import { PostgresWorkflowPersistence } from '@/services/workflow-runtime/postgres-persistence';
import { loadPublishedNexusWorkflow, terminalNexusOutput } from '@/modules/nexus/services/runtime';
import { verifyNexusWebhookToken } from '@/modules/nexus/services/deployment';
import { decryptPayload } from '@/modules/nexus/services/credentials';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ workflowId: string; executionId: string }> }) {
  const { workflowId, executionId } = await context.params;
  const published = await loadPublishedNexusWorkflow({ nexusWorkflowId: workflowId });
  if (!published) return Response.json({ error: 'Fluxo indisponível.' }, { status: 404 });
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '') || request.headers.get('x-nexus-key') || '';
  if (!verifyNexusWebhookToken(token, published.webhookTokenHash)) return Response.json({ error: 'Token inválido.' }, { status: 401 });
  const job = (await db.query(`SELECT status,encrypted_payload FROM nexus_automation_jobs WHERE workspace_id=$1 AND execution_id=$2 AND kind='webhook'`, [published.workspaceId, executionId])).rows[0];
  if (!job || decryptPayload(String(job.encrypted_payload)).workflowId !== published.workflow.id) return Response.json({ error: 'Execução indisponível.' }, { status: 404 });
  const execution = await new PostgresWorkflowPersistence(db).getExecution(executionId);
  return Response.json({ executionId, status: execution?.status || job.status, output: execution?.status === 'completed' ? terminalNexusOutput(execution) : undefined, errorCode: execution?.failure?.code }, { headers: { 'Cache-Control': 'no-store' } });
}
