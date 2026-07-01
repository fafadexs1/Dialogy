import { afterEach, describe, expect, it } from 'vitest';

import type { AgentToolAction, AgentToolExecutionResult } from '@/services/agent-tools/types';
import {
  clearAgentToolRunLedger,
  completeAgentToolRun,
  planAgentToolRun,
} from '@/services/autopilot/runtime/tool-run-ledger';

const runIds: string[] = [];

function action(toolName: string, clientIp = '192.0.2.10'): AgentToolAction {
  return {
    type: 'mcp_call_tool',
    payload: {
      toolName,
      arguments: { client_ip: clientIp },
    },
  };
}

function result(input: AgentToolAction, status: 'success' | 'error'): AgentToolExecutionResult {
  const toolName = input.type === 'mcp_call_tool'
    ? String(input.payload?.toolName || input.type)
    : input.type;
  return {
    toolName: toolName as any,
    status,
    input,
    ...(status === 'success'
      ? { output: { structuredContent: { status: 'ok' } } }
      : { error: 'fetch failed' }),
  };
}

afterEach(() => {
  for (const runId of runIds.splice(0)) clearAgentToolRunLedger(runId);
});

describe('autopilot tool run ledger', () => {
  it('reuses the exact result instead of executing the same action twice in one run', () => {
    const runId = `run-${Date.now()}-one`;
    runIds.push(runId);
    const requested = action('mcp:router:get_wifi_view');
    const firstPlan = planAgentToolRun(runId, [requested]);
    const firstResult = result(requested, 'error');

    expect(firstPlan.actionsToExecute).toEqual([requested]);
    completeAgentToolRun(firstPlan, [firstResult]);

    const repeatedPlan = planAgentToolRun(runId, [requested]);
    expect(repeatedPlan.actionsToExecute).toEqual([]);
    expect(completeAgentToolRun(repeatedPlan, [])).toEqual([firstResult]);
  });

  it('does not conflate different arguments or different orchestrator runs', () => {
    const firstRunId = `run-${Date.now()}-first`;
    const secondRunId = `run-${Date.now()}-second`;
    runIds.push(firstRunId, secondRunId);
    const firstAction = action('mcp:router:get_wifi_view', '192.0.2.10');
    const changedAction = action('mcp:router:get_wifi_view', '192.0.2.11');
    const firstPlan = planAgentToolRun(firstRunId, [firstAction]);
    completeAgentToolRun(firstPlan, [result(firstAction, 'success')]);

    expect(planAgentToolRun(firstRunId, [changedAction]).actionsToExecute).toEqual([changedAction]);
    expect(planAgentToolRun(secondRunId, [firstAction]).actionsToExecute).toEqual([firstAction]);
  });

  it('does not retry the same tool with changed arguments after it failed in the same run', () => {
    const runId = `run-${Date.now()}-failed-tool`;
    runIds.push(runId);
    const firstAction = action('mcp:router:get_wifi_view', '192.0.2.10');
    const changedAction = action('mcp:router:get_wifi_view', '192.0.2.11');
    const failedResult = result(firstAction, 'error');
    const firstPlan = planAgentToolRun(runId, [firstAction]);
    completeAgentToolRun(firstPlan, [failedResult]);

    const retryPlan = planAgentToolRun(runId, [changedAction]);
    expect(retryPlan.actionsToExecute).toEqual([]);
    expect(completeAgentToolRun(retryPlan, [])).toEqual([failedResult]);
  });

  it('collapses duplicate actions in the same batch to one execution', () => {
    const runId = `run-${Date.now()}-batch`;
    runIds.push(runId);
    const requested = action('mcp:router:scan_wifi_neighbors');
    const plan = planAgentToolRun(runId, [requested, requested]);
    const executedResult = result(requested, 'success');

    expect(plan.actionsToExecute).toEqual([requested]);
    expect(completeAgentToolRun(plan, [executedResult])).toEqual([executedResult, executedResult]);
  });
});
