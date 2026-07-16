import { beforeEach, describe, expect, it, vi } from 'vitest';

const { queryMock, sendAgentListActionMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  sendAgentListActionMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: { query: queryMock, connect: vi.fn() },
}));

vi.mock('@/actions/messages', () => ({
  sendAutomatedMessageAction: vi.fn(),
  sendAutomatedMediaAction: vi.fn(),
  sendAgentListAction: sendAgentListActionMock,
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
    sendAgentListActionMock.mockReset();
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
});
