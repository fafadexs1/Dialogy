import { describe, expect, it, vi } from 'vitest';

import type { AutopilotConfig, Chat, Contact } from '@/lib/types';
import type { AgentToolRuntimeContext } from '@/services/agent-tools/types';
import { evaluateAgentToolPolicy } from '@/services/agent-tools/policy';
import { fingerprintToolAction } from '@/services/agent-tools/action-fingerprint';

vi.mock('@/services/mcp/store', () => ({
  recordMcpServerHealth: vi.fn(async () => undefined),
  getMcpWorkspaceConfig: vi.fn(async () => ({
    servers: [
      {
        id: 'router-server',
        name: 'Routers',
        isActive: true,
        transport: 'streamable_http',
        url: 'http://localhost.invalid',
        tools: [
          {
            qualifiedName: 'mcp:router-server:find_router_by_ip',
            serverId: 'router-server',
            serverName: 'Routers',
            name: 'find_router_by_ip',
            annotations: { readOnlyHint: true },
          },
          {
            qualifiedName: 'mcp:router-server:reboot_router',
            serverId: 'router-server',
            serverName: 'Routers',
            name: 'reboot_router',
            annotations: { destructiveHint: true },
          },
          {
            qualifiedName: 'mcp:router-server:scan_wifi_neighbors',
            serverId: 'router-server',
            serverName: 'Routers',
            name: 'scan_wifi_neighbors',
            description: 'Realiza scan das redes Wi-Fi vizinhas e retorna canais e sinal.',
          },
          {
            qualifiedName: 'mcp:router-server:queue_set_parameters',
            serverId: 'router-server',
            serverName: 'Routers',
            name: 'queue_set_parameters',
            description: 'Enfileira SetParameterValues no roteador.',
          },
          {
            qualifiedName: 'mcp:router-server:clear_pending_commands',
            serverId: 'router-server',
            serverName: 'Routers',
            name: 'clear_pending_commands',
            description: 'Limpa comandos pendentes do roteador.',
          },
        ],
      },
    ],
  })),
}));

const context: AgentToolRuntimeContext = {
  workspaceId: 'workspace-1',
  chat: { id: 'chat-1' } as Chat,
  contact: { id: 'contact-1', workspace_id: 'workspace-1' } as Contact,
  systemAgentId: 'agent-1',
  systemAgentName: 'TicketMaster',
  autopilotConfig: { id: 'config-1' } as AutopilotConfig,
  turnPolicy: {
    activeNodeId: 'support',
    toolMode: 'on_demand',
    globallyEnabledToolNames: [
      'mcp:router-server:find_router_by_ip',
      'mcp:router-server:reboot_router',
    ],
    attachedToolNames: [
      'mcp:router-server:find_router_by_ip',
      'mcp:router-server:reboot_router',
    ],
    allowedToolNames: [
      'mcp:router-server:find_router_by_ip',
      'mcp:router-server:reboot_router',
    ],
    toolInstructionsByName: {},
    allowedKnowledgeDocumentIds: undefined,
    reason: 'test',
  },
  customerMessage: 'voce consegue verificar o roteador?',
};

describe('agent tool execution policy', () => {
  it('allows read-only MCP diagnostics without confirmation', async () => {
    const result = await evaluateAgentToolPolicy({
      context,
      action: {
        type: 'mcp_call_tool',
        payload: {
          toolName: 'mcp:router-server:find_router_by_ip',
          arguments: { client_ip: '192.0.2.10' },
        },
      },
    });

    expect(result).toEqual({ allowed: true, riskLevel: 'low' });
  });

  it('allows annotation-less observational Wi-Fi scans after exact turn-plan authorization', async () => {
    const toolName = 'mcp:router-server:scan_wifi_neighbors';
    const result = await evaluateAgentToolPolicy({
      context: {
        ...context,
        turnPolicy: {
          ...context.turnPolicy!,
          globallyEnabledToolNames: [...context.turnPolicy!.globallyEnabledToolNames, toolName],
          allowedToolNames: [...context.turnPolicy!.allowedToolNames, toolName],
        },
      },
      action: {
        type: 'mcp_call_tool',
        payload: {
          toolName,
          arguments: { client_ip: '192.0.2.10' },
        },
      },
    });

    expect(result).toEqual({ allowed: true, riskLevel: 'low' });
  });

  it.each([
    'mcp:router-server:queue_set_parameters',
    'mcp:router-server:clear_pending_commands',
  ])('classifies annotation-less mutating MCP %s as high risk and requires a persisted confirmation', async (toolName) => {
    const result = await evaluateAgentToolPolicy({
      context: {
        ...context,
        customerMessage: 'execute agora',
        turnPolicy: {
          ...context.turnPolicy!,
          globallyEnabledToolNames: [...context.turnPolicy!.globallyEnabledToolNames, toolName],
          allowedToolNames: [...context.turnPolicy!.allowedToolNames, toolName],
        },
      },
      action: {
        type: 'mcp_call_tool',
        payload: {
          toolName,
          arguments: { client_ip: '192.0.2.10' },
        },
      },
    });

    expect(result.allowed).toBe(false);
    expect(result.riskLevel).toBe('high');
    expect(result.reason).toContain('[tool_policy:confirmation_required]');
  });

  it('blocks find_router_by_ip when the selected contract has no IPv4', async () => {
    const result = await evaluateAgentToolPolicy({
      context,
      action: {
        type: 'mcp_call_tool',
        payload: {
          toolName: 'mcp:router-server:find_router_by_ip',
          arguments: {},
        },
      },
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('[tool_policy:missing_parameters]');
  });

  it('blocks router reboot until the customer confirms explicitly', async () => {
    const result = await evaluateAgentToolPolicy({
      context,
      action: {
        type: 'mcp_call_tool',
        payload: {
          toolName: 'mcp:router-server:reboot_router',
          arguments: { client_ip: '192.0.2.10' },
        },
      },
    });

    expect(result.allowed).toBe(false);
    expect(result.riskLevel).toBe('high');
    expect(result.reason).toContain('[tool_policy:confirmation_required]');
  });

  it('stages router reboot even when the first request already contains affirmative wording', async () => {
    const result = await evaluateAgentToolPolicy({
      context: {
        ...context,
        customerMessage: 'sim, pode reiniciar o roteador agora',
      },
      action: {
        type: 'mcp_call_tool',
        payload: {
          toolName: 'mcp:router-server:reboot_router',
          arguments: { client_ip: '192.0.2.10' },
        },
      },
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('[tool_policy:confirmation_required]');
  });

  it('does not trust a short confirmation without a consumed persisted action', async () => {
    const result = await evaluateAgentToolPolicy({
      context: {
        ...context,
        customerMessage: 'Sim',
        recentCustomerVisibleMessages: [
          {
            fromMe: true,
            content: 'Posso reiniciar seu roteador agora? A conexao pode ficar indisponivel por alguns minutos enquanto o equipamento reinicia.',
          },
          { fromMe: false, content: 'Sim' },
        ],
      },
      action: {
        type: 'mcp_call_tool',
        payload: {
          toolName: 'mcp:router-server:reboot_router',
          arguments: { client_ip: '192.0.2.10' },
        },
      },
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('[tool_policy:confirmation_required]');
  });

  it('allows only the exact action whose persisted fingerprint was consumed', async () => {
    const action = {
      type: 'mcp_call_tool' as const,
      payload: {
        toolName: 'mcp:router-server:reboot_router',
        arguments: { client_ip: '192.0.2.10' },
      },
    };
    const result = await evaluateAgentToolPolicy({
      context: {
        ...context,
        customerMessage: 'Sim',
        confirmedActionFingerprint: fingerprintToolAction(action),
      },
      action,
    });

    expect(result).toEqual({ allowed: true, riskLevel: 'high' });

    const changedActionResult = await evaluateAgentToolPolicy({
      context: {
        ...context,
        customerMessage: 'Sim',
        confirmedActionFingerprint: fingerprintToolAction(action),
      },
      action: {
        ...action,
        payload: {
          ...action.payload,
          arguments: { client_ip: '192.0.2.99' },
        },
      },
    });
    expect(changedActionResult.allowed).toBe(false);
    expect(changedActionResult.reason).toContain('[tool_policy:confirmation_');
  });

  it('does not bind a short confirmation to an unrelated agent question', async () => {
    const result = await evaluateAgentToolPolicy({
      context: {
        ...context,
        customerMessage: 'Sim',
        recentCustomerVisibleMessages: [
          { fromMe: true, content: 'Posso atualizar o seu cadastro agora?' },
          { fromMe: false, content: 'Sim' },
        ],
      },
      action: {
        type: 'mcp_call_tool',
        payload: {
          toolName: 'mcp:router-server:reboot_router',
          arguments: { client_ip: '192.0.2.10' },
        },
      },
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('[tool_policy:confirmation_context_missing]');
  });

  it('blocks a later action after a failed dependency', async () => {
    const result = await evaluateAgentToolPolicy({
      context: {
        ...context,
        customerMessage: 'sim, pode reiniciar o roteador agora',
      },
      action: {
        type: 'mcp_call_tool',
        payload: {
          toolName: 'mcp:router-server:reboot_router',
          arguments: { client_ip: '192.0.2.10' },
        },
      },
      previousResults: [
        {
          toolName: 'mcp:router-server:find_router_by_ip',
          status: 'error',
          input: {
            type: 'mcp_call_tool',
            payload: { toolName: 'mcp:router-server:find_router_by_ip' },
          },
          error: 'timeout',
        },
      ],
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('[tool_policy:dependency_failed]');
  });

  it('does not block transfer when the previous internal note failed', async () => {
    const result = await evaluateAgentToolPolicy({
      context: {
        ...context,
        customerMessage: 'Pode me transferir para um humano',
      },
      action: {
        type: 'transfer_chat',
        reason: 'Cliente pediu atendimento humano.',
        payload: { teamId: 'team-1' },
      },
      previousResults: [
        {
          toolName: 'add_internal_note',
          status: 'rejected',
          input: {
            type: 'add_internal_note',
            payload: { content: 'Cliente pediu humano.' },
          },
          error: 'Ferramenta habilitada no agente, mas nao liberada para o no atual do fluxo.',
        },
      ],
    });

    expect(result).toEqual({ allowed: true, riskLevel: 'medium' });
  });

  it('blocks payment promises outside a financial request before asking for confirmation', async () => {
    const result = await evaluateAgentToolPolicy({
      context,
      action: {
        type: 'sgp_create_payment_promise',
        payload: {
          contractId: 'contract-1',
          promiseDate: '2026-06-10',
        },
      },
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('[tool_policy:intent_mismatch]');
  });

  it('executes close_chat immediately when the current customer message explicitly closes the conversation', async () => {
    const result = await evaluateAgentToolPolicy({
      context: {
        ...context,
        customerMessage: 'Pode encerrar? USE close_chat',
        turnPolicy: {
          ...context.turnPolicy!,
          globallyEnabledToolNames: [...context.turnPolicy!.globallyEnabledToolNames, 'close_chat'],
          allowedToolNames: [...context.turnPolicy!.allowedToolNames, 'close_chat'],
        },
      },
      action: {
        type: 'close_chat',
        reason: 'Cliente pediu para encerrar o atendimento.',
        payload: { sendCloseMessage: false },
      },
    });

    expect(result).toEqual({ allowed: true, riskLevel: 'medium' });
  });

  it('allows a close reached through a server-authorized native terminal block', async () => {
    const action = {
      type: 'close_chat' as const,
      reason: 'Objetivo concluído.',
      payload: { sendCloseMessage: false },
    };
    const result = await evaluateAgentToolPolicy({
      context: {
        ...context,
        customerMessage: 'Perfeito, obrigado',
        orchestratorRunId: 'run-1',
        closeAuthorization: {
          source: 'workflow_goal_completed',
          chatId: 'chat-1',
          orchestratorRunId: 'run-1',
          workflowId: 'workflow-1',
          workflowVersion: '18',
          executionId: 'execution-1',
          terminalNodeId: 'close-node',
          actionFingerprint: fingerprintToolAction(action),
        },
      },
      action,
    });

    expect(result).toEqual({ allowed: true, riskLevel: 'medium' });
  });

  it('rejects a mismatched or forged native close authorization', async () => {
    const action = {
      type: 'close_chat' as const,
      reason: 'Objetivo concluído.',
      payload: { sendCloseMessage: false },
    };
    const result = await evaluateAgentToolPolicy({
      context: {
        ...context,
        customerMessage: 'Perfeito, obrigado',
        orchestratorRunId: 'run-1',
        closeAuthorization: {
          source: 'workflow_goal_completed',
          chatId: 'another-chat',
          orchestratorRunId: 'run-1',
          workflowId: 'workflow-1',
          workflowVersion: '18',
          executionId: 'execution-1',
          terminalNodeId: 'close-node',
          actionFingerprint: fingerprintToolAction(action),
        },
      },
      action,
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('[tool_policy:intent_mismatch]');
  });

  it('allows collection completion only with a fully bound server authorization', async () => {
    const action = {
      type: 'close_chat' as const,
      reason: 'Coleta concluída.',
      payload: { sendCloseMessage: false },
    };
    const result = await evaluateAgentToolPolicy({
      context: {
        ...context,
        customerMessage: 'Ana; 01310-100',
        orchestratorRunId: 'run-collection',
        sourceMessageId: 'message-current',
        closeAuthorization: {
          source: 'conversation_collection_completed',
          chatId: 'chat-1',
          orchestratorRunId: 'run-collection',
          sourceMessageId: 'message-current',
          workflowId: 'workflow-1',
          workflowVersion: '18',
          needsInputExecutionId: 'execution-before',
          completionExecutionId: 'execution-current',
          agentNodeId: 'agent-1',
          terminalNodeId: 'respond-1',
          pendingFieldsFingerprint: 'pending-hash',
          persistenceReceiptFingerprint: 'receipt-hash',
          checkpointFingerprint: 'checkpoint-hash',
          actionFingerprint: fingerprintToolAction(action),
        },
      },
      action,
    });

    expect(result).toEqual({ allowed: true, riskLevel: 'medium' });
  });

  it('rejects collection authorization from another source message or the same execution', async () => {
    const action = {
      type: 'close_chat' as const,
      reason: 'Coleta concluída.',
      payload: { sendCloseMessage: false },
    };
    const result = await evaluateAgentToolPolicy({
      context: {
        ...context,
        customerMessage: 'Obrigado',
        orchestratorRunId: 'run-collection',
        sourceMessageId: 'message-current',
        closeAuthorization: {
          source: 'conversation_collection_completed',
          chatId: 'chat-1',
          orchestratorRunId: 'run-collection',
          sourceMessageId: 'message-other',
          workflowId: 'workflow-1',
          workflowVersion: '18',
          needsInputExecutionId: 'execution-current',
          completionExecutionId: 'execution-current',
          agentNodeId: 'agent-1',
          terminalNodeId: 'respond-1',
          pendingFieldsFingerprint: 'pending-hash',
          persistenceReceiptFingerprint: 'receipt-hash',
          checkpointFingerprint: 'checkpoint-hash',
          actionFingerprint: fingerprintToolAction(action),
        },
      },
      action,
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('[tool_policy:intent_mismatch]');
  });

  it('does not treat cancellation of a business service as authorization to close the chat', async () => {
    const result = await evaluateAgentToolPolicy({
      context: {
        ...context,
        customerMessage: 'Quero cancelar meu plano de internet',
        turnPolicy: {
          ...context.turnPolicy!,
          globallyEnabledToolNames: [...context.turnPolicy!.globallyEnabledToolNames, 'close_chat'],
          allowedToolNames: [...context.turnPolicy!.allowedToolNames, 'close_chat'],
        },
      },
      action: {
        type: 'close_chat',
        reason: 'Encerrar atendimento.',
        payload: { sendCloseMessage: false },
      },
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('[tool_policy:intent_mismatch]');
  });
});
