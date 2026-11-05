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

async function directJsonRpcRequest<T>(
  server: McpServerConfig,
  method: string,
  params: Record<string, unknown> = {},
  totalTimeoutMs = 12000,
  signal?: AbortSignal,
): Promise<T> {
  if (!server.url) {
    throw new Error('Servidor MCP HTTP sem URL configurada.');
  }
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => controller.abort(), totalTimeoutMs);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    ...(server.headers || {}),
  };

  const id = Date.now();
  const payload = {
    jsonrpc: '2.0',
    id,
    method,
    params,
  };

  try {
    const res = await fetch(server.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Servidor MCP retornou HTTP ${res.status}: ${errText.slice(0, 300)}`);
    }

    const data = await res.json();
    if (data && data.error) {
      const errCode = data.error.code ?? -32603;
      const errMsg = data.error.message || 'Erro desconhecido retornado pelo servidor MCP';
      throw new Error(`MCP Error [${errCode}]: ${errMsg}`);
    }

    return data.result as T;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

async function directJsonRpcNotify(
  server: McpServerConfig,
  method: string,
  params: Record<string, unknown> = {},
  signal?: AbortSignal,
): Promise<void> {
  if (!server.url) return;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(server.headers || {}),
  };
  await fetch(server.url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', method, params }),
    signal,
  }).catch(() => undefined);
}

// Operational rules from ACS /como-usar for auto-enrichment
const ACS_ROUTER_RULES: Record<string, { summary: string; rules: string[] }> = {
  list_routers: {
    summary: 'Localiza CPEs por MAC, IP, serial, modelo ou status de conexão.',
    rules: ['Use para descobrir o device_id de um cliente a partir de IP, MAC ou modelo.'],
  },
  get_router_details: {
    summary: 'Mede atenuação óptica (Rx/Tx dBm), firmware, uptime e status WAN.',
    rules: [
      'Faixa aceitável de atenuação óptica: entre -8 dBm e -27 dBm.',
      'Atenuação pior que -28 dBm indica rompimento ou dobra na fibra.',
    ],
  },
  get_wifi_diagnostics: {
    summary: 'Coleta estado dos rádios 2.4GHz e 5GHz, SSIDs, canais, segurança e senha Wi-Fi.',
    rules: ['Consulte antes de qualquer alteração de Wi-Fi para conhecer as redes atuais e fornecer nome e senha da rede ao cliente quando solicitado.'],
  },
  configure_wifi: {
    summary: 'Configuração atômica de SSID, senha, canal e rádios.',
    rules: [
      'Altere SSID, senha e canal de forma atômica e simultânea em uma única chamada.',
      'A senha Wi-Fi deve ter no mínimo 8 caracteres.',
    ],
  },
  list_connected_clients: {
    summary: 'Inventário de aparelhos conectados (IP, MAC, RSSI, banda 2.4G/5G).',
    rules: ['Sinal RSSI abaixo de -75 dBm indica cobertura fraca no dispositivo do cliente.'],
  },
  scan_wifi_spectrum: {
    summary: 'Varredura de espectro RF dos vizinhos para identificar interferência.',
    rules: ['Use_cached: true retorna o scan recente em cache imediatamente.'],
  },
  reboot_router: {
    summary: 'Reinício remoto auditado da CPE.',
    rules: [
      'Obrigatório passar confirm: true para autorizar o reinício.',
      'Obrigatório fornecer um reason técnico fundamentado na conversa.',
    ],
  },
  get_operation_status: {
    summary: 'Status de comandos TR-069 assíncronos no ACS.',
    rules: ['Consulte periodicamente até obter estado terminal (success, failed, expired).'],
  },
  get_tool_manual: {
    summary: 'Manual técnico oficial de uso das ferramentas MCP (/como-usar).',
    rules: ['Consulte o manual da ferramenta antes de executar ações críticas em roteadores.'],
  },
};

function enrichToolWithAcsMetadata(server: McpServerConfig, tool: any): McpToolConfig {
  const acsMeta = ACS_ROUTER_RULES[tool.name];
  return {
    qualifiedName: qualifyMcpToolName(server.id, tool.name),
    serverId: server.id,
    serverName: server.name,
    name: tool.name,
    title: tool.title || (acsMeta ? acsMeta.summary.split('.')[0] : null),
    description: tool.description ?? null,
    inputSchema: (tool.inputSchema || null) as Record<string, unknown> | null,
    outputSchema: (tool.outputSchema || null) as Record<string, unknown> | null,
    annotations: tool.annotations || null,
    manualSummary: acsMeta?.summary || null,
    operationalRules: acsMeta?.rules || null,
  };
}

export async function listMcpServerTools(server: McpServerConfig, strictPublicNetwork = false): Promise<McpToolConfig[]> {
  // If transport is direct_http OR an HTTP URL is provided and not explicitly set to stdio or sse
  const isDirectHttpCandidate =
    server.transport === 'direct_http' ||
    (server.transport !== 'stdio' && server.transport !== 'sse' && Boolean(server.url?.startsWith('http')));

  if (isDirectHttpCandidate) {
    try {
      beginMcpCircuitRequest(server);
      await directJsonRpcRequest(server, 'initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'dialogy', version: '1.0.0' },
      }, 5000);

      await directJsonRpcNotify(server, 'notifications/initialized', {});

      const result = await directJsonRpcRequest<{ tools: any[] }>(server, 'tools/list', {}, 8000);
      recordMcpCircuitSuccess(server);

      return (result.tools || []).map((tool) => enrichToolWithAcsMetadata(server, tool));
    } catch (directError) {
      if (server.transport === 'direct_http') {
        recordMcpCircuitFailure(server);
        throw directError;
      }
      // If direct HTTP fails on a dual-mode or streamable_http server, fall back to withMcpClient
    }
  }

  return withMcpClient(server, async (client) => {
    const result = await client.listTools(undefined, {
      timeout: Math.min(resolveMcpToolTimeoutMs(), 15000),
    });
    return (result.tools || []).map((tool) => enrichToolWithAcsMetadata(server, tool));
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
  const isDirectHttpCandidate =
    input.server.transport === 'direct_http' ||
    (input.server.transport !== 'stdio' && input.server.transport !== 'sse' && Boolean(input.server.url?.startsWith('http')));

  if (isDirectHttpCandidate) {
    try {
      beginMcpCircuitRequest(input.server);
      const res = await directJsonRpcRequest<{
        content?: any[];
        structuredContent?: any;
        isError?: boolean;
      }>(
        input.server,
        'tools/call',
        {
          name: input.toolName,
          arguments: input.arguments || {},
        },
        input.totalTimeoutMs || resolveMcpToolTimeoutMs(),
        input.signal
      );
      recordMcpCircuitSuccess(input.server);

      return {
        content: res.content || [],
        structuredContent: res.structuredContent || null,
        isError: Boolean(res.isError),
      };
    } catch (directError) {
      if (input.server.transport === 'direct_http') {
        recordMcpCircuitFailure(input.server);
        throw directError;
      }
      // Fallback to withMcpClient
    }
  }

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
