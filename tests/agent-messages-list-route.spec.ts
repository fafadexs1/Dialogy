import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  queryMock,
  sendAutomatedMessageActionMock,
  sendAutomatedMediaActionMock,
  sendAgentListActionMock,
  sendAgentButtonsActionMock,
} = vi.hoisted(() => ({
  queryMock: vi.fn(),
  sendAutomatedMessageActionMock: vi.fn(),
  sendAutomatedMediaActionMock: vi.fn(),
  sendAgentListActionMock: vi.fn(),
  sendAgentButtonsActionMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: { query: queryMock, connect: vi.fn() },
}));

vi.mock('@/actions/messages', () => ({
  sendAutomatedMessageAction: sendAutomatedMessageActionMock,
  sendAutomatedMediaAction: sendAutomatedMediaActionMock,
  sendAgentListAction: sendAgentListActionMock,
  sendAgentButtonsAction: sendAgentButtonsActionMock,
}));

vi.mock('@/lib/security/system-agent-access', () => ({
  chatBelongsToWorkspace: vi.fn().mockResolvedValue(true),
}));

vi.mock('@/lib/whatsapp/contact-identity', () => ({
  findOrCreateWhatsappContact: vi.fn(),
  findWhatsappChatByIdentity: vi.fn(),
  lockWhatsappIdentityTransaction: vi.fn(),
}));

import { POST } from '@/app/api/agent/messages/route';

describe('POST /api/agent/messages list sending', () => {
  beforeEach(() => {
    queryMock.mockReset();
    sendAutomatedMessageActionMock.mockReset();
    sendAutomatedMediaActionMock.mockReset();
    sendAgentListActionMock.mockReset();
    sendAgentButtonsActionMock.mockReset();
  });

  it('accepts an authenticated list without text content', async () => {
    queryMock.mockResolvedValue({
      rowCount: 1,
      rows: [{ id: 'agent-1', workspace_id: 'ws-1', is_active: true, type: 'default' }],
    });
    sendAgentListActionMock.mockResolvedValue({ success: true, chatId: 'chat-1' });

    const request = new Request('http://localhost/api/agent/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-1' },
      body: JSON.stringify({
        type: 'list',
        chatId: 'chat-1',
        phoneNumber: '556195215930',
        instance: 'zap1',
        list: {
          title: 'Cardápio de Teste',
          description: 'Escolha um item abaixo',
          buttonText: 'Ver opções',
          sections: [{ title: 'Bebidas', rows: [{ title: 'Coca-Cola', rowId: 'coca' }] }],
        },
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(sendAgentListActionMock).toHaveBeenCalledWith(expect.objectContaining({
      agentId: 'agent-1',
      workspaceId: 'ws-1',
      instanceName: 'zap1',
      chatId: 'chat-1',
      numberid: '556195215930',
    }));
  });

  it('forwards the no-signature marker for an SGP payment code', async () => {
    queryMock.mockResolvedValue({
      rowCount: 1,
      rows: [{ id: 'agent-1', workspace_id: 'ws-1', is_active: true, type: 'intelligent_attendant' }],
    });
    sendAutomatedMessageActionMock.mockResolvedValue({ success: true });

    const request = new Request('http://localhost/api/agent/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-1' },
      body: JSON.stringify({
        chatId: 'chat-1',
        content: 'PIX copia e cola:\n\n00020126PIX',
        skipUserSignature: true,
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(sendAutomatedMessageActionMock).toHaveBeenCalledWith(
      'chat-1',
      'PIX copia e cola:\n\n00020126PIX',
      'agent-1',
      true,
      undefined,
      { skipUserSignature: true },
    );
  });

  it('forwards the no-signature marker for an SGP invoice PDF', async () => {
    queryMock.mockResolvedValue({
      rowCount: 1,
      rows: [{ id: 'agent-1', workspace_id: 'ws-1', is_active: true, type: 'intelligent_attendant' }],
    });
    sendAutomatedMediaActionMock.mockResolvedValue({ success: true });
    const media = [{
      base64: 'https://sgp.example/fatura.pdf',
      mimetype: 'application/pdf',
      filename: 'fatura-123.pdf',
      mediatype: 'document',
    }];

    const request = new Request('http://localhost/api/agent/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-1' },
      body: JSON.stringify({
        chatId: 'chat-1',
        content: 'Fatura em PDF',
        media,
        skipUserSignature: true,
      }),
    });

    const response = await POST(request);

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

  it('keeps the default signature behavior for ordinary messages', async () => {
    queryMock.mockResolvedValue({
      rowCount: 1,
      rows: [{ id: 'agent-1', workspace_id: 'ws-1', is_active: true, type: 'intelligent_attendant' }],
    });
    sendAutomatedMessageActionMock.mockResolvedValue({ success: true });

    const request = new Request('http://localhost/api/agent/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-1' },
      body: JSON.stringify({ chatId: 'chat-1', content: 'Mensagem comum' }),
    });

    const response = await POST(request);

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
