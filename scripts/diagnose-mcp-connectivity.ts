import 'dotenv/config';

import { connect } from 'node:net';

import { db } from '../src/lib/db';
import { listMcpServerTools } from '../src/services/mcp/client';
import type { McpServerConfig } from '../src/services/mcp/types';

function redactError(value: unknown): string {
  const message = value instanceof Error ? value.message : String(value);
  return message
    .replace(/https?:\/\/[^\s/]+/gi, '[endpoint]')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[ip]')
    .slice(0, 500);
}

function endpointKind(hostname: string): string {
  if (/^(?:10|127)\./.test(hostname)) return 'private-ip';
  if (/^192\.168\./.test(hostname)) return 'private-ip';
  const secondOctet = Number(hostname.split('.')[1]);
  if (/^172\./.test(hostname) && secondOctet >= 16 && secondOctet <= 31) return 'private-ip';
  if (/^[\d.]+$/.test(hostname)) return 'public-ip';
  return 'hostname';
}

async function probeTcp(urlValue: string): Promise<{
  reachable: boolean;
  latencyMs: number;
  error?: string;
}> {
  const url = new URL(urlValue);
  const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
  const startedAt = Date.now();

  return new Promise((resolve) => {
    const socket = connect({ host: url.hostname, port });
    const finish = (result: { reachable: boolean; error?: string }) => {
      socket.destroy();
      resolve({ ...result, latencyMs: Date.now() - startedAt });
    };
    socket.setTimeout(5_000);
    socket.once('connect', () => finish({ reachable: true }));
    socket.once('timeout', () => finish({ reachable: false, error: 'tcp_timeout' }));
    socket.once('error', (error: NodeJS.ErrnoException) => {
      finish({ reachable: false, error: error.code || 'tcp_error' });
    });
  });
}

async function resolveWorkspaceId(input: string): Promise<string> {
  const { rows } = await db.query(
    `SELECT workspace_id
     FROM chats
     WHERE id = $1
     UNION ALL
     SELECT id AS workspace_id
     FROM workspaces
     WHERE id = $1
     LIMIT 1`,
    [input],
  );
  const workspaceId = rows[0]?.workspace_id;
  if (!workspaceId) {
    throw new Error('Chat ou workspace nao encontrado.');
  }
  return String(workspaceId);
}

async function main() {
  const input = process.argv[2]?.trim();
  if (!input) {
    throw new Error('Uso: tsx scripts/diagnose-mcp-connectivity.ts <chat-id-ou-workspace-id>');
  }

  const workspaceId = await resolveWorkspaceId(input);
  const { rows } = await db.query(
    `SELECT config
     FROM workspace_integrations
     WHERE workspace_id = $1
       AND provider = 'mcp'
       AND is_active = true
     LIMIT 1`,
    [workspaceId],
  );
  const rawServers = Array.isArray(rows[0]?.config?.servers)
    ? rows[0].config.servers
    : [];
  const servers = rawServers.filter((server: any) => server?.isActive);
  const results = [];

  for (const rawServer of servers) {
    const server = rawServer as McpServerConfig;
    let tcp: Awaited<ReturnType<typeof probeTcp>> | null = null;
    if (server.transport !== 'stdio' && server.url) {
      tcp = await probeTcp(server.url);
    }

    const startedAt = Date.now();
    try {
      const tools = await listMcpServerTools(server);
      results.push({
        serverId: server.id,
        serverName: server.name,
        transport: server.transport,
        endpointKind: server.url ? endpointKind(new URL(server.url).hostname) : 'local-process',
        persistedHealth: {
          status: server.healthStatus || 'unknown',
          checkedAt: server.healthCheckedAt || null,
          latencyMs: server.healthLatencyMs ?? null,
        },
        tcp,
        handshake: {
          success: true,
          latencyMs: Date.now() - startedAt,
          toolCount: tools.length,
          toolNames: tools.map((tool) => tool.name).sort(),
        },
      });
    } catch (error) {
      results.push({
        serverId: server.id,
        serverName: server.name,
        transport: server.transport,
        endpointKind: server.url ? endpointKind(new URL(server.url).hostname) : 'local-process',
        persistedHealth: {
          status: server.healthStatus || 'unknown',
          checkedAt: server.healthCheckedAt || null,
          latencyMs: server.healthLatencyMs ?? null,
        },
        tcp,
        handshake: {
          success: false,
          latencyMs: Date.now() - startedAt,
          error: redactError(error),
        },
      });
    }
  }

  console.log(JSON.stringify({
    workspaceResolved: true,
    activeServerCount: servers.length,
    results,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(redactError(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.end();
  });
