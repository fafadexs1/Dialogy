import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  queryMock,
  sendAgentListActionMock,
} = vi.hoisted(() => ({
  queryMock: vi.fn(),
  sendAgentListActionMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    query: queryMock,
  },
}));

vi.mock('@/actions/messages', () => ({
  sendAutomatedMessageAction: vi.fn(),
  sendAutomatedMediaAction: vi.fn(),
  sendAgentTemplateAction: vi.fn(),
  sendAgentListAction: sendAgentListActionMock,
}));

import { POST } from '@/app/api/hooks/[token]/route';

describe('POST /api/hooks/[token] list sending', () => {
  beforeEach(() => {
    queryMock.mockReset();
    sendAgentListActionMock.mockReset();
  });

  it('routes list payloads to sendAgentListAction', async () => {
    queryMock.mockResolvedValue({
      rowCount: 1,
      rows: [
        {
          id: 'agent-1',
          workspace_id: 'ws-1',
          is_active: true,
          type: 'default',
          hide_from_chatlist: false,
          handoff_system_agent_id: null,
        },
      ],
    });

    sendAgentListActionMock.mockResolvedValue({
      success: true,
      chatId: 'chat-1',
      apiResponse: { id: 'api-msg-1' },
    });

    const request = new Request('http://localhost/api/hooks/token-1', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'list',
        phoneNumber: '556195215930',
        instance: 'zap7',
        title: 'List Title',
        description: 'List description',
        footerText: 'Footer text',
        buttonText: 'Click Here',
        delay: 1200,
        quoted: {
          key: {
            id: 'MESSAGE_ID',
          },
          message: {
            conversation: 'CONTENT_MESSAGE',
          },
        },
        mentionsEveryOne: false,
        mentioned: ['5511999999999@s.whatsapp.net'],
        sections: [
          {
            title: 'Section 01',
            rows: [
              {
                title: 'Option 01',
                description: 'First option',
                rowId: 'row-001',
              },
            ],
          },
        ],
      }),
    });

    const response = await POST(request, {
      params: Promise.resolve({ token: 'token-1' }),
    });

    expect(response.status).toBe(200);
    expect(sendAgentListActionMock).toHaveBeenCalledWith({
      agentId: 'agent-1',
      workspaceId: 'ws-1',
      instanceName: 'zap7',
      chatId: undefined,
      numberid: '556195215930',
      list: {
        title: 'List Title',
        description: 'List description',
        footerText: 'Footer text',
        buttonText: 'Click Here',
        delay: 1200,
        quoted: {
          key: {
            id: 'MESSAGE_ID',
          },
          message: {
            conversation: 'CONTENT_MESSAGE',
          },
        },
        mentionsEveryOne: false,
        mentioned: ['5511999999999@s.whatsapp.net'],
        sections: [
          {
            title: 'Section 01',
            rows: [
              {
                title: 'Option 01',
                description: 'First option',
                rowId: 'row-001',
              },
            ],
          },
        ],
      },
      metadata: {},
    });

    const json = await response.json();
    expect(json).toEqual({
      success: true,
      message: 'List sent successfully.',
      chatId: 'chat-1',
      apiResponse: { id: 'api-msg-1' },
    });
  });

  it('rejects list payloads without the list object', async () => {
    queryMock.mockResolvedValue({
      rowCount: 1,
      rows: [
        {
          id: 'agent-1',
          workspace_id: 'ws-1',
          is_active: true,
          type: 'default',
          hide_from_chatlist: false,
          handoff_system_agent_id: null,
        },
      ],
    });

    const request = new Request('http://localhost/api/hooks/token-1', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'list',
        phoneNumber: '556195215930',
        instance: 'zap7',
      }),
    });

    const response = await POST(request, {
      params: Promise.resolve({ token: 'token-1' }),
    });

    expect(response.status).toBe(400);
    expect(sendAgentListActionMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: 'List payload is required for type "list".',
    });
  });
});
