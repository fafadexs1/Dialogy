import { validateSchema } from 'genkit/schema';

import { normalizeMcpToolArguments } from '@/services/agent-tools/mcp-arguments';
import { callMcpServerTool, parseQualifiedMcpToolName } from '@/services/mcp/client';
import { getMcpWorkspaceConfig, recordMcpServerHealth } from '@/services/mcp/store';
import { classifyMcpToolSafety } from '@/services/mcp/tool-safety';
import { normalizeToolArgumentsFromJsonSchema } from '@/services/workflow-runtime/tool-arguments';
import { stableStringify } from '@/services/workflow-runtime/utils';

type McpWorkspaceConfig = Awaited<ReturnType<typeof getMcpWorkspaceConfig>>;
type McpCallResult = Awaited<ReturnType<typeof callMcpServerTool>>;

export type NexusMcpOperationInput = {
  workspaceId: string;
  qualifiedName: string;
  arguments: unknown;
  confirmed?: boolean;
  enforceConfirmation?: boolean;
  maxOutputBytes?: number;
  signal?: AbortSignal;
  getConfig?: (workspaceId: string) => Promise<McpWorkspaceConfig>;
  callTool?: typeof callMcpServerTool;
  recordHealth?: typeof recordMcpServerHealth;
};

export async function executeNexusMcpOperation(input: NexusMcpOperationInput): Promise<Record<string, unknown>> {
  const qualifiedName = input.qualifiedName.trim();
  const parsed = parseQualifiedMcpToolName(qualifiedName);
  if (!parsed) throw new Error('Selecione uma ferramenta MCP sincronizada da Dialogy.');
  if (input.signal?.aborted) throw input.signal.reason || new Error('Execução MCP cancelada.');

  const getConfig = input.getConfig || getMcpWorkspaceConfig;
  const config = await getConfig(input.workspaceId);
  const server = config.servers.find((candidate) => candidate.id === parsed.serverId && candidate.isActive);
  if (!server) throw new Error('O servidor MCP selecionado não existe ou está inativo neste workspace.');
  const tool = (server.tools || []).find((candidate) => candidate.qualifiedName === qualifiedName);
  if (!tool) throw new Error('A ferramenta MCP não está sincronizada neste workspace.');

  const safety = classifyMcpToolSafety(qualifiedName, tool);
  if (input.enforceConfirmation !== false && safety.riskLevel !== 'low' && input.confirmed !== true) {
    throw new Error(`A ferramenta MCP ${tool.title || tool.name} exige confirmação explícita antes da execução.`);
  }

  const normalized = normalizeMcpToolArguments(input.arguments);
  if (!normalized.success) throw new Error(normalized.error);
  const argumentsValue = normalizeToolArgumentsFromJsonSchema(normalized.arguments, tool.inputSchema);
  if (tool.inputSchema && Object.keys(tool.inputSchema).length > 0) {
    const validation = validateSchema(argumentsValue, { jsonSchema: tool.inputSchema });
    if (!validation.valid) {
      const required = Array.isArray(tool.inputSchema.required) ? tool.inputSchema.required.map(String) : [];
      throw new Error(`Argumentos inválidos para ${tool.title || tool.name}. Campos esperados: ${required.join(', ') || 'conforme o schema sincronizado'}.`);
    }
  }

  const callTool = input.callTool || callMcpServerTool;
  const recordHealth = input.recordHealth || recordMcpServerHealth;
  const startedAt = Date.now();
  let result: McpCallResult;
  try {
    result = await callTool({ server, toolName: parsed.toolName, arguments: argumentsValue });
    await recordHealth({
      workspaceId: input.workspaceId,
      serverId: server.id,
      status: 'healthy',
      latencyMs: Date.now() - startedAt,
    }).catch(() => undefined);
  } catch (error) {
    await recordHealth({
      workspaceId: input.workspaceId,
      serverId: server.id,
      status: 'unreachable',
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    }).catch(() => undefined);
    throw error;
  }
  if (input.signal?.aborted) throw input.signal.reason || new Error('Execução MCP cancelada.');

  const output = result as unknown as Record<string, unknown>;
  if (output.isError === true) {
    const content = Array.isArray(output.content)
      ? output.content.map((item) => item && typeof item === 'object' && 'text' in item ? String(item.text) : '').filter(Boolean).join('\n')
      : '';
    throw new Error(content || `A ferramenta MCP ${tool.title || tool.name} retornou erro.`);
  }
  const maxOutputBytes = Math.max(1_024, Math.min(5_000_000, Number(input.maxOutputBytes || 1_000_000)));
  if (Buffer.byteLength(stableStringify(output), 'utf8') > maxOutputBytes) {
    throw new Error(`A resposta MCP excede o limite de ${maxOutputBytes} bytes.`);
  }
  return {
    qualifiedName,
    serverId: server.id,
    serverName: server.name,
    toolName: tool.name,
    riskLevel: safety.riskLevel,
    result: output,
  };
}
