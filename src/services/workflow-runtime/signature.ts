import type { WorkflowDefinition } from './types';

/**
 * Computes a deterministic signature of the functional (runtime/execution) logic of a workflow.
 * Excludes node coordinates, visual positioning, and UI layout metadata so moving blocks around
 * does not trigger a new published version or mark the flow as functionally changed.
 */
export function workflowFunctionalSignature(definition: WorkflowDefinition | null | undefined): string {
  if (!definition) return '';
  const metadata = Object.fromEntries(Object.entries(definition.metadata || {}).filter(([key]) => key !== 'flowBuilderUi'));
  return JSON.stringify({
    name: definition.name,
    nodes: (definition.nodes || []).map((node) => ({
      id: node.id,
      type: node.type,
      name: node.name,
      config: node.config,
      inputPorts: node.inputPorts,
      outputPorts: node.outputPorts,
      retryPolicy: node.retryPolicy,
      timeoutMs: node.timeoutMs,
    })),
    connections: (definition.connections || []).map((c) => ({
      id: c.id,
      sourceNodeId: c.sourceNodeId,
      sourcePortId: c.sourcePortId,
      targetNodeId: c.targetNodeId,
      targetPortId: c.targetPortId,
      connectionType: c.connectionType,
    })),
    settings: definition.settings,
    inputSchema: definition.inputSchema,
    outputSchema: definition.outputSchema,
    metadata: Object.keys(metadata).length ? metadata : undefined,
  });
}

/**
 * Computes a signature of the complete workflow definition including visual positions,
 * used to detect if there are layout changes that should be saved in the draft.
 */
export function workflowLayoutSignature(definition: WorkflowDefinition | null | undefined): string {
  if (!definition) return '';
  return JSON.stringify(definition, (key, value) => (key === 'updatedAt' ? undefined : value));
}
