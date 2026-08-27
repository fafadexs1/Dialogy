import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  dbQuery: vi.fn(),
  sendAutomatedMessageAction: vi.fn(),
  sendAgentListAction: vi.fn(),
  sendAgentButtonsAction: vi.fn(),
  transferChatToIntelligentAgentAction: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ db: { query: mocks.dbQuery } }));
vi.mock('@/actions/messages', () => ({
  sendAutomatedMessageAction: mocks.sendAutomatedMessageAction,
  sendAutomatedMediaAction: vi.fn(),
  sendAgentTemplateAction: vi.fn(),
  sendAgentListAction: mocks.sendAgentListAction,
  sendAgentButtonsAction: mocks.sendAgentButtonsAction,
}));
vi.mock('@/actions/chats', () => ({
  closeChatAction: vi.fn(),
  transferChatAction: vi.fn(),
  transferChatToIntelligentAgentAction: mocks.transferChatToIntelligentAgentAction,
}));
vi.mock('@/lib/security/trusted-server-context', () => ({
  createTrustedActorContext: vi.fn((value) => value),
}));
vi.mock('@/lib/whatsapp/evolution-api-client', () => ({ fetchEvolutionAPI: vi.fn() }));
vi.mock('@/lib/whatsapp/evolution-config', () => ({ getEvolutionApiConfig: vi.fn() }));
vi.mock('@/services/autopilot/automation-rules', () => ({ resolveSafeAutopilotWebhookTarget: vi.fn() }));

import { createNexusChatAdapters, resolveNexusSenderSystemAgent } from '@/modules/nexus/services/chat-adapters';
import type { NodeRuntimeInput } from '@/services/workflow-runtime';
import { linearWorkflow } from './workflow-runtime-fixtures';

function runtimeInput(senderSystemAgentId?: string): NodeRuntimeInput {
  const workflow = linearWorkflow();
  workflow.id = 'nexus:flow-1';
  workflow.version = 'v3';
  workflow.name = 'Fluxo Comercial';
  workflow.metadata = senderSystemAgentId ? { senderSystemAgentId } : {};
  return {
    workflow,
    node: { id: 'respond-1' },
    execution: { executionId: 'execution-1', context: {} },
  } as NodeRuntimeInput;
}

describe('Nexus system-agent sender attribution', () => {
  beforeEach(() => {
    mocks.dbQuery.mockReset();
    mocks.sendAutomatedMessageAction.mockReset().mockResolvedValue({ success: true });
    mocks.sendAgentListAction.mockReset().mockResolvedValue({ success: true, providerAccepted: true });
    mocks.sendAgentButtonsAction.mockReset().mockResolvedValue({ success: true, providerAccepted: true });
    mocks.transferChatToIntelligentAgentAction.mockReset().mockResolvedValue({ success: true });
  });

  it('sends every response as the system agent stored in the workflow version', async () => {
    mocks.dbQuery.mockResolvedValue({ rows: [{ id: 'sender-1', name: 'Velpro' }] });
    const adapters = await createNexusChatAdapters({
      workspaceId: 'workspace-1',
      chatId: 'chat-1',
      instanceName: 'zap1',
    });
    const input = runtimeInput('sender-1');

    await adapters.sendResponse!('Primeira mensagem', input);
    await adapters.sendResponse!('Segunda mensagem', input);

    expect(mocks.dbQuery).toHaveBeenCalledTimes(1);
    expect(mocks.dbQuery.mock.calls[0]?.[1]).toEqual(['workspace-1', 'sender-1']);
    expect(mocks.sendAutomatedMessageAction).toHaveBeenCalledTimes(2);
    expect(mocks.sendAutomatedMessageAction).toHaveBeenNthCalledWith(
      1,
      'chat-1',
      'Primeira mensagem',
      'sender-1',
      true,
      'zap1',
      expect.objectContaining({
        deliveryGuarantee: 'ordered',
        nexusExecutionId: 'execution-1',
        nexusNodeId: 'respond-1',
        nexusDeliveryId: 'execution-1:respond-1:',
      }),
    );
  });

  it('delivers option blocks as one native list without also sending the text fallback', async () => {
    mocks.dbQuery.mockResolvedValue({ rows: [{ id: 'sender-1', name: 'Velpro' }] });
    const adapters = await createNexusChatAdapters({
      workspaceId: 'workspace-1',
      chatId: 'chat-1',
      instanceName: 'zap1',
    });
    const input = runtimeInput('sender-1');
    input.node = {
      id: 'menu-1',
      type: 'interaction.options',
      config: {
        prompt: 'Escolha uma opcao:',
        deliveryMode: 'list',
        options: [
          { id: 'sales', value: 'Comercial', label: 'Comercial' },
          { id: 'support', value: 'Suporte', label: 'Suporte' },
          { id: 'address', value: '🔄Transferência de Endereço', label: 'Transferência de Endereço' },
        ],
      },
    } as unknown as NodeRuntimeInput['node'];

    await adapters.sendResponse!('fallback numerado', input);

    expect(mocks.sendAgentListAction).toHaveBeenCalledWith(expect.objectContaining({
      agentId: 'sender-1',
      workspaceId: 'workspace-1',
      instanceName: 'zap1',
      chatId: 'chat-1',
      list: expect.objectContaining({
        title: 'Escolha uma opcao:',
        buttonText: 'Ver opcoes',
        sections: [expect.objectContaining({
          rows: [
            expect.objectContaining({ rowId: 'sales', title: 'Comercial' }),
            expect.objectContaining({ rowId: 'support', title: 'Suporte' }),
            expect.objectContaining({ rowId: 'address', title: '🔄Transferência de Ender' }),
          ],
        })],
        footerText: '',
      }),
    }));
    expect(mocks.sendAutomatedMessageAction).not.toHaveBeenCalled();
  });

  it('delivers dynamic SGP choices through the same native WhatsApp list path', async () => {
    mocks.dbQuery.mockResolvedValue({ rows: [{ id: 'sender-1', name: 'Velpro' }] });
    const adapters = await createNexusChatAdapters({
      workspaceId: 'workspace-1',
      chatId: 'chat-1',
      instanceName: 'zap1',
    });
    const input = runtimeInput('sender-1');
    input.node = { id: 'sgp-second-copy', type: 'dialogy.sgp_second_copy', config: {} } as NodeRuntimeInput['node'];

    await adapters.sendOptions!(
      {
        title: 'Qual fatura você deseja pagar?',
        choices: [{ id: 'invoice-1', label: '09/2026 - R$ 139,89' }],
      },
      input,
    );

    expect(mocks.sendAgentListAction).toHaveBeenCalledWith(expect.objectContaining({
      list: expect.objectContaining({
        title: 'Qual fatura você deseja pagar?',
        footerText: '',
        sections: [expect.objectContaining({
          rows: [expect.objectContaining({ rowId: 'invoice-1', title: '09/2026 - R$ 139,89' })],
        })],
      }),
    }));
    expect(mocks.sendAutomatedMessageAction).not.toHaveBeenCalled();
  });

  it('refuses to create a hidden fallback when the flow has no selected sender', async () => {
    const adapters = await createNexusChatAdapters({ workspaceId: 'workspace-1', chatId: 'chat-1' });

    await expect(adapters.sendResponse!('Mensagem', runtimeInput())).rejects.toThrow(
      'não possui um agente remetente configurado',
    );
    expect(mocks.dbQuery).not.toHaveBeenCalled();
    expect(mocks.sendAutomatedMessageAction).not.toHaveBeenCalled();
  });

  it('rejects an inactive or foreign system agent at runtime', async () => {
    mocks.dbQuery.mockResolvedValue({ rows: [] });

    await expect(resolveNexusSenderSystemAgent({
      workspaceId: 'workspace-1',
      workflow: runtimeInput('foreign-agent').workflow,
    })).rejects.toThrow('não pertence a este workspace ou não está ativo');
  });

  it('executes the AI linked to the selected system agent from an AI block', async () => {
    mocks.dbQuery.mockResolvedValue({ rows: [{
      id: 'ai-sender-1',
      name: 'Raquel',
      type: 'intelligent_attendant',
      autopilot_config_id: 'autopilot-1',
      autopilot_is_active: true,
    }] });
    const adapters = await createNexusChatAdapters({
      workspaceId: 'workspace-1',
      chatId: 'chat-1',
      instanceName: 'zap1',
    });
    const input = runtimeInput('ai-sender-1');
    input.node = { id: 'agent-node-1' } as NodeRuntimeInput['node'];

    const result = await adapters.executeLinkedAgent!(input);

    expect(result).toMatchObject({
      handled: true,
      success: true,
      delegated: true,
      systemAgentId: 'ai-sender-1',
      autopilotConfigId: 'autopilot-1',
    });
    expect(mocks.transferChatToIntelligentAgentAction).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: 'chat-1',
        systemAgentId: 'ai-sender-1',
        nexusEventContext: expect.objectContaining({ causedByNodeId: 'agent-node-1' }),
      }),
      expect.objectContaining({ isSystemAgent: true, user: { id: 'ai-sender-1', name: 'Raquel' } }),
    );
  });

  it('keeps a regular selected agent as sender without trying to execute linked AI', async () => {
    mocks.dbQuery.mockResolvedValue({ rows: [{ id: 'sender-1', name: 'Velpro', type: 'default' }] });
    const adapters = await createNexusChatAdapters({ workspaceId: 'workspace-1', chatId: 'chat-1' });

    await expect(adapters.executeLinkedAgent!(runtimeInput('sender-1'))).resolves.toMatchObject({ handled: false });
    expect(mocks.transferChatToIntelligentAgentAction).not.toHaveBeenCalled();
  });
});
