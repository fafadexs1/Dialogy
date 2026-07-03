import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sendAutomatedMessageAction: vi.fn(),
  dbQuery: vi.fn(),
  prepareDelivery: vi.fn(),
  markSending: vi.fn(),
  markDelivered: vi.fn(),
  markError: vi.fn(),
  assertSourceCurrent: vi.fn(),
}));

vi.mock('@/actions/messages', () => ({
  sendAutomatedMessageAction: mocks.sendAutomatedMessageAction,
}));

vi.mock('@/lib/db', () => ({
  db: {
    query: mocks.dbQuery,
  },
}));

vi.mock('@/lib/realtime/chat-broadcast', () => ({
  broadcastChatUpdate: vi.fn(),
}));

vi.mock('@/services/autopilot/runtime/response-delivery', () => ({
  prepareAutopilotResponseDelivery: mocks.prepareDelivery,
  markAutopilotResponseBlockSending: mocks.markSending,
  markAutopilotResponseBlockDelivered: mocks.markDelivered,
  markAutopilotResponseDeliveryError: mocks.markError,
}));

vi.mock('@/services/autopilot/runtime/stale-source-guard', () => ({
  assertAutopilotSourceMessageCurrent: mocks.assertSourceCurrent,
}));

import { sendMultiBlockResponse } from '@/services/autopilot/runtime/message-sender';

const trace = {
  workspaceId: 'workspace-1',
  sourceMessageId: 'message-1',
  orchestratorRunId: 'run-2',
};

describe('autopilot multi-block response delivery', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.sendAutomatedMessageAction.mockReset();
    mocks.dbQuery.mockReset();
    mocks.prepareDelivery.mockReset();
    mocks.markSending.mockReset();
    mocks.markDelivered.mockReset();
    mocks.markError.mockReset();
    mocks.assertSourceCurrent.mockReset();
    mocks.dbQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    mocks.sendAutomatedMessageAction.mockResolvedValue({
      success: true,
      providerAccepted: true,
    });
    mocks.markSending.mockResolvedValue(undefined);
    mocks.markDelivered.mockResolvedValue(undefined);
    mocks.markError.mockResolvedValue(undefined);
    mocks.assertSourceCurrent.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not call the provider when the durable delivery is already complete', async () => {
    mocks.prepareDelivery.mockResolvedValue({
      id: 'delivery-1',
      blocks: ['Resposta original'],
      deliveredBlockIndexes: new Set([0]),
      status: 'sent',
    });

    await sendMultiBlockResponse(
      'chat-1',
      'Resposta regenerada',
      'agent-1',
      true,
      'instance-1',
      null,
      trace,
    );

    expect(mocks.sendAutomatedMessageAction).not.toHaveBeenCalled();
  });

  it('resumes at the missing block and preserves the original response plan', async () => {
    mocks.prepareDelivery.mockResolvedValue({
      id: 'delivery-1',
      blocks: ['Primeiro original', 'Segundo original'],
      deliveredBlockIndexes: new Set([0]),
      status: 'sending',
    });

    const sending = sendMultiBlockResponse(
      'chat-1',
      'Conteudo regenerado que deve ser ignorado',
      'agent-1',
      true,
      'instance-1',
      null,
      trace,
    );
    await vi.runAllTimersAsync();
    await sending;

    expect(mocks.sendAutomatedMessageAction).toHaveBeenCalledTimes(1);
    expect(mocks.sendAutomatedMessageAction).toHaveBeenCalledWith(
      'chat-1',
      'Segundo original',
      'agent-1',
      true,
      'instance-1',
      expect.objectContaining({
        autopilotSourceMessageId: 'message-1',
        autopilotOrchestratorRunId: 'run-2',
        autopilotResponseDeliveryId: 'delivery-1',
        autopilotResponseBlockIndex: 1,
        autopilotResponseBlockCount: 2,
      }),
    );
    expect(mocks.markSending).toHaveBeenCalledWith({
      deliveryId: 'delivery-1',
      blockIndex: 1,
    });
    expect(mocks.markDelivered).toHaveBeenCalledWith({
      deliveryId: 'delivery-1',
      blockIndex: 1,
      blockCount: 2,
    });
  });

  it('blocks provider delivery when a newer customer message superseded the source', async () => {
    mocks.assertSourceCurrent.mockRejectedValue(
      new Error('AUTOPILOT_SOURCE_SUPERSEDED'),
    );

    await expect(sendMultiBlockResponse(
      'chat-1',
      'Resposta antiga',
      'agent-1',
      true,
      'instance-1',
      null,
      trace,
    )).rejects.toThrow('AUTOPILOT_SOURCE_SUPERSEDED');

    expect(mocks.prepareDelivery).not.toHaveBeenCalled();
    expect(mocks.sendAutomatedMessageAction).not.toHaveBeenCalled();
  });

  it('sends a repeated ordinary LLM response without disabling the chat', async () => {
    const response = 'Ja localizei os dados necessarios. Vou seguir com o atendimento usando as informacoes disponiveis e aviso antes de executar qualquer acao sensivel.';
    mocks.dbQuery.mockResolvedValue({
      rows: [{ content: `*RAQUEL (Agente Virtual)*:\n\n${response}` }],
      rowCount: 1,
    });

    const sending = sendMultiBlockResponse(
      'chat-1',
      response,
      'agent-1',
      true,
      'instance-1',
    );
    await vi.runAllTimersAsync();
    await sending;

    expect(mocks.sendAutomatedMessageAction).toHaveBeenCalledWith(
      'chat-1',
      response,
      'agent-1',
      true,
      'instance-1',
      undefined,
    );
    expect(mocks.dbQuery.mock.calls.some(([sql]) => (
      /UPDATE\s+chats/i.test(String(sql))
    ))).toBe(false);
  });
});
