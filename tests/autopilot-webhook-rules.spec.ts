import { EventEmitter } from 'node:events';

import { describe, expect, it, vi } from 'vitest';

const { httpsRequestMock, lookupMock } = vi.hoisted(() => ({
  httpsRequestMock: vi.fn(),
  lookupMock: vi.fn(),
}));

vi.mock('node:dns/promises', () => ({
  lookup: lookupMock,
}));

vi.mock('node:https', () => ({
  request: httpsRequestMock,
}));

import { executeTriggeredWebhookRule } from '@/services/autopilot/runtime/webhook-rules';

function webhookInput(url: string) {
  return {
    rule: {
      id: 'rule-1',
      name: 'Consultar pedido',
      trigger: 'cliente pede status',
      enabled: true,
      action: { type: 'webhook' as const, url, method: 'POST' as const },
    },
    chat: { id: 'chat-1', workspace_id: 'workspace-1', status: 'open' },
    contact: { id: 'contact-1', name: 'Cliente de teste' },
    message: 'Onde esta meu pedido?',
  } as any;
}

describe('autopilot webhook rule execution', () => {
  it('blocks a direct private target before any server-side request is made', async () => {
    lookupMock.mockReset();
    httpsRequestMock.mockReset();

    await expect(executeTriggeredWebhookRule(webhookInput('https://127.0.0.1/internal')))
      .rejects.toThrow('Webhook URL must use HTTPS and target a public host.');

    expect(lookupMock).not.toHaveBeenCalled();
    expect(httpsRequestMock).not.toHaveBeenCalled();
  });

  it('pins a public hostname to its validated IP instead of resolving it again', async () => {
    lookupMock.mockReset();
    httpsRequestMock.mockReset();
    lookupMock.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
    let capturedOptions: any = null;
    httpsRequestMock.mockImplementation((options, callback) => {
      capturedOptions = options;
      const request = new EventEmitter() as any;
      request.setTimeout = vi.fn();
      request.write = vi.fn();
      request.end = vi.fn(() => {
        const response = new EventEmitter() as any;
        response.statusCode = 200;
        callback(response);
        response.emit('data', Buffer.from(JSON.stringify({ reply: 'Pedido localizado.' })));
        response.emit('end');
      });
      return request;
    });

    const result = await executeTriggeredWebhookRule(webhookInput('https://hooks.example.com/order-status'));

    expect(result).toMatchObject({ reply: 'Pedido localizado.' });
    expect(capturedOptions).toMatchObject({
      hostname: '8.8.8.8',
      servername: 'hooks.example.com',
      headers: expect.objectContaining({ Host: 'hooks.example.com' }),
    });
  });

  it('rejects a hostname that resolves to a private address before connecting', async () => {
    lookupMock.mockReset();
    httpsRequestMock.mockReset();
    lookupMock.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);

    await expect(executeTriggeredWebhookRule(webhookInput('https://hooks.example.com/order-status')))
      .rejects.toThrow('Webhook URL resolved to a private or reserved network address.');

    expect(httpsRequestMock).not.toHaveBeenCalled();
  });
});
