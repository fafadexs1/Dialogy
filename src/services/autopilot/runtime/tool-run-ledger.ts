import { fingerprintToolAction } from '@/services/agent-tools/action-fingerprint';
import type { AgentToolAction, AgentToolExecutionResult } from '@/services/agent-tools/types';

type ToolRunLedgerEntry = {
  result: AgentToolExecutionResult;
  expiresAt: number;
};

export type AgentToolRunPlanEntry =
  | { kind: 'reuse'; result: AgentToolExecutionResult }
  | { kind: 'execute'; executionIndex: number };

export type AgentToolRunPlan = {
  runId: string | null;
  actionsToExecute: AgentToolAction[];
  entries: AgentToolRunPlanEntry[];
};

const LEDGER_TTL_MS = 15 * 60 * 1000;
const MAX_LEDGER_ENTRIES = 2000;
const resultLedger = new Map<string, ToolRunLedgerEntry>();
const failureLedger = new Map<string, ToolRunLedgerEntry>();

function ledgerKey(runId: string, action: AgentToolAction) {
  return `${runId}:${fingerprintToolAction(action)}`;
}

function requestedToolName(action: AgentToolAction) {
  return action.type === 'mcp_call_tool'
    ? String(action.payload?.toolName || action.type)
    : action.type;
}

function failureLedgerKey(runId: string, action: AgentToolAction) {
  return `${runId}:${requestedToolName(action)}`;
}

function pruneLedger(now = Date.now()) {
  for (const [key, entry] of resultLedger) {
    if (entry.expiresAt <= now) resultLedger.delete(key);
  }
  for (const [key, entry] of failureLedger) {
    if (entry.expiresAt <= now) failureLedger.delete(key);
  }
  if (resultLedger.size <= MAX_LEDGER_ENTRIES) return;
  const overflow = resultLedger.size - MAX_LEDGER_ENTRIES;
  for (const key of [...resultLedger.keys()].slice(0, overflow)) resultLedger.delete(key);
}

export function planAgentToolRun(
  runId: string | null | undefined,
  actions: AgentToolAction[],
): AgentToolRunPlan {
  if (!runId) {
    return {
      runId: null,
      actionsToExecute: actions,
      entries: actions.map((_, executionIndex) => ({ kind: 'execute', executionIndex })),
    };
  }

  pruneLedger();
  const actionsToExecute: AgentToolAction[] = [];
  const pendingIndexes = new Map<string, number>();
  const entries = actions.map((action): AgentToolRunPlanEntry => {
    const key = ledgerKey(runId, action);
    const previous = resultLedger.get(key);
    if (previous) return { kind: 'reuse', result: previous.result };
    const previousFailure = failureLedger.get(failureLedgerKey(runId, action));
    if (previousFailure) return { kind: 'reuse', result: previousFailure.result };

    const pendingIndex = pendingIndexes.get(key);
    if (pendingIndex != null) return { kind: 'execute', executionIndex: pendingIndex };

    const executionIndex = actionsToExecute.length;
    actionsToExecute.push(action);
    pendingIndexes.set(key, executionIndex);
    return { kind: 'execute', executionIndex };
  });

  return { runId, actionsToExecute, entries };
}

export function completeAgentToolRun(
  plan: AgentToolRunPlan,
  executedResults: AgentToolExecutionResult[],
): AgentToolExecutionResult[] {
  if (plan.runId) {
    const expiresAt = Date.now() + LEDGER_TTL_MS;
    for (const [index, action] of plan.actionsToExecute.entries()) {
      const result = executedResults[index];
      if (result) {
        resultLedger.set(ledgerKey(plan.runId, action), { result, expiresAt });
        if (result.status !== 'success') {
          failureLedger.set(failureLedgerKey(plan.runId, action), { result, expiresAt });
        }
      }
    }
  }

  return plan.entries.flatMap((entry) => {
    if (entry.kind === 'reuse') return [entry.result];
    const result = executedResults[entry.executionIndex];
    return result ? [result] : [];
  });
}

export function clearAgentToolRunLedger(runId: string) {
  const prefix = `${runId}:`;
  for (const key of resultLedger.keys()) {
    if (key.startsWith(prefix)) resultLedger.delete(key);
  }
  for (const key of failureLedger.keys()) {
    if (key.startsWith(prefix)) failureLedger.delete(key);
  }
}
