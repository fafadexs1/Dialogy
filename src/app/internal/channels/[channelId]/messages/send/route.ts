'use server';

import { NextRequest, NextResponse } from 'next/server';
import { getChannelById, resolveMetaContext, persistNormalizedMessage, logWebhookEvent } from '@/services/meta/meta-channel.service';
import { InstagramMessagingService } from '@/services/meta/instagram-messaging-service';
import { MessengerMessagingService } from '@/services/meta/messenger-messaging-service';

type SendPayload = {
  externalContactId: string;
  threadId?: string;
  type: 'text' | 'image' | 'video' | 'audio' | 'file';
  text?: string;
  mediaUrl?: string;
  senderUserId?: string;
  senderSystemAgentId?: string;
  profile?: { name?: string; username?: string; avatarUrl?: string };
};

export async function POST(
  request: NextRequest,
  props: { params: Promise<{ channelId: string }> }
) {
  const params = await props.params;
  const body = (await request.json().catch(() => null)) as SendPayload | null;
  if (!body || !body.externalContactId || !body.type) {
    return NextResponse.json({ error: 'invalid_payload' }, { status: 400 });
  }

  const channel = await getChannelById(params.channelId);
  if (!channel) {
    return NextResponse.json({ error: 'channel_not_found' }, { status: 404 });
  }

  try {
    const { contact, chat } = await resolveMetaContext({
      channel,
      externalUserId: body.externalContactId,
      platform: channel.type,
      profile: body.profile,
      threadKey: body.threadId || body.externalContactId,
    });

    const messagingResponse =
      channel.type === 'instagram'
        ? await new InstagramMessagingService(channel).sendMessage({
          recipientId: body.externalContactId,
          type: body.type,
          text: body.text,
          mediaUrl: body.mediaUrl,
        })
        : await new MessengerMessagingService(channel).sendMessage({
          recipientId: body.externalContactId,
          type: body.type,
          text: body.text,
          mediaUrl: body.mediaUrl,
        });

    const externalMessageId =
      messagingResponse?.message_id ||
      messagingResponse?.messageId ||
      messagingResponse?.id ||
      null;

    const externalChannelId =
      channel.type === 'instagram'
        ? channel.ig_business_id || channel.external_page_id
        : channel.external_page_id || channel.ig_business_id;

    const persisted = await persistNormalizedMessage({
      channel,
      chat,
      contact,
      message: {
        type: body.type === 'file' ? 'document' : body.type,
        content: body.text || null,
        metadata: body.mediaUrl ? { mediaUrl: body.mediaUrl } : {},
        mediaUrl: body.mediaUrl,
      },
      platform: channel.type,
      direction: 'outgoing',
      externalMessageId,
      externalSenderId: externalChannelId || null,
      externalChannelId: externalChannelId || null,
      rawPayload: { request: body, response: messagingResponse },
      fromMe: true,
      senderUserId: body.senderUserId,
      senderSystemAgentId: body.senderSystemAgentId,
    });

    await logWebhookEvent({
      channelId: channel.id,
      source: `meta-${channel.type}`,
      direction: 'outgoing',
      event: 'send',
      statusCode: 200,
      payload: body,
      responseBody: messagingResponse,
    });

    return NextResponse.json({ message: persisted });
  } catch (error: any) {
    console.error('[META_SEND_MESSAGE]', error);
    await logWebhookEvent({
      channelId: channel.id,
      source: `meta-${channel.type}`,
      direction: 'outgoing',
      event: 'send-error',
      statusCode: 500,
      payload: body,
      responseBody: { error: error.message },
    });
    return NextResponse.json({ error: error.message || 'internal_error' }, { status: 500 });
  }
}
