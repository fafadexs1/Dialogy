import { describe, expect, it } from 'vitest';
import {
  getChatContactDisplayValue,
  getChatIdentityDisplayValue,
  getChatPlatformLabel,
  resolveChatPlatform,
  resolveOutboundMessagePlatform,
} from '@/lib/chat-platform';
import type { Chat } from '@/lib/types';

function makeChat(overrides: Partial<Chat>): Chat {
  return {
    id: 'chat-1',
    workspace_id: 'workspace-1',
    status: 'gerais',
    contact: {
      id: 'contact-1',
      workspace_id: 'workspace-1',
      name: 'Contato',
      phone_number_jid: '556199999999@s.whatsapp.net',
    },
    messages: [],
    ...overrides,
  } as Chat;
}

describe('chat platform helpers', () => {
  it('keeps an unclassified WhatsApp chat generic instead of assuming Baileys', () => {
    const platform = resolveChatPlatform(makeChat({}));

    expect(platform).toBe('whatsapp');
    expect(getChatPlatformLabel(platform)).toBe('WhatsApp');
  });

  it('uses the registered WhatsApp instance type when it is available', () => {
    expect(resolveChatPlatform(makeChat({ instance_type: 'wa_cloud' }))).toBe('wa_cloud');
    expect(resolveChatPlatform(makeChat({ instance_type: 'baileys' }))).toBe('baileys');
    expect(getChatPlatformLabel('baileys')).toBe('WhatsApp');
  });

  it('resolves the outbound source from authoritative instance evidence', () => {
    expect(resolveOutboundMessagePlatform({
      source: 'whatsapp',
      instanceType: 'wa_cloud',
      instanceName: 'vendas',
      remoteIdentity: '556199999999@s.whatsapp.net',
    })).toBe('wa_cloud');

    expect(resolveOutboundMessagePlatform({
      instanceName: 'vendas-legado',
      remoteIdentity: '556199999999@s.whatsapp.net',
    })).toBe('whatsapp');

    expect(resolveOutboundMessagePlatform({
      source: 'whatsapp',
      instanceType: 'telegram',
      instanceName: 'atendimento',
    })).toBe('telegram');
  });

  it('does not overwrite explicit non-WhatsApp routing evidence', () => {
    expect(resolveOutboundMessagePlatform({
      source: 'webchat',
      instanceType: 'baileys',
      instanceName: 'instancia-antiga',
    })).toBe('webchat');

    expect(resolveOutboundMessagePlatform({
      source: 'mercadolivre',
      remoteIdentity: 'buyer-123',
    })).toBeNull();
  });

  it('does not display a WhatsApp JID as the Instagram identity', () => {
    expect(
      getChatContactDisplayValue(
        { phone_number_jid: '556199999999@s.whatsapp.net', phone: undefined },
        'instagram'
      )
    ).toBeNull();
  });

  it('uses the Meta username before a reused contact phone number', () => {
    const chat = makeChat({
      metaContactUsername: 'fabriciososoares',
      metaPlatform: 'instagram',
    });

    expect(resolveChatPlatform(chat)).toBe('instagram');
    expect(getChatIdentityDisplayValue(chat)).toBe('@fabriciososoares');
  });

  it('falls back to the latest external sender id for legacy Meta chats', () => {
    const chat = makeChat({
      messages: [
        {
          id: 'message-1',
          chat_id: 'chat-1',
          workspace_id: 'workspace-1',
          content: 'Opa',
          type: 'text',
          status: 'default',
          transcription: null,
          timestamp: '18:56',
          createdAt: new Date().toISOString(),
          formattedDate: 'Hoje',
          platform: 'instagram',
          source_from_api: 'instagram',
          externalSenderId: '3777175972601569',
          from_me: false,
        },
      ],
    });

    expect(getChatIdentityDisplayValue(chat)).toBe('3777175972601569');
  });
});
