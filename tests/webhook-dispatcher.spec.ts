import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Chat, Message } from '@/lib/types';

const { queryMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    query: queryMock,
  },
}));

import { dispatchMessageToWebhooks } from '@/services/webhook-dispatcher';

describe('dispatchMessageToWebhooks', () => {
  const originalFetch = globalThis.fetch;

  const baseChat: Chat = {
    id: 'chat-1',
    workspace_id: 'ws-1',
    status: 'gerais',
    contact: {
      id: 'contact-1',
      workspace_id: 'ws-1',
      name: 'Henrique Bitencourt',
    },
    messages: [],
  };

  const baseMessage: Message = {
    id: 'msg-1',
    chat_id: 'chat-1',
    workspace_id: 'ws-1',
    content: '3',
    type: 'text',
    status: 'default',
    transcription: null,
    timestamp: '',
    createdAt: '2026-03-11T10:00:00.000Z',
    formattedDate: '',
    from_me: false,
    direction: 'incoming',
  };

  beforeEach(() => {
    queryMock.mockReset();
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function mockDatabase(instanceType: 'wa_cloud' | 'baileys' | 'telegram') {
    queryMock.mockImplementation(async (sql: string) => {
      const text = String(sql);

      if (text.includes('FROM system_agents')) {
        return {
          rows: [
            {
              id: 'sys-agent-1',
              name: 'Agente',
              webhook_url: 'https://agent.example/webhook',
              token: 'token-1',
              type: 'support',
            },
          ],
          rowCount: 1,
        };
      }

      if (text.includes('SELECT name FROM workspaces')) {
        return {
          rows: [{ name: 'Velpro Telecom' }],
          rowCount: 1,
        };
      }

      if (text.includes('FROM contacts c')) {
        return {
          rows: [
            {
              id: 'contact-1',
              name: 'Henrique Bitencourt',
              phone_number_jid: '556192530704@s.whatsapp.net',
              email: '',
              avatar_url: 'https://example.com/avatar.jpg',
              custom_fields: {},
            },
          ],
          rowCount: 1,
        };
      }

      if (text.includes('FROM evolution_api_instances') || text.includes('FROM telegram_bot_instances')) {
        return {
          rows: [{ type: instanceType }],
          rowCount: 1,
        };
      }

      if (text.includes("metadata->>'marketingTargetSystemAgentId'")) {
        return {
          rows: [],
          rowCount: 0,
        };
      }

      if (text.includes('INSERT INTO webhook_logs')) {
        return {
          rows: [],
          rowCount: 1,
        };
      }

      throw new Error(`Unexpected query: ${text}`);
    });
  }

  it('includes cloud as the conversation instance type', async () => {
    mockDatabase('wa_cloud');

    await dispatchMessageToWebhooks(baseChat, baseMessage, 'zap7');

    expect(globalThis.fetch).toHaveBeenCalledOnce();
    const [, options] = (globalThis.fetch as any).mock.calls[0];
    const body = JSON.parse(options.body);

    expect(body.conversation.instance_name).toBe('zap7');
    expect(body.conversation.instance_type).toBe('cloud');
  });

  it('includes baileys as the conversation instance type', async () => {
    mockDatabase('baileys');

    await dispatchMessageToWebhooks(baseChat, baseMessage, 'zap7');

    expect(globalThis.fetch).toHaveBeenCalledOnce();
    const [, options] = (globalThis.fetch as any).mock.calls[0];
    const body = JSON.parse(options.body);

    expect(body.conversation.instance_type).toBe('baileys');
  });

  it('includes telegram as the conversation channel and instance type', async () => {
    mockDatabase('telegram');

    await dispatchMessageToWebhooks(baseChat, baseMessage, 'tg1');

    expect(globalThis.fetch).toHaveBeenCalledOnce();
    const [, options] = (globalThis.fetch as any).mock.calls[0];
    const body = JSON.parse(options.body);

    expect(body.conversation.channel).toBe('Telegram');
    expect(body.conversation.instance_type).toBe('telegram');
  });

  it('handles HTML 502 error response without throwing invalid JSON error in logWebhookAttempt', async () => {
    mockDatabase('wa_cloud');
    const htmlResponse = '<html><body>502 Bad Gateway</body></html>';
    globalThis.fetch = vi.fn(
      async () => new Response(htmlResponse, { status: 502, headers: { 'content-type': 'text/html' } }),
    ) as unknown as typeof fetch;

    await dispatchMessageToWebhooks(baseChat, baseMessage, 'zap1');

    const logCalls = queryMock.mock.calls.filter((call: any[]) =>
      String(call[0]).includes('INSERT INTO webhook_logs'),
    );
    expect(logCalls.length).toBe(1);
    const [, params] = logCalls[0];
    expect(params[3]).toBe(502);
    expect(params[6]).toEqual({ raw: htmlResponse });
  });
});
