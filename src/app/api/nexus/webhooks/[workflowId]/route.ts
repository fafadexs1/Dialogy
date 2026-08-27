import { hashValue, isRecord } from '@/services/workflow-runtime';
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

function publicHeaders(request: Request) {
  const blocked = new Set(['authorization', 'cookie', 'set-cookie', 'x-nexus-key']);
  return Object.fromEntries([...request.headers.entries()].filter(([name]) => !blocked.has(name.toLowerCase())));
}

async function parsePayload(request: Request) {
  const raw = await request.text();
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) throw new Error('PAYLOAD_TOO_LARGE');
  const contentType = request.headers.get('content-type') || '';
  if (!raw) return {};
  if (contentType.includes('json')) {
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) ? parsed : { value: parsed };
  }
  if (contentType.includes('application/x-www-form-urlencoded')) {
    return Object.fromEntries(new URLSearchParams(raw));
  }
  return { text: raw };
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
    const body = await parsePayload(request);
    const url = new URL(request.url);
    const eventId = request.headers.get('x-nexus-event-id')?.trim();
    const result = await startPublishedNexusWorkflow({
      published,
      triggerType: 'trigger.webhook',
      payload: {
        body,
        query: Object.fromEntries(url.searchParams),
        headers: publicHeaders(request),
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
