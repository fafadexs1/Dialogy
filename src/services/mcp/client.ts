import 'server-only';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';

import type { McpServerConfig, McpToolConfig } from './types';
import {
  beginMcpCircuitRequest,
  isMcpTransportFailure,
  McpCircuitOpenError,
  recordMcpCircuitFailure,
  recordMcpCircuitSuccess,
} from './circuit-breaker';
import { resolveMcpToolTimeoutMs } from './tool-safety';
import { applyMcpRuntimeEndpointOverride } from './runtime-overrides';

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
  server = applyMcpRuntimeEndpointOverride(server);
  const client = new Client({ name: 'dialogy', version: '1.0.0' }, { capabilities: {} });
  let circuitRequestStarted = false;
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
    beginMcpCircuitRequest(server);
    circuitRequestStarted = true;
    await client.connect(transport);
    const result = await task(client);
    recordMcpCircuitSuccess(server);
    return result;
  } catch (error) {
    if (circuitRequestStarted) {
      if (isMcpTransportFailure(error)) {
        recordMcpCircuitFailure(server);
      } else {
        recordMcpCircuitSuccess(server);
      }
    }
    const cause = error && typeof error === 'object' ? (error as any).cause : null;
    const code = String(cause?.code || (error as any)?.code || '').trim();
    const address = String(cause?.address || '').trim();
    const port = cause?.port != null ? String(cause.port) : '';
    const target = server.transport === 'stdio'
      ? server.command || server.name
      : (() => {
        try {
          const url = new URL(server.url || '');
          return `${url.protocol}//${url.host}${url.pathname}`;
        } catch {
          return server.name;
        }
      })();
    const detail = [
      error instanceof Error ? error.message : String(error),
      error instanceof McpCircuitOpenError ? `retry_after_ms=${error.retryAfterMs}` : '',
      code,
      address && port ? `${address}:${port}` : address || port,
    ].filter(Boolean).join(' | ');
    throw new Error(`Falha na comunicacao com MCP "${server.name}" em ${target}: ${detail}`);
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
    const result = await client.listTools(undefined, {
      timeout: Math.min(resolveMcpToolTimeoutMs(), 15000),
    });
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
      { timeout: resolveMcpToolTimeoutMs() }
    );
  });
}
