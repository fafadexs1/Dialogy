import { createHash, randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';

import { logAction } from '@/lib/observability/logger';
import { recordWebhookMetrics } from '@/lib/observability/metrics';
import { recordMetaIngressLog } from '@/services/meta/meta-ingress-log';
import { matchMetaSignature } from '@/services/meta/meta-signature';
import { persistMetaWhatsappEnvelope } from '@/services/meta/whatsapp-router';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const requestId = randomUUID();
  const { searchParams } = new URL(request.url);
  const expectedToken = process.env.META_WHATSAPP_VERIFY_TOKEN || process.env.META_VERIFY_TOKEN;
  if (!expectedToken) {
    await recordMetaIngressLog({ requestId, event: 'challenge_not_configured', statusCode: 503 });
    return NextResponse.json(
      { error: 'webhook_not_configured' },
      { status: 503 },
    );
  }
  if (
    searchParams.get('hub.mode') !== 'subscribe' ||
    !searchParams.get('hub.challenge')
  ) {
    await recordMetaIngressLog({ requestId, event: 'challenge_bad_request', statusCode: 400 });
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }
  if (searchParams.get('hub.verify_token') !== expectedToken) {
    await recordMetaIngressLog({ requestId, event: 'challenge_forbidden', statusCode: 403 });
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  await recordMetaIngressLog({ requestId, event: 'challenge_verified', statusCode: 200 });
  return new NextResponse(searchParams.get('hub.challenge'), {
    status: 200,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  const requestId = randomUUID();
  const rawBody = await request.text();
  const bodyHash = createHash('sha256').update(rawBody).digest('hex');
  const signature = request.headers.get('x-hub-signature-256');
  let payload: Record<string, unknown>;

  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    await recordMetaIngressLog({
      requestId,
      event: 'invalid_json',
      statusCode: 400,
      bodyHash,
      contentLength: rawBody.length,
      signaturePresent: Boolean(signature),
    });
    recordWebhookMetrics({
      source: 'meta-whatsapp',
      status: 'fail',
      event: 'invalid_json',
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const signatureMatch = matchMetaSignature(rawBody, signature);
  if (!signatureMatch.configured) {
    await recordMetaIngressLog({
      requestId,
      event: 'signature_not_configured',
      statusCode: 503,
      bodyHash,
      contentLength: rawBody.length,
      signaturePresent: Boolean(signature),
    });
    return NextResponse.json(
      { error: 'webhook_not_configured' },
      { status: 503 },
    );
  }
  if (!signatureMatch.appId) {
    console.warn('[META_WHATSAPP_WEBHOOK] invalid signature', {
      requestId,
      signaturePresent: Boolean(signature),
      bodyHash,
      contentLength: rawBody.length,
    });
    await recordMetaIngressLog({
      requestId,
      event: 'invalid_signature',
      statusCode: 401,
      bodyHash,
      contentLength: rawBody.length,
      signaturePresent: Boolean(signature),
    });
    recordWebhookMetrics({
      source: 'meta-whatsapp',
      status: 'fail',
      event: 'invalid_signature',
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json({ error: 'invalid_signature' }, { status: 401 });
  }

  try {
    const shadow = request.headers.get('x-dialogy-shadow') === 'true';
    const result = await persistMetaWhatsappEnvelope(rawBody, payload, {
      appId: signatureMatch.appId,
      shadow,
      sourceClusterId: shadow
        ? request.headers.get('x-dialogy-source-cluster-id')
        : null,
    });
    await recordMetaIngressLog({
      requestId,
      event: 'accepted',
      statusCode: 200,
      bodyHash,
      contentLength: rawBody.length,
      signaturePresent: true,
      appId: signatureMatch.appId,
      duplicate: result.duplicate,
      atoms: result.atoms,
      quarantined: result.quarantined,
    });
    await logAction({
      action: 'webhook_processed_success',
      payload: {
        request_id: requestId,
        source: 'meta-whatsapp',
        duplicated: result.duplicate,
        atoms_count: result.atoms,
        quarantined_count: result.quarantined,
        shadow,
        duration_ms: Date.now() - startedAt,
      },
    });
    recordWebhookMetrics({
      source: 'meta-whatsapp',
      status: 'success',
      event: typeof payload.object === 'string' ? payload.object : 'unknown',
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json({ ok: true, duplicate: result.duplicate });
  } catch (error) {
    console.error('[META_WHATSAPP_WEBHOOK] durable commit failed', {
      requestId,
      error: error instanceof Error ? error.message : 'unknown_error',
    });
    await recordMetaIngressLog({
      requestId,
      event: 'database_unavailable',
      statusCode: 503,
      bodyHash,
      contentLength: rawBody.length,
      signaturePresent: Boolean(signature),
      appId: signatureMatch.appId,
    });
    recordWebhookMetrics({
      source: 'meta-whatsapp',
      status: 'fail',
      event: 'database',
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json(
      { error: 'database_unavailable' },
      { status: 503 },
    );
  }
}
