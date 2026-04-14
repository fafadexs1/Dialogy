import { describe, expect, it, vi } from 'vitest';

import {
  buildWhatsappLookupJids,
  findWhatsappChatByIdentity,
  normalizeWhatsappPhoneNumber,
  resolveCanonicalWhatsappChatId,
  resolveCanonicalWhatsappChatIdByIdentity,
} from '@/lib/whatsapp/contact-identity';

describe('whatsapp contact identity', () => {
  it('normalizes Brazilian mobile numbers to include the ninth digit', () => {
    expect(normalizeWhatsappPhoneNumber('556198765432')).toBe('5561998765432');
    expect(normalizeWhatsappPhoneNumber('5561998765432')).toBe('5561998765432');
  });

  it('builds lookup JIDs with and without the ninth digit', () => {
    expect(buildWhatsappLookupJids('556198765432')).toEqual([
      '5561998765432@s.whatsapp.net',
      '556198765432@s.whatsapp.net',
    ]);
  });

  it('queries chats by whatsapp identity across equivalent JIDs', async () => {
    const queryMock = vi.fn().mockResolvedValue({
      rows: [{ id: 'chat-1', status: 'atendimentos' }],
    });

    const result = await findWhatsappChatByIdentity(
      { query: queryMock },
      {
        workspaceId: 'ws-1',
        phoneOrJid: '556198765432',
        statuses: ['gerais', 'atendimentos'],
        preferOpen: true,
      }
    );

    expect(result).toEqual({ id: 'chat-1', status: 'atendimentos' });
    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(queryMock.mock.calls[0]?.[1]).toEqual([
      'ws-1',
      [
        '5561998765432@s.whatsapp.net',
        '556198765432@s.whatsapp.net',
      ],
      ['gerais', 'atendimentos'],
      true,
      '5561998765432@s.whatsapp.net',
    ]);
  });

  it('resolves a canonical active chat id for duplicated whatsapp chats', async () => {
    const queryMock = vi.fn(async (sql: string) => {
      if (sql.includes('WHERE ch.id = $1')) {
        return {
          rowCount: 1,
          rows: [
            {
              id: 'chat-legacy',
              workspace_id: 'ws-1',
              phone_number_jid: '556198765432@s.whatsapp.net',
            },
          ],
        };
      }

      if (sql.includes('WHERE ch.workspace_id = $1')) {
        return {
          rowCount: 1,
          rows: [{ id: 'chat-canonical', status: 'gerais' }],
        };
      }

      return { rowCount: 0, rows: [] };
    });

    const result = await resolveCanonicalWhatsappChatId(
      { query: queryMock },
      'chat-legacy'
    );

    expect(result).toBe('chat-canonical');
    expect(queryMock).toHaveBeenCalledTimes(2);
  });

  it('keeps the current chat id when there is no active whatsapp chat to canonicalize to', async () => {
    const queryMock = vi.fn().mockResolvedValue({
      rowCount: 0,
      rows: [],
    });

    const result = await resolveCanonicalWhatsappChatIdByIdentity(
      { query: queryMock },
      {
        workspaceId: 'ws-1',
        phoneOrJid: '556198765432@s.whatsapp.net',
        currentChatId: 'chat-legacy',
      }
    );

    expect(result).toBe('chat-legacy');
  });

  it('does not treat telegram identities as whatsapp identities', async () => {
    const queryMock = vi.fn().mockResolvedValue({
      rowCount: 1,
      rows: [
        {
          id: 'chat-telegram',
          workspace_id: 'ws-1',
          phone_number_jid: 'telegram:123456',
        },
      ],
    });

    const result = await resolveCanonicalWhatsappChatId(
      { query: queryMock },
      'chat-telegram'
    );

    expect(result).toBe('chat-telegram');
    expect(queryMock).toHaveBeenCalledTimes(1);
  });
});
