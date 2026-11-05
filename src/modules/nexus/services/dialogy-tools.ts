import type { AgentToolCatalogItem } from '@/services/agent-tools/catalog';
import { listMcpToolsForWorkspace } from '@/services/mcp/store';
import { classifyMcpToolSafety, resolveMcpToolTimeoutMs } from '@/services/mcp/tool-safety';

export async function listNexusDialogyTools(workspaceId: string): Promise<AgentToolCatalogItem[]> {
  const tools = await listMcpToolsForWorkspace(workspaceId);
  return tools.map((tool) => {
    const safety = classifyMcpToolSafety(tool.qualifiedName, tool);
    return {
      name: tool.qualifiedName as AgentToolCatalogItem['name'],
      displayName: tool.title || undefined,
      category: 'mcp',
      version: 'mcp',
      description: tool.description || tool.title || `Ferramenta MCP ${tool.name} em ${tool.serverName}.`,
      class: safety.class,
      riskLevel: safety.riskLevel,
      sideEffect: safety.sideEffect,
      idempotent: safety.idempotent,
      timeoutMs: resolveMcpToolTimeoutMs(),
      maxAttempts: 1,
      requiresHumanApproval: safety.riskLevel !== 'low',
      customerVisible: true,
      allowedIntents: [],
      requiredSlots: [],
      fallbackAction: 'handoff',
      source: 'mcp',
      enabledByDefault: false,
      serverId: tool.serverId,
      serverName: tool.serverName,
      inputSchema: tool.inputSchema || null,
      outputSchema: tool.outputSchema || null,
    };
  });
}
