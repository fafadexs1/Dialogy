import { readWebhookBody, parseWebhookBody, verifyWebhookSignature, webhookPublicHeaders } from '@/services/workflow-runtime/webhook-contract';
import { loadNexusCredentialPayload } from '@/modules/nexus/services/credentials';
import { assertAutomationToolboxEnabled } from '@/modules/nexus/services/toolbox-policy';
import { enqueueWebhookExecution, customWebhookResponse } from '@/modules/nexus/services/webhook-execution';
import { PostgresWorkflowPersistence } from '@/services/workflow-runtime/postgres-persistence';
import { db } from '@/lib/db';
import { hashValue } from '@/services/workflow-runtime';
import { verifyNexusWebhookToken } from '@/modules/nexus/services/deployment';
import {
  loadPublishedNexusWorkflow,
  startPublishedNexusWorkflow,
  terminalNexusOutput,
} from '@/modules/nexus/services/runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 1_000_000;

function bearerToken(request: Request) {
  const authorization = request.headers.get('authorization') || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || request.headers.get('x-nexus-key')?.trim() || '';
}

async function handle(request: Request, context: { params: Promise<{ workflowId: string }> }) {
  const { workflowId } = await context.params;
  const published = await loadPublishedNexusWorkflow({ nexusWorkflowId: workflowId });
  if (!published) return Response.json({ error: 'Webhook não encontrado.' }, { status: 404 });
  if (!verifyNexusWebhookToken(bearerToken(request), published.webhookTokenHash)) {
    return Response.json({ error: 'Token do webhook inválido.' }, { status: 401 });
  }
  const trigger = published.workflow.nodes.find((node) => node.type === 'trigger.webhook');
  if (!trigger) return Response.json({ error: 'O fluxo publicado não usa webhook.' }, { status: 409 });
  const configuredMethod = String(trigger.config.method || 'POST').toUpperCase();
  if (configuredMethod !== request.method.toUpperCase()) {
    return Response.json({ error: `Este webhook aceita ${configuredMethod}.` }, { status: 405, headers: { Allow: configuredMethod } });
  }

  try {
    const raw = await readWebhookBody(request, MAX_BODY_BYTES);
    const body = parseWebhookBody(raw, request.headers.get('content-type') || '');
    const signatureCredentialId = String(trigger.config.signatureCredentialId || '');
    const signatureHeader = String(trigger.config.signatureHeader || 'x-signature');
    if (signatureCredentialId) {
      const credential = await loadNexusCredentialPayload({ workspaceId: published.workspaceId, credentialId: signatureCredentialId, allowedTypes: ['api_key'] });
      const timestampHeader = String(trigger.config.timestampHeader || '');
      if (!verifyWebhookSignature({ raw, secret: String(credential.payload.value || ''), signature: request.headers.get(signatureHeader) || '', ...(timestampHeader ? { timestamp: request.headers.get(timestampHeader) || '' } : {}) })) return Response.json({ error: 'Assinatura inválida ou expirada.' }, { status: 401 });
    }
    const url = new URL(request.url);
    const eventId = request.headers.get('x-nexus-event-id')?.trim();
    if (trigger.config.responseMode && trigger.config.responseMode !== 'legacy') {
      assertAutomationToolboxEnabled(published.workspaceId);
      const payload = { body, query: Object.fromEntries(url.searchParams), headers: webhookPublicHeaders(request.headers, signatureHeader), method: request.method, ...(trigger.config.includeRawBody === true ? { rawBody: raw.toString('utf8') } : {}) };
      const id = await enqueueWebhookExecution(published.workspaceId, published.workflow, payload, eventId || (signatureCredentialId ? hashValue({ raw: raw.toString('base64'), signature: request.headers.get(signatureHeader) }) : undefined));
      if (['synchronous', 'response_node'].includes(String(trigger.config.responseMode))) {
        const configuredTimeout = Number(trigger.config.responseTimeoutMs || 10000);
        if (!Number.isFinite(configuredTimeout)) throw new Error('Tempo de resposta inválido.');
        const deadline = Date.now() + Math.max(100, Math.min(20000, configuredTimeout));
        const persistence = new PostgresWorkflowPersistence(db);
        do {
          const execution = await persistence.getExecution(id);
          if (execution) {
            const response = await customWebhookResponse(execution, published.workspaceId);
            if (response) return response;
            if (['completed', 'failed', 'cancelled'].includes(execution.status)) return Response.json({ executionId: id, status: execution.status, output: terminalNexusOutput(execution) }, { status: execution.status === 'completed' ? 200 : 500 });
          }
          await new Promise(resolve => setTimeout(resolve, 200));
        } while (Date.now() < deadline);
      }
      const statusUrl = `/api/nexus/webhooks/${encodeURIComponent(workflowId)}/executions/${encodeURIComponent(id)}`;
      return Response.json({ executionId: id, status: 'accepted', statusUrl }, { status: 202, headers: { Location: statusUrl } });
    }
    const result = await startPublishedNexusWorkflow({
      published,
      triggerType: 'trigger.webhook',
      payload: {
        body,
        query: Object.fromEntries(url.searchParams),
        headers: webhookPublicHeaders(request.headers, signatureHeader),
        method: request.method,
      },
      context: { source: 'webhook', receivedAt: new Date().toISOString() },
      executionId: eventId
        ? `nexus_webhook_${hashValue({ workflowId, eventId })}`
        : undefined,
      workerId: `nexus_webhook_${workflowId}`,
    });
    const status = result.execution.status === 'failed' ? 500 : result.execution.status === 'waiting' ? 202 : 200;
    return Response.json({
      executionId: result.execution.executionId,
      status: result.execution.status,
      output: terminalNexusOutput(result.execution),
      deliveries: result.deliveries,
      error: result.execution.failure?.message,
    }, { status });
  } catch (error) {
    if (error instanceof SyntaxError) return Response.json({ error: 'JSON inválido.' }, { status: 400 });
    if (error instanceof Error && error.message === 'PAYLOAD_TOO_LARGE') return Response.json({ error: 'Payload excede 1 MB.' }, { status: 413 });
    return Response.json({ error: error instanceof Error ? error.message : 'Falha ao executar o webhook.' }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
