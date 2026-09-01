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
import { createStudioMcpFetch } from '@/services/agent-studio/mcp-transport';

function buildRequestInit(server: McpServerConfig): RequestInit | undefined {
  const headers = Object.fromEntries(
    Object.entries(server.headers || {})
      .map(([key, value]) => [key.trim(), String(value ?? '').trim()])
      .filter(([key, value]) => key && value)
  );

  if (Object.keys(headers).length === 0) return undefined;
  return { headers };
}

async function withMcpClient<T>(server: McpServerConfig, task: (client: Client) => Promise<T>, totalTimeoutMs?: number, strictPublicNetwork = false, signal?: AbortSignal): Promise<T> {
  if (!strictPublicNetwork) server = applyMcpRuntimeEndpointOverride(server);
  const client = new Client({ name: 'dialogy', version: '1.0.0' }, { capabilities: {} });
  let circuitRequestStarted = false;
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
  const requestInit = { ...buildRequestInit(server), ...(totalTimeoutMs ? { signal: controller.signal } : {}) };
  let timer: ReturnType<typeof setTimeout> | undefined;
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
    const fetch = strictPublicNetwork ? createStudioMcpFetch(server.url, controller.signal) : undefined;
    return server.transport === 'sse'
      ? new SSEClientTransport(url, { requestInit, fetch })
      : new StreamableHTTPClientTransport(url, { requestInit, fetch });
  })();

  try {
    beginMcpCircuitRequest(server);
    circuitRequestStarted = true;
    const operation = async () => { controller.signal.throwIfAborted(); await client.connect(transport); if (controller.signal.aborted) throw new Error('Conexão MCP cancelada.'); return task(client); };
    const result = totalTimeoutMs ? await Promise.race([operation(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); void client.close().catch(() => undefined); reject(new Error('O servidor MCP excedeu o tempo limite; confira o resultado antes de repetir.')); }, totalTimeoutMs);
    })]) : await operation();
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
    let safeDetail = detail;
    for (const secret of [...Object.values(server.headers || {}), ...Object.values(server.env || {})].filter(Boolean)) safeDetail = safeDetail.split(secret).join('[protegido]');
    throw new Error(`Falha na comunicacao com MCP "${server.name}" em ${target}: ${safeDetail}`);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    if (totalTimeoutMs) {
      controller.abort();
      // Do not let a broken remote close handshake hang the Studio worker.
      void client.close().catch(() => undefined);
    } else await client.close().catch(() => undefined);
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

export async function listMcpServerTools(server: McpServerConfig, strictPublicNetwork = false): Promise<McpToolConfig[]> {
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
  }, 20_000, strictPublicNetwork);
}

export async function callMcpServerTool(input: {
  server: McpServerConfig;
  toolName: string;
  arguments?: Record<string, unknown> | null;
  totalTimeoutMs?: number;
  strictPublicNetwork?: boolean;
  signal?: AbortSignal;
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
  }, input.totalTimeoutMs, input.strictPublicNetwork, input.signal);
}
