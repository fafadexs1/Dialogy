import { z } from 'zod';
import { db } from '@/lib/db';
import { loadPublishedNexusWorkflow } from '@/modules/nexus/services/runtime';
import { verifyNexusWebhookToken } from '@/modules/nexus/services/deployment';
import { assertAutomationToolboxEnabled } from '@/modules/nexus/services/toolbox-policy';
import { encryptPayload } from '@/modules/nexus/services/credentials';
import { hashValue } from '@/services/workflow-runtime/utils';
import { readWebhookBody } from '@/services/workflow-runtime/webhook-contract';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request, context: { params: Promise<{ workflowId: string }> }) {
  const { workflowId } = await context.params;
  const published = await loadPublishedNexusWorkflow({ nexusWorkflowId: workflowId });
  if (!published) return Response.json({ error: 'Fluxo indisponível.' }, { status: 404 });
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '') || request.headers.get('x-nexus-key') || '';
  if (!verifyNexusWebhookToken(token, published.webhookTokenHash)) return Response.json({ error: 'Token inválido.' }, { status: 401 });
  try {
    assertAutomationToolboxEnabled(published.workspaceId);
    const payload = z.object({ executionId: z.string().min(1).max(300), eventId: z.string().min(1).max(300), name: z.string().min(1).max(150), data: z.record(z.unknown()).default({}) }).parse(JSON.parse((await readWebhookBody(request)).toString('utf8')));
    const execution = (await db.query(`SELECT id FROM workflow_executions WHERE workspace_id=$1 AND id=$2 AND workflow_id=$3`, [published.workspaceId, payload.executionId, published.workflow.id])).rows[0];
    if (!execution) return Response.json({ error: 'Execução indisponível.' }, { status: 404 });
    const id = `event_${hashValue({ workspaceId: published.workspaceId, executionId: payload.executionId, eventId: payload.eventId })}`;
    const inserted = await db.query(`INSERT INTO nexus_automation_events(id,workspace_id,execution_id,event_name,encrypted_payload) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING id`, [id, published.workspaceId, payload.executionId, payload.name, encryptPayload(payload.data)]);
    return Response.json({ accepted: true, duplicate: !inserted.rowCount }, { status: 202 });
  } catch (error) { return Response.json({ error: error instanceof Error && error.message === 'PAYLOAD_TOO_LARGE' ? 'Payload excede 1 MB.' : 'Evento inválido ou indisponível.' }, { status: error instanceof Error && error.message === 'PAYLOAD_TOO_LARGE' ? 413 : 400 }); }
}
