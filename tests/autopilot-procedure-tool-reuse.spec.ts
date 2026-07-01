import { describe, expect, it } from 'vitest';

import type { AgentToolCatalogItem } from '@/services/agent-tools/catalog';
import type {
  AgentToolAction,
  AgentToolExecutionResult,
} from '@/services/agent-tools/types';
import {
  completeProcedureToolReuse,
  planProcedureToolReuse,
} from '@/services/autopilot/runtime/procedure-tool-reuse';

const wifiToolName = 'mcp:router:get_wifi_view';

function tool(
  name: string,
  sideEffect: AgentToolCatalogItem['sideEffect'] = 'none',
  idempotent = true,
): AgentToolCatalogItem {
  return {
    name: name as any,
    version: 'test',
    description: name,
    class: sideEffect === 'none' ? 'read_only' : 'write_non_idempotent',
    riskLevel: sideEffect === 'none' ? 'low' : 'high',
    sideEffect,
    idempotent,
    timeoutMs: 10_000,
    maxAttempts: 1,
    requiresHumanApproval: sideEffect !== 'none',
    customerVisible: true,
    allowedIntents: ['support_request'],
    requiredSlots: [],
    fallbackAction: 'handoff',
    source: 'mcp',
    enabledByDefault: false,
  };
}

function action(name: string, argumentsValue: Record<string, unknown>): AgentToolAction {
  return {
    type: 'mcp_call_tool',
    payload: { toolName: name, arguments: argumentsValue },
  };
}

function success(input: AgentToolAction): AgentToolExecutionResult {
  return {
    toolName: String(input.type === 'mcp_call_tool' ? input.payload?.toolName : input.type) as any,
    status: 'success',
    input,
    output: { structuredContent: { ssid: 'redacted', password: 'redacted' } },
  };
}

describe('procedure current-turn tool reuse', () => {
  it('reuses a successful qualified read-only MCP result when the procedure omits hydrated arguments', () => {
    const executedAction = action(wifiToolName, { client_ip: '192.0.2.10', contract_id: '16318' });
    const procedureAction = action(wifiToolName, {});
    const priorResult = success(executedAction);

    const plan = planProcedureToolReuse({
      actions: [procedureAction],
      currentTurnResults: [priorResult],
      toolCatalog: [tool(wifiToolName)],
    });

    expect(plan.actionsToExecute).toEqual([]);
    expect(plan.reusedToolNames).toEqual([wifiToolName]);
    expect(completeProcedureToolReuse(plan, [])).toEqual([priorResult]);
  });

  it('does not reuse when an explicitly requested argument differs', () => {
    const executedAction = action(wifiToolName, { client_ip: '192.0.2.10' });
    const procedureAction = action(wifiToolName, { client_ip: '192.0.2.11' });

    const plan = planProcedureToolReuse({
      actions: [procedureAction],
      currentTurnResults: [success(executedAction)],
      toolCatalog: [tool(wifiToolName)],
    });

    expect(plan.actionsToExecute).toEqual([procedureAction]);
    expect(plan.reusedToolNames).toEqual([]);
  });

  it('never reuses mutating or non-idempotent MCP tools', () => {
    const rebootToolName = 'mcp:router:reboot_router';
    const rebootAction = action(rebootToolName, { client_ip: '192.0.2.10' });

    const plan = planProcedureToolReuse({
      actions: [action(rebootToolName, {})],
      currentTurnResults: [success(rebootAction)],
      toolCatalog: [tool(rebootToolName, 'high', false)],
    });

    expect(plan.actionsToExecute).toHaveLength(1);
    expect(plan.reusedToolNames).toEqual([]);
  });

  it('never reuses a result from another qualified tool or a failed result', () => {
    const executedAction = action('mcp:router:get_router', { client_ip: '192.0.2.10' });
    const failedWifiResult: AgentToolExecutionResult = {
      ...success(action(wifiToolName, { client_ip: '192.0.2.10' })),
      status: 'error',
      output: null,
      error: 'timeout',
    };
    const procedureAction = action(wifiToolName, {});

    const plan = planProcedureToolReuse({
      actions: [procedureAction],
      currentTurnResults: [success(executedAction), failedWifiResult],
      toolCatalog: [tool(wifiToolName)],
    });

    expect(plan.actionsToExecute).toEqual([procedureAction]);
  });
});
