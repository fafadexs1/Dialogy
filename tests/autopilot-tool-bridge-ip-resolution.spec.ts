import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/agent-tools/runtime', () => ({
  runAgentTools: vi.fn(),
}));

import { runAgentTools } from '@/services/agent-tools/runtime';
import {
  createAutopilotToolRegistry,
  normalizeNativeToolArguments,
  type NativeToolStatusEvent,
} from '@/services/workflow-runtime/autopilot-tool-bridge';

describe('native tool bridge WAN dependency resolution', () => {
  beforeEach(() => {
    vi.mocked(runAgentTools).mockReset();
  });

  it('publishes running and terminal statuses for native tool executions', async () => {
    vi.mocked(runAgentTools).mockResolvedValueOnce([{
      toolName: 'mcp:router:get_wifi_view',
      status: 'success',
      input: { type: 'mcp_call_tool' },
      output: { structuredContent: { networks: [] } },
    }] as any);
    const reportToolStatus = vi.fn(async (_event: NativeToolStatusEvent) => undefined);
    const registry = createAutopilotToolRegistry({
      context: {
        workspaceId: 'workspace-1',
        chat: { id: 'chat-1' },
        contact: { id: 'contact-1' },
        systemAgentId: 'agent-1',
        systemAgentName: 'Lucas',
        autopilotConfig: { id: 'config-1' },
        turnPolicy: {
          allowedToolNames: ['mcp:router:get_wifi_view'],
          globallyEnabledToolNames: ['mcp:router:get_wifi_view'],
        },
        customerMessage: 'Consulte o Wi-Fi',
      } as any,
      toolNames: ['mcp:router:get_wifi_view'],
      definitions: [{
        name: 'mcp:router:get_wifi_view',
        description: 'Consulta Wi-Fi',
        riskLevel: 'low',
        idempotent: true,
        timeoutMs: 20_000,
        maxAttempts: 1,
        requiresHumanApproval: false,
        inputSchema: { type: 'object' },
        outputSchema: { type: 'object' },
      }],
      reportToolStatus,
    });

    await registry.executeSafely({
      toolName: 'mcp:router:get_wifi_view',
      arguments: {},
      execution: { executionId: 'execution-1' } as any,
      workflow: { id: 'workflow-1' } as any,
      node: { id: 'agent-node' } as any,
      signal: new AbortController().signal,
      emit: async () => undefined,
    });

    expect(reportToolStatus).toHaveBeenCalledTimes(2);
	const events = reportToolStatus.mock.calls.map((call) => call[0]);
	const running = events[0]!;
	const completed = events[1]!;
    expect(running).toMatchObject({
      toolName: 'mcp:router:get_wifi_view',
      status: 'running',
    });
    expect(completed).toMatchObject({
      runId: running.runId,
      toolName: 'mcp:router:get_wifi_view',
      status: 'success',
    });
  });

  it('normalizes common Wi-Fi band aliases before validating MCP arguments', () => {
    expect(normalizeNativeToolArguments(
      'mcp:router:change_wifi_channel',
      { band: '2.4GHz', channel: 'auto' },
    )).toEqual({ band: '2.4', channel: 'auto' });
    expect(normalizeNativeToolArguments(
      'mcp:router:change_wifi_channel',
      { band: '5 GHz', channel: '36' },
    )).toEqual({ band: '5', channel: '36' });
  });

  it('exposes the provider JSON Schema and repairs the observed new_ssid alias', async () => {
    vi.mocked(runAgentTools).mockResolvedValueOnce([{
      toolName: 'mcp:router:change_wifi_name',
      status: 'success',
      input: { type: 'mcp_call_tool' },
      output: { changed: true },
    }] as any);
    const inputSchema = {
      type: 'object',
      properties: {
        band: { type: 'string', enum: ['2.4', '5'] },
        name: { type: 'string' },
      },
      required: ['band', 'name'],
    };
    const registry = createAutopilotToolRegistry({
      context: {
        workspaceId: 'workspace-1',
        chat: { id: 'chat-1' },
        contact: { id: 'contact-1' },
        systemAgentId: 'agent-1',
        systemAgentName: 'Lucas',
        autopilotConfig: { id: 'config-1' },
        turnPolicy: {
          allowedToolNames: ['mcp:router:change_wifi_name'],
          globallyEnabledToolNames: ['mcp:router:change_wifi_name'],
        },
        customerMessage: 'Mude o nome do Wi-Fi 2.4',
      } as any,
      toolNames: ['mcp:router:change_wifi_name'],
      definitions: [{
        name: 'mcp:router:change_wifi_name',
        description: 'Muda o SSID',
        riskLevel: 'medium',
        idempotent: true,
        timeoutMs: 20_000,
        maxAttempts: 1,
        requiresHumanApproval: false,
        inputSchema,
        outputSchema: { type: 'object' },
      }],
    });

    expect(registry.get('mcp:router:change_wifi_name')?.inputJsonSchema).toEqual(inputSchema);
    const result = await registry.executeSafely({
      toolName: 'mcp:router:change_wifi_name',
      arguments: { band: '2.4GHz', new_ssid: 'Ribanceirinho2026' },
      execution: { executionId: 'execution-schema-repair' } as any,
      workflow: { id: 'workflow-1' } as any,
      node: { id: 'agent-node' } as any,
      signal: new AbortController().signal,
      emit: async () => undefined,
    });

    expect(result.record).toMatchObject({
      status: 'success',
      arguments: { band: '2.4', name: 'Ribanceirinho2026' },
    });
    expect(vi.mocked(runAgentTools).mock.calls[0]?.[1]?.[0]).toMatchObject({
      payload: {
        arguments: { band: '2.4', name: 'Ribanceirinho2026' },
      },
    });
  });

  it('refreshes the selected contract IP through SGP before each new router execution', async () => {
    vi.mocked(runAgentTools)
      .mockResolvedValueOnce([{
        toolName: 'sgp_fetch_contact_panel_data',
        status: 'success',
        input: { type: 'sgp_fetch_contact_panel_data' },
        output: { contracts: [
          { id: '99999', ip: '100.64.0.9' },
          { id: '16318', ip: '100.66.15.159' },
        ] },
      }] as any)
      .mockResolvedValueOnce([{
        toolName: 'mcp:router:get_wifi_view',
        status: 'success',
        input: { type: 'mcp_call_tool' },
        output: { structuredContent: { ssids: [] } },
      }] as any)
      .mockResolvedValueOnce([{
        toolName: 'sgp_fetch_contact_panel_data',
        status: 'success',
        input: { type: 'sgp_fetch_contact_panel_data' },
        output: { contracts: [
          { id: '99999', ip: '100.64.0.10' },
          { id: '16318', ip: '100.66.15.160' },
        ] },
      }] as any)
      .mockResolvedValueOnce([{
        toolName: 'mcp:router:get_wifi_view',
        status: 'success',
        input: { type: 'mcp_call_tool' },
        output: { structuredContent: { ssids: [] } },
      }] as any);

    const executeWithNewRegistry = async (
      executionId: string,
      argumentsValue: Record<string, unknown> = {},
    ) => {
      const registry = createAutopilotToolRegistry({
        context: {
          workspaceId: 'workspace-1',
          chat: { id: 'chat-1' },
          contact: { id: 'contact-1' },
          systemAgentId: 'agent-1',
          systemAgentName: 'Lucas',
          autopilotConfig: { id: 'config-1' },
          turnPolicy: {
            allowedToolNames: ['sgp_fetch_contact_panel_data', 'mcp:router:get_wifi_view'],
            globallyEnabledToolNames: ['sgp_fetch_contact_panel_data', 'mcp:router:get_wifi_view'],
          },
          customerMessage: 'Consulte o Wi-Fi',
        } as any,
        toolNames: ['mcp:router:get_wifi_view'],
        definitions: [{
          name: 'mcp:router:get_wifi_view',
          description: 'Consulta Wi-Fi',
          riskLevel: 'low',
          idempotent: true,
          timeoutMs: 20_000,
          maxAttempts: 1,
          requiresHumanApproval: false,
          inputSchema: {
            type: 'object',
            properties: { client_ip: { type: 'string' } },
          },
          outputSchema: { type: 'object' },
        }],
        knownFields: {
          CPF: '86675273191',
          contractId: '16318',
        },
      });

      return registry.executeSafely({
        toolName: 'mcp:router:get_wifi_view',
        arguments: argumentsValue,
        execution: { executionId } as any,
        workflow: { id: 'workflow-1' } as any,
        node: { id: 'agent-node' } as any,
        signal: new AbortController().signal,
        emit: async () => undefined,
      });
    };

    await expect(executeWithNewRegistry('execution-1')).resolves.toMatchObject({
      record: { status: 'success' },
    });
    await expect(executeWithNewRegistry('execution-2', { client_ip: '10.0.0.99' })).resolves.toMatchObject({
      record: { status: 'success' },
    });

    const actions = vi.mocked(runAgentTools).mock.calls.map((call) => call[1]?.[0]);
    expect(actions.map((action) => action?.type)).toEqual([
      'sgp_fetch_contact_panel_data',
      'mcp_call_tool',
      'sgp_fetch_contact_panel_data',
      'mcp_call_tool',
    ]);
    expect(actions[0]).toMatchObject({
      payload: { contractId: '16318', customerIdentifier: '86675273191' },
    });
    expect(actions[1]).toMatchObject({
      payload: { arguments: { client_ip: '100.66.15.159' } },
    });
    expect(actions[3]).toMatchObject({
      payload: { arguments: { client_ip: '100.66.15.160' } },
    });
  });

  it('hydrates an explicit SGP call and reuses its selected IP for the router tool in the same execution', async () => {
    vi.mocked(runAgentTools)
      .mockResolvedValueOnce([{
        toolName: 'sgp_fetch_contact_panel_data',
        status: 'success',
        input: { type: 'sgp_fetch_contact_panel_data' },
        output: { contracts: [
          { id: '99999', ip: '100.64.0.9' },
          { id: '16318', ip: '100.66.15.159' },
        ] },
      }] as any)
      .mockResolvedValueOnce([{
        toolName: 'mcp:router:get_wifi_view',
        status: 'success',
        input: { type: 'mcp_call_tool' },
        output: { structuredContent: { ssids: [] } },
      }] as any);

    const registry = createAutopilotToolRegistry({
      context: {
        workspaceId: 'workspace-1',
        chat: { id: 'chat-1' },
        contact: { id: 'contact-1' },
        systemAgentId: 'agent-1',
        systemAgentName: 'Lucas',
        autopilotConfig: { id: 'config-1' },
        turnPolicy: {
          allowedToolNames: ['sgp_fetch_contact_panel_data', 'mcp:router:get_wifi_view'],
          globallyEnabledToolNames: ['sgp_fetch_contact_panel_data', 'mcp:router:get_wifi_view'],
        },
        customerMessage: 'CPF 86675273191, contrato 16318',
      } as any,
      toolNames: ['sgp_fetch_contact_panel_data', 'mcp:router:get_wifi_view'],
      definitions: [{
        name: 'sgp_fetch_contact_panel_data',
        description: 'Consulta SGP',
        riskLevel: 'low',
        idempotent: true,
        timeoutMs: 20_000,
        maxAttempts: 1,
        requiresHumanApproval: false,
        inputSchema: { type: 'object' },
        outputSchema: { type: 'object' },
      }, {
        name: 'mcp:router:get_wifi_view',
        description: 'Consulta Wi-Fi',
        riskLevel: 'low',
        idempotent: true,
        timeoutMs: 20_000,
        maxAttempts: 1,
        requiresHumanApproval: false,
        inputSchema: {
          type: 'object',
          required: ['client_ip'],
          properties: { client_ip: { type: 'string' } },
        },
        outputSchema: { type: 'object' },
      }],
      knownFields: {
        customer_identifier: '86675273191',
        contract_id: '16318',
      },
    });
    const executionContext = {
      execution: { executionId: 'execution-1' } as any,
      workflow: { id: 'workflow-1' } as any,
      node: { id: 'agent-node' } as any,
      signal: new AbortController().signal,
      emit: async () => undefined,
    };

    await expect(registry.executeSafely({
      toolName: 'sgp_fetch_contact_panel_data',
      arguments: {},
      ...executionContext,
    })).resolves.toMatchObject({ record: { status: 'success' } });
    await expect(registry.executeSafely({
      toolName: 'mcp:router:get_wifi_view',
      arguments: {},
      ...executionContext,
    })).resolves.toMatchObject({ record: { status: 'success' } });

    const actions = vi.mocked(runAgentTools).mock.calls.map((call) => call[1]?.[0]);
    expect(actions).toHaveLength(2);
    expect(actions[0]).toMatchObject({
      type: 'sgp_fetch_contact_panel_data',
      payload: { contractId: '16318', customerIdentifier: '86675273191' },
    });
    expect(actions[1]).toMatchObject({
      type: 'mcp_call_tool',
      payload: { arguments: { client_ip: '100.66.15.159' } },
    });
  });

  it('does not repeat a completed SGP lookup when the selected contract has no usable IP', async () => {
    vi.mocked(runAgentTools).mockResolvedValueOnce([{
      toolName: 'sgp_fetch_contact_panel_data',
      status: 'success',
      input: { type: 'sgp_fetch_contact_panel_data' },
      output: { contracts: [{ id: '16318', ip: 'IP indisponivel' }] },
    }] as any);

    const registry = createAutopilotToolRegistry({
      context: {
        workspaceId: 'workspace-1',
        chat: { id: 'chat-1' },
        contact: { id: 'contact-1' },
        systemAgentId: 'agent-1',
        systemAgentName: 'Lucas',
        autopilotConfig: { id: 'config-1' },
        turnPolicy: {
          allowedToolNames: ['sgp_fetch_contact_panel_data', 'mcp:router:get_wifi_view'],
          globallyEnabledToolNames: ['sgp_fetch_contact_panel_data', 'mcp:router:get_wifi_view'],
        },
        customerMessage: 'CPF 86675273191, contrato 16318',
      } as any,
      toolNames: ['sgp_fetch_contact_panel_data', 'mcp:router:get_wifi_view'],
      definitions: [{
        name: 'sgp_fetch_contact_panel_data',
        description: 'Consulta SGP',
        riskLevel: 'low',
        idempotent: true,
        timeoutMs: 20_000,
        maxAttempts: 1,
        requiresHumanApproval: false,
        inputSchema: { type: 'object' },
        outputSchema: { type: 'object' },
      }, {
        name: 'mcp:router:get_wifi_view',
        description: 'Consulta Wi-Fi',
        riskLevel: 'low',
        idempotent: true,
        timeoutMs: 20_000,
        maxAttempts: 1,
        requiresHumanApproval: false,
        inputSchema: {
          type: 'object',
          required: ['client_ip'],
          properties: { client_ip: { type: 'string' } },
        },
        outputSchema: { type: 'object' },
      }],
      knownFields: {
        customer_identifier: '86675273191',
        contract_id: '16318',
      },
    });
    const executionContext = {
      execution: { executionId: 'execution-1' } as any,
      workflow: { id: 'workflow-1' } as any,
      node: { id: 'agent-node' } as any,
      signal: new AbortController().signal,
      emit: async () => undefined,
    };

    await expect(registry.executeSafely({
      toolName: 'sgp_fetch_contact_panel_data',
      arguments: {},
      ...executionContext,
    })).resolves.toMatchObject({ record: { status: 'success' } });
    await expect(registry.executeSafely({
      toolName: 'mcp:router:get_wifi_view',
      arguments: {},
      ...executionContext,
    })).resolves.toMatchObject({
      record: {
        status: 'error',
        error: { code: 'TOOL_DEPENDENCY_MISSING' },
      },
    });

    expect(vi.mocked(runAgentTools)).toHaveBeenCalledTimes(1);
  });

  it('does not cache a pending result from a read-only MCP status tool', async () => {
    vi.mocked(runAgentTools)
      .mockResolvedValueOnce([{
        toolName: 'mcp:router:get_command_status',
        status: 'success',
        input: { type: 'mcp_call_tool' },
        output: { status: 'pending', command_id: 'command-1' },
      }] as any)
      .mockResolvedValueOnce([{
        toolName: 'mcp:router:get_command_status',
        status: 'success',
        input: { type: 'mcp_call_tool' },
        output: { status: 'completed', command_id: 'command-1' },
      }] as any);

    const registry = createAutopilotToolRegistry({
      context: {
        workspaceId: 'workspace-1',
        chat: { id: 'chat-1' },
        contact: { id: 'contact-1' },
        systemAgentId: 'agent-1',
        systemAgentName: 'Lucas',
        autopilotConfig: { id: 'config-1' },
        turnPolicy: {
          allowedToolNames: ['mcp:router:get_command_status'],
          globallyEnabledToolNames: ['mcp:router:get_command_status'],
        },
        customerMessage: 'Verifique o comando.',
      } as any,
      toolNames: ['mcp:router:get_command_status'],
      definitions: [{
        name: 'mcp:router:get_command_status',
        description: 'Consulta o status atual de um comando assíncrono.',
        class: 'read_only',
        riskLevel: 'low',
        idempotent: true,
        timeoutMs: 20_000,
        maxAttempts: 1,
        requiresHumanApproval: false,
        inputSchema: {
          type: 'object',
          required: ['command_id'],
          properties: { command_id: { type: 'string' } },
        },
        outputSchema: {
          type: 'object',
          required: ['status', 'command_id'],
          properties: {
            status: { type: 'string' },
            command_id: { type: 'string' },
          },
        },
      }],
    });
    const executionContext = {
      execution: { executionId: 'execution-1' } as any,
      workflow: { id: 'workflow-1' } as any,
      node: { id: 'agent-node' } as any,
      signal: new AbortController().signal,
      emit: async () => undefined,
    };

    const first = await registry.executeSafely({
      toolName: 'mcp:router:get_command_status',
      arguments: { command_id: 'command-1' },
      ...executionContext,
    });
    const second = await registry.executeSafely({
      toolName: 'mcp:router:get_command_status',
      arguments: { command_id: 'command-1' },
      ...executionContext,
    });

    expect(first.output).toMatchObject({ status: 'pending' });
    expect(second.output).toMatchObject({ status: 'completed' });
    expect(vi.mocked(runAgentTools)).toHaveBeenCalledTimes(2);
  });
});
