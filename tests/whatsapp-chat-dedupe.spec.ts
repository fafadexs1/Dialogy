import { describe, expect, it } from 'vitest';

import { dedupeActiveWhatsappChatsByIdentity, getActiveWhatsappChatIdentityKey } from '@/lib/whatsapp/chat-dedupe';

describe('whatsapp chat dedupe', () => {
  it('builds the same active identity key for numbers with and without the ninth digit', () => {
    expect(
      getActiveWhatsappChatIdentityKey('gerais', '556184734944@s.whatsapp.net')
    ).toBe(
      getActiveWhatsappChatIdentityKey('atendimentos', '5561984734944@s.whatsapp.net')
    );
  });

  it('builds the same active identity key for standard and legacy whatsapp suffixes', () => {
    expect(
      getActiveWhatsappChatIdentityKey('gerais', '556194295752@s.whatsapp.net')
    ).toBe(
      getActiveWhatsappChatIdentityKey('atendimentos', '5561994295752@c.us')
    );
  });

  it('keeps only the first active chat for the same whatsapp identity', () => {
    const chats = [
      { id: 'chat-new', status: 'gerais', phone: '5561984734944@s.whatsapp.net' },
      { id: 'chat-old', status: 'atendimentos', phone: '556184734944@s.whatsapp.net' },
      { id: 'chat-other', status: 'gerais', phone: '5561912345678@s.whatsapp.net' },
    ];

    const deduped = dedupeActiveWhatsappChatsByIdentity({
      chats,
      getId: (chat) => chat.id,
      getStatus: (chat) => chat.status,
      getPhoneOrJid: (chat) => chat.phone,
    });

    expect(deduped.map((chat) => chat.id)).toEqual(['chat-new', 'chat-other']);
  });

  it('preserves the selected chat when duplicates exist for the same identity', () => {
    const chats = [
      { id: 'chat-new', status: 'gerais', phone: '5561984734944@s.whatsapp.net' },
      { id: 'chat-selected', status: 'atendimentos', phone: '556184734944@s.whatsapp.net' },
    ];

    const deduped = dedupeActiveWhatsappChatsByIdentity({
      chats,
      getId: (chat) => chat.id,
      getStatus: (chat) => chat.status,
      getPhoneOrJid: (chat) => chat.phone,
      preserveChatId: 'chat-selected',
    });

    expect(deduped.map((chat) => chat.id)).toEqual(['chat-selected']);
  });

  it('does not collapse closed chats', () => {
    const chats = [
      { id: 'chat-closed-a', status: 'encerrados', phone: '5561984734944@s.whatsapp.net' },
      { id: 'chat-closed-b', status: 'encerrados', phone: '556184734944@s.whatsapp.net' },
    ];

    const deduped = dedupeActiveWhatsappChatsByIdentity({
      chats,
      getId: (chat) => chat.id,
      getStatus: (chat) => chat.status,
      getPhoneOrJid: (chat) => chat.phone,
    });

    expect(deduped.map((chat) => chat.id)).toEqual(['chat-closed-a', 'chat-closed-b']);
  });
});
