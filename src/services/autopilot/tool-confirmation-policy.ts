import type {
  AgentToolCatalogItem,
  AgentToolDefinition,
} from '@/services/agent-tools/catalog';

function normalizeCapabilityText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

export function isSensitiveMcpCatalogTool(
  tool: AgentToolDefinition | AgentToolCatalogItem,
): boolean {
  const source = 'source' in tool ? tool.source : 'dialogy';
  if (source !== 'mcp') return false;
  const text = normalizeCapabilityText([
    tool.name,
    tool.description,
    tool.inputSchema ? JSON.stringify(tool.inputSchema) : '',
  ].join(' '));
  return /\b(reboot_router|reboot|reiniciar|resetar|change_wifi_credentials|trocar.*wifi|alterar.*wifi|credentials)\b/.test(text);
}

export function catalogToolRequiresConfirmation(
  tool: AgentToolDefinition | AgentToolCatalogItem,
): boolean {
  return (
    isSensitiveMcpCatalogTool(tool)
    || tool.riskLevel === 'high'
    || tool.requiresHumanApproval
  );
}
