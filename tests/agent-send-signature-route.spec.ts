import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  queryMock,
  sendAutomatedMessageActionMock,
  sendAutomatedMediaActionMock,
} = vi.hoisted(() => ({
  queryMock: vi.fn(),
  sendAutomatedMessageActionMock: vi.fn(),
  sendAutomatedMediaActionMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: { query: queryMock, connect: vi.fn() },
}));

vi.mock('@/actions/messages', () => ({
  sendAutomatedMessageAction: sendAutomatedMessageActionMock,
  sendAutomatedMediaAction: sendAutomatedMediaActionMock,
  sendAgentTemplateAction: vi.fn(),
  sendAgentListAction: vi.fn(),
}));

vi.mock('@/lib/security/system-agent-access', () => ({
  chatBelongsToWorkspace: vi.fn().mockResolvedValue(true),
}));

vi.mock('@/lib/whatsapp/contact-identity', () => ({
  findOrCreateWhatsappContact: vi.fn(),
  findWhatsappChatByIdentity: vi.fn(),
  lockWhatsappIdentityTransaction: vi.fn(),
}));

import { POST } from '@/app/api/agent/send/route';

describe('POST /api/agent/send signature control', () => {
  beforeEach(() => {
    queryMock.mockReset();
    sendAutomatedMessageActionMock.mockReset();
    sendAutomatedMediaActionMock.mockReset();
    queryMock.mockResolvedValue({
      rowCount: 1,
      rows: [{ id: 'agent-1', workspace_id: 'ws-1', is_active: true, type: 'intelligent_attendant' }],
    });
  });

  it('forwards the no-signature marker for an SGP invoice PDF', async () => {
    sendAutomatedMediaActionMock.mockResolvedValue({ success: true });
    const media = [{
      base64: 'https://sgp.example/fatura.pdf',
      mimetype: 'application/pdf',
      filename: 'fatura-123.pdf',
      mediatype: 'document',
    }];

    const response = await POST(new Request('http://localhost/api/agent/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-1' },
      body: JSON.stringify({
        type: 'media',
        chatId: 'chat-1',
        content: 'Fatura em PDF',
        media,
        skipUserSignature: true,
      }),
    }));

    expect(response.status).toBe(200);
    expect(sendAutomatedMediaActionMock).toHaveBeenCalledWith(
      'chat-1',
      'Fatura em PDF',
      media,
      'agent-1',
      undefined,
      { skipUserSignature: true },
    );
  });

  it('keeps the default signature behavior for ordinary text', async () => {
    sendAutomatedMessageActionMock.mockResolvedValue({ success: true });

    const response = await POST(new Request('http://localhost/api/agent/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-1' },
      body: JSON.stringify({
        type: 'text',
        chatId: 'chat-1',
        content: 'Mensagem comum',
      }),
    }));

    expect(response.status).toBe(200);
    expect(sendAutomatedMessageActionMock).toHaveBeenCalledWith(
      'chat-1',
      'Mensagem comum',
      'agent-1',
      true,
      undefined,
      {},
    );
  });
});
