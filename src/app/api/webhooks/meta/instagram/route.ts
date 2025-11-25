'use server';

import { NextRequest, NextResponse } from 'next/server';
import { handleInstagramWebhook } from '@/services/meta/instagram-webhook-service';
import {
  findChannelByExternalId,
  findChannelByVerifyToken,
  logWebhookEvent,
} from '@/services/meta/meta-channel.service';
import { verifyMetaSignature } from '@/services/meta/meta-signature';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get('hub.mode');
  const verifyToken = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  if (mode === 'subscribe' && verifyToken && challenge) {
    const channel = await findChannelByVerifyToken('instagram', verifyToken);
    if (!channel) {
      return NextResponse.json({ error: 'verify_token invalido' }, { status: 403 });
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
  let payload: any;

  try {
    payload = JSON.parse(rawBody);
  } catch (error) {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const entryId = payload?.entry?.[0]?.id;
  const signature = request.headers.get('x-hub-signature-256');

  const channel = entryId ? await findChannelByExternalId('instagram', entryId) : null;

  await logWebhookEvent({
    channelId: channel?.id,
    source: 'meta-instagram',
    event: payload?.object || 'unknown',
    payload,
    headers: Object.fromEntries(request.headers),
  });

  if (!channel) {
    return NextResponse.json({ error: 'channel_not_found' }, { status: 404 });
  }

  if (channel.app_secret && !verifyMetaSignature(channel.app_secret, rawBody, signature)) {
    return NextResponse.json({ error: 'invalid_signature' }, { status: 401 });
  }

  try {
    await handleInstagramWebhook(channel, payload);
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error('[META_INSTAGRAM_WEBHOOK]', error);
    return NextResponse.json({ error: error.message || 'internal_error' }, { status: 500 });
  }
}
