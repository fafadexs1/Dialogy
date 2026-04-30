import 'server-only';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';

import type { McpServerConfig, McpToolConfig } from './types';

function buildRequestInit(server: McpServerConfig): RequestInit | undefined {
  const headers = Object.fromEntries(
    Object.entries(server.headers || {})
      .map(([key, value]) => [key.trim(), String(value ?? '').trim()])
      .filter(([key, value]) => key && value)
  );

  if (Object.keys(headers).length === 0) return undefined;
  return { headers };
}

async function withMcpClient<T>(server: McpServerConfig, task: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ name: 'dialogy', version: '1.0.0' }, { capabilities: {} });
  const requestInit = buildRequestInit(server);
  const transport = (() => {
    if (server.transport === 'stdio') {
      if (!server.command?.trim()) {
        throw new Error('Servidor MCP stdio sem comando configurado.');
      }

      return new StdioClientTransport({
        command: server.command.trim(),
        args: server.args || [],
        env: {
          ...getDefaultEnvironment(),
          ...(server.env || {}),
        },
        cwd: server.cwd || undefined,
        stderr: 'pipe',
      });
    }

    if (!server.url) {
      throw new Error('Servidor MCP HTTP/SSE sem URL configurada.');
    }

    const url = new URL(server.url);
    return server.transport === 'sse'
      ? new SSEClientTransport(url, { requestInit })
      : new StreamableHTTPClientTransport(url, { requestInit });
  })();

  try {
    await client.connect(transport);
    return await task(client);
  } finally {
    await client.close().catch(() => undefined);
  }
}

export function qualifyMcpToolName(serverId: string, toolName: string) {
  return `mcp:${serverId}:${toolName}`;
}

export function parseQualifiedMcpToolName(qualifiedName: string) {
  const match = /^mcp:([^:]+):(.+)$/.exec(qualifiedName);
  if (!match) return null;
  return { serverId: match[1], toolName: match[2] };
}

export async function listMcpServerTools(server: McpServerConfig): Promise<McpToolConfig[]> {
  return withMcpClient(server, async (client) => {
    const result = await client.listTools(undefined, { timeout: 10000 });
    return (result.tools || []).map((tool) => ({
      qualifiedName: qualifyMcpToolName(server.id, tool.name),
      serverId: server.id,
      serverName: server.name,
      name: tool.name,
      title: tool.title ?? null,
      description: tool.description ?? null,
      inputSchema: (tool.inputSchema || null) as Record<string, unknown> | null,
      outputSchema: (tool.outputSchema || null) as Record<string, unknown> | null,
      annotations: tool.annotations || null,
    }));
  });
}

export async function callMcpServerTool(input: {
  server: McpServerConfig;
  toolName: string;
  arguments?: Record<string, unknown> | null;
}) {
  return withMcpClient(input.server, async (client) => {
    return client.callTool(
      {
        name: input.toolName,
        arguments: input.arguments || {},
      },
      undefined,
      { timeout: 10000 }
    );
  });
}
