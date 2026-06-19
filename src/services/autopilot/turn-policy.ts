import type { AutopilotConfig, AutopilotFlowGraph, AutopilotFlowNode, KnowledgeBaseDocument } from "@/lib/types";
import type { ActiveFlowIntentScope } from "@/services/autopilot/flow-routing";
import { filterKnowledgeDocumentsForScope } from "@/services/autopilot/flow-routing";

export type AutopilotToolMode = "deny" | "on_demand" | "required";

export type AutopilotTurnPolicy = {
  activeNodeId: string | null;
  toolMode: AutopilotToolMode;
  globallyEnabledToolNames: string[];
  attachedToolNames: string[];
  allowedToolNames: string[];
  toolInstructionsByName: Record<string, string>;
  allowedKnowledgeDocumentIds: string[] | undefined;
  reason: string;
};

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function findNode(graph: AutopilotFlowGraph | null | undefined, nodeId: string | null | undefined) {
  if (!nodeId) return null;
  return graph?.nodes.find((node) => node.id === nodeId) ?? null;
}

function resolveActiveNode(
  graph: AutopilotFlowGraph | null | undefined,
  intentScope: ActiveFlowIntentScope | null,
  persistedActiveNodeId?: string | null,
) {
  if (intentScope?.nodeId) return intentScope.nodeId;
  if (findNode(graph, persistedActiveNodeId)) return persistedActiveNodeId ?? null;
  return graph?.nodes.find((node) => node.kind === "assistant")?.id ?? null;
}

function principalNodeId(graph: AutopilotFlowGraph | null | undefined) {
  return graph?.nodes.find((node) => node.kind === "assistant")?.id ?? null;
}

function effectiveToolNodeIds(graph: AutopilotFlowGraph, activeNodeId: string | null) {
  const principalId = principalNodeId(graph);
  const allowedSourceIds = new Set([principalId, activeNodeId].filter((nodeId): nodeId is string => Boolean(nodeId)));
  const connectedIds = new Set<string>();
  if (allowedSourceIds.size === 0) return connectedIds;
  for (const edge of graph.edges) {
    if (allowedSourceIds.has(edge.source)) connectedIds.add(edge.target);
    if (allowedSourceIds.has(edge.target)) connectedIds.add(edge.source);
  }
  return connectedIds;
}

function connectedToolNames(graph: AutopilotFlowGraph, activeNodeId: string | null) {
  const connectedIds = effectiveToolNodeIds(graph, activeNodeId);
  if (connectedIds.size === 0) return [];
  return unique(
    graph.nodes
      .filter((node): node is AutopilotFlowNode & { toolName: string } => (
        node.kind === "tool" && connectedIds.has(node.id) && Boolean(node.toolName?.trim())
      ))
      .map((node) => node.toolName),
  );
}

function connectedToolInstructions(graph: AutopilotFlowGraph, activeNodeId: string | null) {
  const connectedIds = effectiveToolNodeIds(graph, activeNodeId);
  if (connectedIds.size === 0) return {};

  return graph.nodes.reduce<Record<string, string>>((instructions, node) => {
    const toolName = node.toolName?.trim();
    const toolInstructions = node.config?.instructions?.trim();
    if (node.kind === "tool" && connectedIds.has(node.id) && toolName && toolInstructions) {
      instructions[toolName] = toolInstructions.slice(0, 1200);
    }
    return instructions;
  }, {});
}

function includeCompanionTools(input: {
  scopedToolNames: string[];
  globallyEnabledToolNames: string[];
}) {
  const allowed = new Set(input.scopedToolNames);
  const enabled = new Set(input.globallyEnabledToolNames);

  if (allowed.has("transfer_chat") && enabled.has("add_internal_note")) {
    allowed.add("add_internal_note");
  }

  return input.scopedToolNames.concat(
    [...allowed].filter((name) => !input.scopedToolNames.includes(name)),
  );
}

export function resolveAllowedKnowledgeDocumentIds(input: {
  config: AutopilotConfig;
  documents: KnowledgeBaseDocument[];
  intentScope: ActiveFlowIntentScope | null;
}) {
  if (!input.config.flow_graph) return undefined;
  return filterKnowledgeDocumentsForScope(input.config, input.documents, input.intentScope)
    .map((document) => document.id);
}

export function compileAutopilotTurnPolicy(input: {
  config: AutopilotConfig;
  documents: KnowledgeBaseDocument[];
  intentScope: ActiveFlowIntentScope | null;
  persistedActiveNodeId?: string | null;
}): AutopilotTurnPolicy {
  const graph = input.config.flow_graph;
  const globallyEnabledToolNames = unique(input.config.enabled_tool_names ?? []);
  const activeNodeId = resolveActiveNode(graph, input.intentScope, input.persistedActiveNodeId);
  const attachedToolNames = graph ? connectedToolNames(graph, activeNodeId) : [];
  const attachedToolInstructions = graph ? connectedToolInstructions(graph, activeNodeId) : {};
  const requestedMode = input.config.tool_mode;
  const toolMode: AutopilotToolMode = requestedMode ?? (attachedToolNames.length ? "on_demand" : "deny");
  const enabled = new Set(globallyEnabledToolNames);
  const scopedToolNames = toolMode === "deny"
    ? []
    : attachedToolNames.filter((name) => enabled.has(name));
  const allowedToolNames = includeCompanionTools({
    scopedToolNames,
    globallyEnabledToolNames,
  });

  return {
    activeNodeId,
    toolMode,
    globallyEnabledToolNames,
    attachedToolNames,
    allowedToolNames,
    toolInstructionsByName: Object.fromEntries(
      allowedToolNames
        .filter((name) => attachedToolInstructions[name])
        .map((name) => [name, attachedToolInstructions[name]]),
    ),
    allowedKnowledgeDocumentIds: resolveAllowedKnowledgeDocumentIds(input),
    reason: !graph
      ? "flow_graph_missing"
      : !activeNodeId
        ? "active_flow_node_missing"
        : toolMode === "deny"
          ? "flow_tool_mode_deny"
          : attachedToolNames.length === 0
            ? "active_flow_node_has_no_tools"
            : allowedToolNames.length === 0
              ? "attached_tools_not_enabled"
              : "flow_scoped_tools_allowed",
  };
}
