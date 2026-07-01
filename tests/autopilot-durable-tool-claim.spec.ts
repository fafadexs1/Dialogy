import { describe, expect, it } from 'vitest';

import { claimDurableAgentToolExecution } from '@/services/autopilot/runtime/durable-tool-claim';
import type {
  AgentToolAction,
  AgentToolExecutionResult,
} from '@/services/agent-tools/types';

function fakeClaimDatabase() {
  let claim: {
    id: string;
    ownerToken: string;
    status: string;
    result: unknown;
  } | null = null;
  let stale = false;

  return {
    setStale(value: boolean) {
      stale = value;
    },
    getStatus() {
      return claim?.status || null;
    },
    async query(query: string, params: unknown[] = []) {
      if (query.includes('FROM orchestrator_runs')) {
        return { rows: [{ source_message_id: 'message-1' }], rowCount: 1 };
      }
      if (query.includes('INSERT INTO autopilot_tool_execution_claims')) {
        if (claim) return { rows: [], rowCount: 0 };
        claim = {
          id: 'claim-1',
          ownerToken: String(params[7]),
          status: 'claimed',
          result: null,
        };
        return { rows: [{ id: claim.id }], rowCount: 1 };
      }
      if (
        query.includes('UPDATE autopilot_tool_execution_claims')
        && query.includes('SET status = $3')
      ) {
        if (claim && claim.ownerToken === String(params[1])) {
          claim.status = String(params[2]);
          claim.result = JSON.parse(String(params[3]));
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }
      if (
        query.includes('UPDATE autopilot_tool_execution_claims')
        && query.includes('SET owner_token = $2')
      ) {
        if (!claim || claim.status !== 'claimed' || !stale) return { rows: [], rowCount: 0 };
        claim.ownerToken = String(params[1]);
        stale = false;
        return { rows: [{ id: claim.id }], rowCount: 1 };
      }
      if (
        query.includes('UPDATE autopilot_tool_execution_claims')
        && query.includes("SET status = 'uncertain'")
      ) {
        if (claim?.status === 'claimed') claim.status = 'uncertain';
        return { rows: [], rowCount: 1 };
      }
      if (query.includes('FROM autopilot_tool_execution_claims')) {
        return {
          rows: claim ? [{
            id: claim.id,
            status: claim.status,
            result: claim.result,
            stale,
          }] : [],
          rowCount: claim ? 1 : 0,
        };
      }
      throw new Error(`Unexpected query: ${query}`);
    },
  };
}

function mcpAction(orderId: string, reason: string): AgentToolAction {
  return {
    type: 'mcp_call_tool',
    reason,
    payload: {
      toolName: 'mcp:commerce:cancel_order',
      arguments: { order_id: orderId },
    },
  };
}

describe('durable agent tool execution claim', () => {
  it('reuses a completed result for the same source operation even if planner wording changes', async () => {
    const database = fakeClaimDatabase();
    const firstAction = mcpAction('AB1234', 'Cancelar pedido solicitado pelo cliente.');
    const first = await claimDurableAgentToolExecution({
      workspaceId: 'workspace-1',
      chatId: 'chat-1',
      orchestratorRunId: 'run-1',
      action: firstAction,
      toolName: 'mcp:commerce:cancel_order',
      idempotent: false,
      database,
    });
    expect(first.kind).toBe('execute');

    const result: AgentToolExecutionResult = {
      toolName: 'mcp:commerce:cancel_order',
      status: 'success',
      input: firstAction,
      output: { cancelled: true },
    };
    if (first.kind === 'execute') await first.complete(result);

    const duplicate = await claimDurableAgentToolExecution({
      workspaceId: 'workspace-1',
      chatId: 'chat-1',
      orchestratorRunId: 'run-2',
      action: mcpAction('AB1234', 'Texto diferente gerado no retry.'),
      toolName: 'mcp:commerce:cancel_order',
      idempotent: false,
      database,
    });

    expect(duplicate).toMatchObject({
      kind: 'reuse',
      result: {
        status: 'success',
        output: { cancelled: true },
      },
    });
  });

  it('marks a stale non-idempotent operation uncertain instead of executing it again', async () => {
    const database = fakeClaimDatabase();
    const action = mcpAction('AB1234', 'Cancelar pedido.');
    const first = await claimDurableAgentToolExecution({
      workspaceId: 'workspace-1',
      chatId: 'chat-1',
      orchestratorRunId: 'run-1',
      action,
      toolName: 'mcp:commerce:cancel_order',
      idempotent: false,
      database,
    });
    expect(first.kind).toBe('execute');
    database.setStale(true);

    const retry = await claimDurableAgentToolExecution({
      workspaceId: 'workspace-1',
      chatId: 'chat-1',
      orchestratorRunId: 'run-2',
      action,
      toolName: 'mcp:commerce:cancel_order',
      idempotent: false,
      database,
    });

    expect(retry.kind).toBe('blocked');
    expect(retry.kind === 'blocked' ? retry.result.error : '').toContain('uncertain');
    expect(database.getStatus()).toBe('uncertain');
  });

  it('allows a stale idempotent/read-only operation to be safely taken over', async () => {
    const database = fakeClaimDatabase();
    const action: AgentToolAction = {
      type: 'mcp_call_tool',
      payload: {
        toolName: 'mcp:commerce:get_order_status',
        arguments: { order_id: 'AB1234' },
      },
    };
    const first = await claimDurableAgentToolExecution({
      workspaceId: 'workspace-1',
      chatId: 'chat-1',
      orchestratorRunId: 'run-1',
      action,
      toolName: 'mcp:commerce:get_order_status',
      idempotent: true,
      database,
    });
    expect(first.kind).toBe('execute');
    database.setStale(true);

    const retry = await claimDurableAgentToolExecution({
      workspaceId: 'workspace-1',
      chatId: 'chat-1',
      orchestratorRunId: 'run-2',
      action,
      toolName: 'mcp:commerce:get_order_status',
      idempotent: true,
      database,
    });

    expect(retry.kind).toBe('execute');
  });
});
