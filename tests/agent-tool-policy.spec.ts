import { describe, expect, it, vi } from 'vitest';

import type { AutopilotConfig, Chat, Contact } from '@/lib/types';
import type { AgentToolRuntimeContext } from '@/services/agent-tools/types';
import { evaluateAgentToolPolicy } from '@/services/agent-tools/policy';

vi.mock('@/services/mcp/store', () => ({
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

  it('allows router reboot after an explicit customer confirmation', async () => {
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

    expect(result).toEqual({ allowed: true, riskLevel: 'high' });
  });

  it('allows a short confirmation after the agent explicitly asks to reboot the router', async () => {
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

    expect(result).toEqual({ allowed: true, riskLevel: 'high' });
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
});
