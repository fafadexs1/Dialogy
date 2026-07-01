import type { AutopilotFlowGraph } from '@/lib/types';
import type { AgentToolCatalogItem } from '@/services/agent-tools/catalog';
import { catalogToolRequiresConfirmation } from '@/services/autopilot/tool-confirmation-policy';

export type AutopilotToolCoverageReport = {
  status: 'covered' | 'safe_runtime_fallback' | 'branch_required';
  enabledToolNames: string[];
  declaredToolNames: string[];
  attachedEnabledToolNames: string[];
  safeFallbackToolNames: string[];
  branchRequiredToolNames: string[];
  unguardedToolNames: string[];
  unknownEnabledToolNames: string[];
  duplicateToolNames: string[];
  coverageRatio: number;
};

export function isAutopilotToolCoveragePublishBlocked(report: AutopilotToolCoverageReport) {
  return report.status === 'branch_required';
}

export function summarizeAutopilotToolCoverageBlockers(report: AutopilotToolCoverageReport) {
  const names = unique([
    ...report.branchRequiredToolNames,
    ...report.unknownEnabledToolNames,
  ]);
  if (names.length === 0) return '';
  return `Ferramentas habilitadas sem branch seguro no fluxo: ${names.join(', ')}.`;
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function hasExplicitConfirmationText(value: unknown) {
  return /\b(confirm|autoriz|aprov|consent|pode alterar|pode reiniciar|ciente)\w*/i.test(String(value || ''));
}

function isExplicitGuardNode(node: NonNullable<AutopilotFlowGraph['nodes']>[number]) {
  if (node.kind === 'collect') {
    const fields = node.config?.formFields || [];
    return fields.some((field) => (
      field.required !== false
      && hasExplicitConfirmationText([
        field.id,
        field.fieldKey,
        field.label,
        ...(field.aliases || []),
      ].join(' '))
    ));
  }
  if (node.kind !== 'message') return false;
  return hasExplicitConfirmationText([
    node.title,
    node.subtitle,
    node.config?.instructions,
    node.config?.message,
  ].join(' '));
}

function toolNodeHasExplicitGuard(
  graph: AutopilotFlowGraph | null | undefined,
  toolNodeId: string,
) {
  if (!graph) return false;
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const incoming = new Map<string, string[]>();
  for (const edge of graph.edges) {
    incoming.set(edge.target, [...(incoming.get(edge.target) || []), edge.source]);
  }
  const queue = (incoming.get(toolNodeId) || []).map((id) => ({ id, depth: 1 }));
  const visited = new Set<string>();
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current.id) || current.depth > 8) continue;
    visited.add(current.id);
    const node = nodeById.get(current.id);
    if (!node) continue;
    if (isExplicitGuardNode(node)) return true;
    for (const parentId of incoming.get(current.id) || []) {
      queue.push({ id: parentId, depth: current.depth + 1 });
    }
  }
  return false;
}

export function analyzeAutopilotToolCoverage(input: {
  graph: AutopilotFlowGraph | null | undefined;
  enabledToolNames: string[];
  toolCatalog: AgentToolCatalogItem[];
}): AutopilotToolCoverageReport {
  const enabledToolNames = unique(input.enabledToolNames);
  const enabled = new Set(enabledToolNames);
  const declaredToolNames = (input.graph?.nodes || [])
    .filter((node) => node.kind === 'tool' && Boolean(node.toolName?.trim()))
    .map((node) => node.toolName!.trim());
  const declarationCounts = declaredToolNames.reduce<Map<string, number>>((counts, toolName) => {
    counts.set(toolName, (counts.get(toolName) || 0) + 1);
    return counts;
  }, new Map());
  const uniqueDeclaredToolNames = unique(declaredToolNames);
  const declared = new Set(uniqueDeclaredToolNames);
  const catalog = new Map(input.toolCatalog.map((tool) => [String(tool.name), tool]));
  const unguardedToolNames = enabledToolNames.filter((toolName) => {
    const tool = catalog.get(toolName);
    if (!tool || !declared.has(toolName) || !catalogToolRequiresConfirmation(tool)) {
      return false;
    }
    const matchingNodes = (input.graph?.nodes || []).filter((node) => (
      node.kind === 'tool' && node.toolName?.trim() === toolName
    ));
    return matchingNodes.length === 0
      || matchingNodes.every((node) => !toolNodeHasExplicitGuard(input.graph, node.id));
  });
  const unguarded = new Set(unguardedToolNames);
  const attachedEnabledToolNames = enabledToolNames.filter((toolName) => (
    declared.has(toolName) && !unguarded.has(toolName)
  ));
  const missingToolNames = enabledToolNames.filter((toolName) => !declared.has(toolName));
  const unknownEnabledToolNames = missingToolNames.filter((toolName) => !catalog.has(toolName));
  const knownMissingTools = missingToolNames
    .map((toolName) => catalog.get(toolName))
    .filter((tool): tool is AgentToolCatalogItem => Boolean(tool));
  const safeFallbackToolNames = knownMissingTools
    .filter((tool) => tool.sideEffect === 'none' && tool.riskLevel === 'low')
    .map((tool) => String(tool.name));
  const safeFallback = new Set(safeFallbackToolNames);
  const branchRequiredToolNames = missingToolNames.filter(
    (toolName) => !safeFallback.has(toolName) && !unknownEnabledToolNames.includes(toolName),
  ).concat(unguardedToolNames).filter((toolName, index, values) => values.indexOf(toolName) === index);
  const duplicateToolNames = [...declarationCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([toolName]) => toolName)
    .sort();
  const coveredCount = attachedEnabledToolNames.length + safeFallbackToolNames.length;
  const coverageRatio = enabledToolNames.length === 0
    ? 1
    : Number((coveredCount / enabledToolNames.length).toFixed(4));
  const status = branchRequiredToolNames.length > 0 || unknownEnabledToolNames.length > 0
    ? 'branch_required'
    : safeFallbackToolNames.length > 0
      ? 'safe_runtime_fallback'
      : 'covered';

  return {
    status,
    enabledToolNames,
    declaredToolNames: uniqueDeclaredToolNames,
    attachedEnabledToolNames,
    safeFallbackToolNames,
    branchRequiredToolNames,
    unguardedToolNames,
    unknownEnabledToolNames,
    duplicateToolNames,
    coverageRatio,
  };
}
