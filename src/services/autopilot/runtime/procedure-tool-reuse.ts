import type { AgentToolCatalogItem } from '@/services/agent-tools/catalog';
import type {
  AgentToolAction,
  AgentToolExecutionResult,
} from '@/services/agent-tools/types';

export type ProcedureToolReusePlanEntry =
  | { kind: 'reuse'; result: AgentToolExecutionResult }
  | { kind: 'execute'; executionIndex: number };

export type ProcedureToolReusePlan = {
  actionsToExecute: AgentToolAction[];
  entries: ProcedureToolReusePlanEntry[];
  reusedToolNames: string[];
};

function actionToolName(action: AgentToolAction): string {
  return action.type === 'mcp_call_tool'
    ? String(action.payload?.toolName || '')
    : action.type;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isCompatibleSubset(requested: unknown, executed: unknown): boolean {
  if (requested === undefined) return true;
  if (requested === null || executed === null) return requested === executed;

  if (Array.isArray(requested)) {
    return Array.isArray(executed)
      && requested.length === executed.length
      && requested.every((value, index) => isCompatibleSubset(value, executed[index]));
  }

  if (isPlainRecord(requested)) {
    if (!isPlainRecord(executed)) return false;
    return Object.entries(requested).every(
      ([key, value]) => Object.prototype.hasOwnProperty.call(executed, key)
        && isCompatibleSubset(value, executed[key]),
    );
  }

  return Object.is(requested, executed);
}

function findReusableResult(input: {
  action: AgentToolAction;
  currentTurnResults: AgentToolExecutionResult[];
  toolCatalog: AgentToolCatalogItem[];
}): AgentToolExecutionResult | null {
  if (input.action.type !== 'mcp_call_tool') return null;

  const toolName = actionToolName(input.action);
  if (!toolName.startsWith('mcp:')) return null;

  const definition = input.toolCatalog.find((tool) => tool.name === toolName);
  if (!definition || definition.sideEffect !== 'none' || !definition.idempotent) {
    return null;
  }

  const requestedArguments = input.action.payload?.arguments || {};
  for (let index = input.currentTurnResults.length - 1; index >= 0; index -= 1) {
    const result = input.currentTurnResults[index];
    if (
      result.status !== 'success'
      || result.toolName !== toolName
      || result.input.type !== 'mcp_call_tool'
      || result.input.payload?.toolName !== toolName
      || !isCompatibleSubset(requestedArguments, result.input.payload?.arguments || {})
    ) {
      continue;
    }
    return result;
  }

  return null;
}

/**
 * Reuses only successful read-only MCP results produced earlier in this turn.
 * This closes procedure-planner gaps without weakening the global exact-argument
 * tool ledger or ever replaying a mutation.
 */
export function planProcedureToolReuse(input: {
  actions: AgentToolAction[];
  currentTurnResults: AgentToolExecutionResult[];
  toolCatalog: AgentToolCatalogItem[];
}): ProcedureToolReusePlan {
  const actionsToExecute: AgentToolAction[] = [];
  const reusedToolNames: string[] = [];

  const entries = input.actions.map((action): ProcedureToolReusePlanEntry => {
    const reusableResult = findReusableResult({
      action,
      currentTurnResults: input.currentTurnResults,
      toolCatalog: input.toolCatalog,
    });
    if (reusableResult) {
      reusedToolNames.push(String(reusableResult.toolName));
      return { kind: 'reuse', result: reusableResult };
    }

    const executionIndex = actionsToExecute.length;
    actionsToExecute.push(action);
    return { kind: 'execute', executionIndex };
  });

  return { actionsToExecute, entries, reusedToolNames };
}

export function completeProcedureToolReuse(
  plan: ProcedureToolReusePlan,
  executedResults: AgentToolExecutionResult[],
): AgentToolExecutionResult[] {
  return plan.entries.flatMap((entry) => {
    if (entry.kind === 'reuse') return [entry.result];
    const result = executedResults[entry.executionIndex];
    return result ? [result] : [];
  });
}
