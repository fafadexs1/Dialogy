import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { handleInstagramWebhook } from '@/services/meta/instagram-webhook-service';
import {
  findChannelByExternalId,
  findChannelByVerifyToken,
  logWebhookEvent,
} from '@/services/meta/meta-channel.service';
import { verifyMetaSignature } from '@/services/meta/meta-signature';
import { logAction } from '@/lib/observability/logger';
import { recordWebhookMetrics } from '@/lib/observability/metrics';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get('hub.mode');
  const verifyToken = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');
  const envVerifyToken = process.env.META_VERIFY_TOKEN;

  if (mode === 'subscribe' && verifyToken && challenge) {
    if (envVerifyToken) {
      if (verifyToken !== envVerifyToken) {
        return NextResponse.json({ error: 'verify_token invalido' }, { status: 403 });
      }
    } else {
      const channel = await findChannelByVerifyToken('instagram', verifyToken);
      if (!channel) {
        return NextResponse.json({ error: 'verify_token invalido' }, { status: 403 });
      }
    }
    return new NextResponse(challenge, {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    });
  }

  return NextResponse.json({ error: 'bad_request' }, { status: 400 });
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const requestId = randomUUID();
  const receivedAt = Date.now();
  const payloadBytes = Buffer.byteLength(rawBody);
  let payload: any;

  try {
    payload = JSON.parse(rawBody);
  } catch (error) {
    await logAction({
      action: 'webhook_processed_fail',
      payload: {
        request_id: requestId,
        source: 'meta-instagram',
        status_code: 400,
        error: 'invalid_json',
        payload_bytes: payloadBytes,
        duration_ms: Date.now() - receivedAt,
      },
    });
    recordWebhookMetrics({
      source: 'meta-instagram',
      status: 'fail',
      event: 'invalid_json',
      durationMs: Date.now() - receivedAt,
    });
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const entryId = payload?.entry?.[0]?.id;
  const signature = request.headers.get('x-hub-signature-256');

  const channel = entryId ? await findChannelByExternalId('instagram', entryId) : null;

  await logAction({
    action: 'webhook_received',
    workspaceId: channel?.workspace_id ?? null,
    payload: {
      request_id: requestId,
      source: 'meta-instagram',
      event: payload?.object || 'unknown',
      entry_id: entryId,
      channel_id: channel?.id ?? null,
      payload_bytes: payloadBytes,
    },
  });

  await logWebhookEvent({
    channelId: channel?.id,
    source: 'meta-instagram',
    event: payload?.object || 'unknown',
    payload,
    headers: Object.fromEntries(request.headers),
  });

  if (!channel) {
    await logAction({
      action: 'webhook_processed_fail',
      payload: {
        request_id: requestId,
        source: 'meta-instagram',
        status_code: 404,
        error: 'channel_not_found',
        entry_id: entryId,
        duration_ms: Date.now() - receivedAt,
      },
    });
    recordWebhookMetrics({
      source: 'meta-instagram',
      status: 'fail',
      event: payload?.object || 'unknown',
      durationMs: Date.now() - receivedAt,
    });
    return NextResponse.json({ error: 'channel_not_found' }, { status: 404 });
  }

  if (channel.app_secret && !verifyMetaSignature(channel.app_secret, rawBody, signature)) {
    await logAction({
      action: 'webhook_processed_fail',
      workspaceId: channel.workspace_id,
      payload: {
        request_id: requestId,
        source: 'meta-instagram',
        status_code: 401,
        error: 'invalid_signature',
        entry_id: entryId,
        channel_id: channel.id,
        duration_ms: Date.now() - receivedAt,
      },
    });
    recordWebhookMetrics({
      source: 'meta-instagram',
      status: 'fail',
      event: payload?.object || 'unknown',
      durationMs: Date.now() - receivedAt,
    });
    return NextResponse.json({ error: 'invalid_signature' }, { status: 401 });
  }

  try {
    await handleInstagramWebhook(channel, payload);
    await logAction({
      action: 'webhook_processed_success',
      workspaceId: channel.workspace_id,
      payload: {
        request_id: requestId,
        source: 'meta-instagram',
        status_code: 200,
        entry_id: entryId,
        channel_id: channel.id,
        duration_ms: Date.now() - receivedAt,
      },
    });
    recordWebhookMetrics({
      source: 'meta-instagram',
      status: 'success',
      event: payload?.object || 'unknown',
      durationMs: Date.now() - receivedAt,
    });
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error('[META_INSTAGRAM_WEBHOOK]', error);
    await logAction({
      action: 'webhook_processed_fail',
      workspaceId: channel.workspace_id,
      payload: {
        request_id: requestId,
        source: 'meta-instagram',
        status_code: 500,
        entry_id: entryId,
        channel_id: channel.id,
        duration_ms: Date.now() - receivedAt,
        error: error?.message || 'internal_error',
      },
    });
    recordWebhookMetrics({
      source: 'meta-instagram',
      status: 'fail',
      event: payload?.object || 'unknown',
      durationMs: Date.now() - receivedAt,
    });
    return NextResponse.json({ error: error.message || 'internal_error' }, { status: 500 });
  }
}
