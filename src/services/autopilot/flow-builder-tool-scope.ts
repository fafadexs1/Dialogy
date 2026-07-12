import type { AgentToolCatalogItem } from '@/services/agent-tools/catalog';
import { isNativeAgentToolEligible } from '@/services/workflow-runtime/native-agent-tools';

export type FlowBuilderToolCatalogMode = 'current_selection' | 'all_eligible';

function uniqueToolNames(values: readonly string[] | null | undefined) {
  return [...new Set((values || []).map((value) => String(value).trim()).filter(Boolean))];
}

export function selectFlowBuilderTools(input: {
  catalog: AgentToolCatalogItem[];
  requestedEnabledToolNames?: string[] | null;
  persistedEnabledToolNames?: unknown;
  mode?: FlowBuilderToolCatalogMode;
}) {
  const eligibleCatalog = input.catalog.filter(isNativeAgentToolEligible);
  if (input.mode === 'all_eligible') return eligibleCatalog;

  const hasRequestedSelection = Array.isArray(input.requestedEnabledToolNames);
  const hasPersistedSelection = Array.isArray(input.persistedEnabledToolNames);
  const selectedNames = hasRequestedSelection
    ? uniqueToolNames(input.requestedEnabledToolNames)
    : hasPersistedSelection
      ? uniqueToolNames(input.persistedEnabledToolNames as string[])
      : uniqueToolNames(
          eligibleCatalog
            .filter((tool) => tool.enabledByDefault)
            .map((tool) => String(tool.name)),
        );
  const selected = new Set(selectedNames);

  return eligibleCatalog.filter((tool) => selected.has(String(tool.name)));
}

export function resolveAppliedProposalToolNames(input: {
  proposalToolNames: string[];
  catalogToolNames: string[];
}) {
  const catalog = new Set(uniqueToolNames(input.catalogToolNames));
  return uniqueToolNames(input.proposalToolNames).filter((toolName) => catalog.has(toolName));
}
