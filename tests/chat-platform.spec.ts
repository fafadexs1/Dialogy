import { describe, expect, it } from 'vitest';
import { getChatContactDisplayValue, getChatIdentityDisplayValue, resolveChatPlatform } from '@/lib/chat-platform';
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
