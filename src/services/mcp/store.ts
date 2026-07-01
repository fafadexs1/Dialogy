import 'server-only';

import { db } from '@/lib/db';
import { ensureWorkspaceIntegrationsTable } from '@/lib/workspace-integrations';
import type { McpServerConfig, McpWorkspaceConfig } from './types';

const MCP_PROVIDER = 'mcp';

export async function getMcpWorkspaceConfig(workspaceId: string): Promise<McpWorkspaceConfig> {
  await ensureWorkspaceIntegrationsTable();
  const { rows } = await db.query(
    `SELECT config FROM workspace_integrations WHERE workspace_id = $1 AND provider = $2 LIMIT 1`,
    [workspaceId, MCP_PROVIDER]
  );

  const config = rows[0]?.config || {};
  const servers = Array.isArray(config.servers) ? config.servers : [];
  return {
    servers: servers
      .filter((server: any) => server && typeof server === 'object')
      .map((server: any) => ({
        id: String(server.id || ''),
        name: String(server.name || ''),
        url: server.url ? String(server.url) : undefined,
        transport: server.transport === 'sse' ? 'sse' : server.transport === 'stdio' ? 'stdio' : 'streamable_http',
        headers: server.headers && typeof server.headers === 'object' ? server.headers : {},
        command: server.command ? String(server.command) : undefined,
        args: Array.isArray(server.args) ? server.args.map(String) : [],
        env: server.env && typeof server.env === 'object' ? server.env : {},
        cwd: server.cwd ? String(server.cwd) : null,
        isActive: Boolean(server.isActive),
        syncedAt: server.syncedAt || null,
        lastError: server.lastError || null,
        healthStatus: server.healthStatus === 'healthy' || server.healthStatus === 'unreachable'
          ? server.healthStatus
          : 'unknown',
        healthCheckedAt: server.healthCheckedAt || null,
        healthLatencyMs: Number.isFinite(Number(server.healthLatencyMs))
          ? Number(server.healthLatencyMs)
          : null,
        tools: Array.isArray(server.tools) ? server.tools : [],
      }))
      .filter((server: McpServerConfig) => (
        server.id &&
        server.name &&
        (server.transport === 'stdio' ? Boolean(server.command) : Boolean(server.url))
      )),
  };
}

export async function saveMcpWorkspaceConfig(workspaceId: string, config: McpWorkspaceConfig) {
  await ensureWorkspaceIntegrationsTable();
  await db.query(
    `INSERT INTO workspace_integrations (workspace_id, provider, config, is_active, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (workspace_id, provider)
     DO UPDATE SET config = $3, is_active = $4, updated_at = NOW()`,
    [workspaceId, MCP_PROVIDER, JSON.stringify(config), config.servers.some((server) => server.isActive)]
  );
}

export async function recordMcpServerHealth(input: {
  workspaceId: string;
  serverId: string;
  status: 'healthy' | 'unreachable';
  latencyMs: number;
  error?: string | null;
}): Promise<void> {
  const healthPatch = {
    healthStatus: input.status,
    healthCheckedAt: new Date().toISOString(),
    healthLatencyMs: Math.max(0, Math.round(input.latencyMs)),
    lastError: input.error?.slice(0, 2000) || null,
  };
  await db.query(
    `UPDATE workspace_integrations integration
     SET config = jsonb_set(
           COALESCE(integration.config, '{}'::jsonb),
           '{servers}',
           COALESCE((
             SELECT jsonb_agg(
               CASE
                 WHEN server.item->>'id' = $3
                   THEN server.item || $4::jsonb
                 ELSE server.item
               END
               ORDER BY server.ordinality
             )
             FROM jsonb_array_elements(
               COALESCE(integration.config->'servers', '[]'::jsonb)
             ) WITH ORDINALITY AS server(item, ordinality)
           ), '[]'::jsonb),
           true
         ),
         updated_at = clock_timestamp()
     WHERE integration.workspace_id = $1
       AND integration.provider = $2`,
    [
      input.workspaceId,
      MCP_PROVIDER,
      input.serverId,
      JSON.stringify(healthPatch),
    ],
  );
}

export async function listMcpToolsForWorkspace(workspaceId: string) {
  const config = await getMcpWorkspaceConfig(workspaceId);
  return config.servers
    .filter((server) => server.isActive)
    .flatMap((server) => server.tools || []);
}
