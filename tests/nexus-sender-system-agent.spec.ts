import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  dbQuery: vi.fn(),
  sendAutomatedMessageAction: vi.fn(),
  sendAgentListAction: vi.fn(),
  sendAgentButtonsAction: vi.fn(),
  transferChatToIntelligentAgentAction: vi.fn(),
  transferChatAction: vi.fn(),
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
  transferChatAction: mocks.transferChatAction,
  transferChatToIntelligentAgentAction: mocks.transferChatToIntelligentAgentAction,
}));
vi.mock('@/lib/security/trusted-server-context', () => ({
  createTrustedActorContext: vi.fn((value) => value),
}));
vi.mock('@/lib/whatsapp/evolution-api-client', () => ({ fetchEvolutionAPI: vi.fn() }));
vi.mock('@/lib/whatsapp/evolution-config', () => ({ getEvolutionApiConfig: vi.fn() }));
vi.mock('@/services/autopilot/automation-rules', () => ({ resolveSafeAutopilotWebhookTarget: vi.fn() }));
// Loaded on demand by queueHandoff: stub the heavy modules so the adapter can be exercised in isolation.
vi.mock('@/services/agent-tools/runtime', () => ({ formatTeamBusinessHours: vi.fn(async () => 'Segunda a Sexta das 08:00 às 18:00') }));
vi.mock('@/lib/realtime/chat-broadcast', () => ({ broadcastChatUpdate: vi.fn(async () => undefined) }));
vi.mock('@/services/autopilot/procedure-store', () => ({ abortActiveProcedures: vi.fn(async () => 0) }));
import { createNexusChatAdapters, resolveNexusSenderSystemAgent } from '@/modules/nexus/services/chat-adapters';
import type { NodeRuntimeInput } from '@/services/workflow-runtime';
import { linearWorkflow, workflowNode } from './workflow-runtime-fixtures';

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
    mocks.transferChatAction.mockReset().mockResolvedValue({ success: true });
  });

  it('passes the selected contract and new address as an internal transfer summary', async () => {
    mocks.dbQuery.mockResolvedValue({ rows: [{ id: 'sender-1', name: 'Velpro' }] });
    const adapters = await createNexusChatAdapters({ workspaceId: 'workspace-1', chatId: 'chat-1' });
    const input = runtimeInput('sender-1');
    input.node = workflowNode('output.handoff', 'address-handoff', {
      teamId: 'commercial', persistReason: true,
      reason: 'Transferência de endereço. {{sgpIdentification.summary}}. Novo endereço: {{novo_endereco}}',
    });
    input.execution.variables = { sgpIdentification: { summary: 'Contrato 123 — endereço atual' }, novo_endereco: 'Rua Nova, 10' };
    await adapters.handoff!(input);
    expect(mocks.transferChatAction).toHaveBeenCalledWith(expect.objectContaining({
      chatId: 'chat-1', teamId: 'commercial', handoffSummary: 'Transferência de endereço. Contrato 123 — endereço atual. Novo endereço: Rua Nova, 10',
    }), expect.anything());
    expect(mocks.sendAutomatedMessageAction).not.toHaveBeenCalled();
  });

  it('queues the chat for the team and tells the customer when nobody can take it', async () => {
    mocks.dbQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('system_agents')) return { rows: [{ id: 'sender-1', name: 'Velpro' }] };
      if (sql.includes("metadata->>'operationId'")) return { rows: [], rowCount: 0 };
      if (sql.includes('FROM teams')) return { rows: [{ name: 'Financeiro', tag: 'Financeiro', color: '#fff' }], rowCount: 1 };
      if (sql.includes('UPDATE chats')) return { rows: [{ chat_id: 'chat-1' }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const adapters = await createNexusChatAdapters({ workspaceId: 'workspace-1', chatId: 'chat-1' });
    const input = runtimeInput('sender-1');
    input.node = workflowNode('output.handoff', 'finance-handoff', { teamId: 'team-1' });
    const result = await adapters.queueHandoff!(input, { reasonCode: 'all_offline', teamId: 'team-1', error: 'Nenhum agente online.' });
    expect(result).toMatchObject({ queued: true, teamName: 'Financeiro', reasonCode: 'all_offline', teamId: 'team-1' });
    expect(mocks.sendAutomatedMessageAction).toHaveBeenCalledWith('chat-1', expect.stringContaining('fila de espera'), 'sender-1', true, undefined);
    const update = mocks.dbQuery.mock.calls.find(([sql]) => String(sql).includes('UPDATE chats'))!;
    expect(JSON.parse(update[1][7])).toMatchObject({ event: 'transfer_queued', operationId: 'nexus:execution-1:finance-handoff' });
  });

  it('can queue silently when the flow sends its own message', async () => {
    mocks.dbQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('system_agents')) return { rows: [{ id: 'sender-1', name: 'Velpro' }] };
      if (sql.includes("metadata->>'operationId'")) return { rows: [], rowCount: 0 };
      if (sql.includes('FROM teams')) return { rows: [{ name: 'Comercial', tag: 'Comercial', color: '#fff' }], rowCount: 1 };
      return { rows: [{ chat_id: 'chat-1' }], rowCount: 1 };
    });
    const adapters = await createNexusChatAdapters({ workspaceId: 'workspace-1', chatId: 'chat-1' });
    const input = runtimeInput('sender-1');
    input.node = workflowNode('output.handoff', 'sales-handoff', { teamId: 'team-2', queueNotice: false });
    const result = await adapters.queueHandoff!(input, { reasonCode: 'portfolio_full', teamId: 'team-2', error: 'Limite.' });
    expect(result).toMatchObject({ queued: true, notificationDelivered: null });
    expect(mocks.sendAutomatedMessageAction).not.toHaveBeenCalled();
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

  it('uses the approved official instance after an approval resumes without an adapter instance', async () => {
    mocks.dbQuery.mockResolvedValue({ rows: [{ id:'sender-1', name:'Agente' }] });
    const adapters=await createNexusChatAdapters({workspaceId:'workspace-1',chatId:'chat-1'});
    const input=runtimeInput('sender-1');
    input.node=workflowNode('tool.whatsapp_reply','approved-send');
    input.execution.context.instanceName='official-channel';
    await adapters.sendResponse!('Resposta aprovada',input);
    expect(mocks.sendAutomatedMessageAction).toHaveBeenCalledWith('chat-1','Resposta aprovada','sender-1',true,'official-channel',expect.objectContaining({nexusNodeId:'approved-send'}));
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

  it('uses a complete numbered fallback instead of truncating dynamic choices above the WhatsApp limit', async () => {
    mocks.dbQuery.mockResolvedValue({ rows: [{ id: 'sender-1', name: 'Velpro' }] });
    const adapters = await createNexusChatAdapters({
      workspaceId: 'workspace-1',
      chatId: 'chat-1',
      instanceName: 'zap1',
    });
    const input = runtimeInput('sender-1');
    input.node = { id: 'sgp-second-copy', type: 'dialogy.sgp_second_copy', config: {} } as NodeRuntimeInput['node'];
    const choices = Array.from({ length: 11 }, (_, index) => ({
      id: `invoice-${index + 1}`,
      label: `${String(index + 1).padStart(2, '0')}/2026 - R$ 99,90`,
    }));

    await adapters.sendOptions!({ title: 'Qual fatura você deseja pagar?', choices }, input);

    expect(mocks.sendAgentListAction).not.toHaveBeenCalled();
    expect(mocks.sendAutomatedMessageAction).toHaveBeenCalledWith(
      'chat-1',
      expect.stringContaining('11. 11/2026 - R$ 99,90'),
      'sender-1',
      true,
      'zap1',
      expect.objectContaining({ nexusNodeId: 'sgp-second-copy' }),
    );
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

  it('ends the Nexus execution by transferring ownership to the published Studio agent', async () => {
    mocks.dbQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM public.system_agents agent')) {
        return { rows: [{
          id: 'ai-sender-1',
          name: 'Raquel',
          type: 'intelligent_attendant',
          autopilot_config_id: '11111111-1111-4111-8111-111111111111',
          autopilot_is_active: true,
        }] };
      }
      if (sql.includes('FROM public.chats')) {
        return { rows: [{
          assigned_system_agent_id: null,
          agent_id: null,
          status: 'gerais',
          is_autopilot_active: false,
          autopilot_config_id: null,
        }] };
      }
      return { rows: [] };
    });
    const adapters = await createNexusChatAdapters({
      workspaceId: 'workspace-1',
      chatId: 'chat-1',
      instanceName: 'zap1',
    });
    const input = runtimeInput('ai-sender-1');
    input.node = {
      id: 'published-agent-1',
      type: 'ai.published_agent',
      config: { agentId: '11111111-1111-4111-8111-111111111111', releaseId: 'release-1' },
    } as unknown as NodeRuntimeInput['node'];

    await expect(adapters.executePublishedAgent!(input)).resolves.toMatchObject({
      status: 'completed',
      output: {
        delegated: true,
        transferred: true,
        systemAgentId: 'ai-sender-1',
        autopilotConfigId: '11111111-1111-4111-8111-111111111111',
      },
    });

    expect(mocks.transferChatToIntelligentAgentAction).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: 'chat-1',
        systemAgentId: 'ai-sender-1',
        nexusEventContext: expect.objectContaining({ causedByNodeId: 'published-agent-1' }),
      }),
      expect.objectContaining({ isSystemAgent: true, user: { id: 'ai-sender-1', name: 'Raquel' } }),
    );
    expect(mocks.sendAutomatedMessageAction).not.toHaveBeenCalled();
  });

  it('does not create another transfer when the Studio agent already owns the chat', async () => {
    mocks.dbQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM public.system_agents agent')) {
        return { rows: [{
          id: 'ai-sender-1', name: 'Raquel', type: 'intelligent_attendant',
          autopilot_config_id: '11111111-1111-4111-8111-111111111111', autopilot_is_active: true,
        }] };
      }
      return { rows: [{
        assigned_system_agent_id: 'ai-sender-1', agent_id: null, status: 'atendimentos',
        is_autopilot_active: true, autopilot_config_id: '11111111-1111-4111-8111-111111111111',
      }] };
    });
    const adapters = await createNexusChatAdapters({ workspaceId: 'workspace-1', chatId: 'chat-1' });
    const input = runtimeInput('ai-sender-1');
    input.node = {
      id: 'published-agent-1', type: 'ai.published_agent',
      config: { agentId: '11111111-1111-4111-8111-111111111111', releaseId: 'release-1' },
    } as unknown as NodeRuntimeInput['node'];

    await expect(adapters.executePublishedAgent!(input)).resolves.toMatchObject({
      status: 'completed',
      output: { delegated: true, transferred: false, systemAgentId: 'ai-sender-1' },
    });

    expect(mocks.transferChatToIntelligentAgentAction).not.toHaveBeenCalled();
  });
});
