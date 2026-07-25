import {
  getAgentToolDefinition,
  type AgentToolCatalogItem,
  type AgentToolDefinition,
} from '@/services/agent-tools/catalog';

/**
 * Guard for suggestion mode.
 *
 * A draft the operator has not approved yet must never change the customer's world.
 * Reading is encouraged — a suggestion grounded in the real contract, invoice or
 * panel is the whole point — so only tools that cannot mutate anything survive.
 */
export function isNonMutatingAgentTool(
  toolName: string,
  catalog: AgentToolCatalogItem[] = [],
): boolean {
  const definition: AgentToolDefinition | AgentToolCatalogItem | undefined =
    getAgentToolDefinition(toolName as never)
    || catalog.find((item) => item.name === toolName);

  if (!definition) return false;
  if (definition.requiresHumanApproval) return false;
  if (definition.sideEffect !== 'none') return false;

  return definition.class === 'read_only'
    || definition.class === 'retrieval'
    || definition.class === 'compute_only';
}

export function filterNonMutatingToolNames(
  toolNames: string[],
  catalog: AgentToolCatalogItem[] = [],
): string[] {
  return toolNames.filter((toolName) => isNonMutatingAgentTool(toolName, catalog));
}
