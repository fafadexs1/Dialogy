'use server';

import { randomUUID } from 'crypto';
import { revalidatePath } from 'next/cache';

import { getCurrentUser } from '@/actions/user';
import { db } from '@/lib/db';
import { hasWorkspacePermission } from '@/lib/workspace-permissions';
import { listMcpServerTools } from '@/services/mcp/client';
import { getMcpWorkspaceConfig, saveMcpWorkspaceConfig } from '@/services/mcp/store';
import type { McpServerConfig, McpServerTransport } from '@/services/mcp/types';

function sanitizeHeaders(input: unknown): Record<string, string> {
  if (!input || typeof input !== 'object') return {};
  return Object.fromEntries(
    Object.entries(input as Record<string, unknown>)
      .map(([key, value]) => [key.trim(), String(value ?? '').trim()])
      .filter(([key, value]) => key && value)
  );
}

function sanitizeStringArray(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input.map((item) => String(item ?? '').trim()).filter(Boolean);
}

function assertHttpUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('A URL do MCP precisa usar http ou https.');
  }
  return url.toString();
}

async function requireWorkspace(workspaceId: string) {
  const user = await getCurrentUser();
  if (!user) return { user: null, error: 'Usuario nao autenticado.' };
  if (!await hasWorkspacePermission(user.id, workspaceId, 'workspace:settings:edit')) {
    return { user: null, error: 'Acesso negado ao workspace.' };
  }
  return { user, error: null };
}

async function requireStdioOptIn(userId: string): Promise<string | null> {
  if (process.env.ALLOW_MCP_STDIO !== 'true') {
    return 'O transporte MCP stdio esta desabilitado neste ambiente.';
  }
  const result = await db.query('SELECT is_superadmin FROM users WHERE id = $1', [userId]);
  return result.rows[0]?.is_superadmin
    ? null
    : 'Apenas superadministradores podem executar servidores MCP stdio.';
}

export async function getMcpServersAction(workspaceId: string) {
  const auth = await requireWorkspace(workspaceId);
  if (auth.error) return { servers: [], error: auth.error };

  const config = await getMcpWorkspaceConfig(workspaceId);
  return { servers: config.servers };
}

export async function upsertMcpServerAction(input: {
  workspaceId: string;
  id?: string | null;
  name: string;
  url?: string;
  transport?: McpServerTransport;
  headers?: Record<string, string>;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string | null;
  isActive?: boolean;
}) {
  const auth = await requireWorkspace(input.workspaceId);
  if (auth.error) return { success: false, error: auth.error };

  try {
    const config = await getMcpWorkspaceConfig(input.workspaceId);
    const id = input.id || randomUUID();
    const transport = input.transport === 'sse'
      ? 'sse'
      : input.transport === 'stdio'
        ? 'stdio'
        : 'streamable_http';
    if (transport === 'stdio') {
      const stdioError = await requireStdioOptIn(auth.user!.id);
      if (stdioError) return { success: false, error: stdioError };
    }
    const nextServer: McpServerConfig = {
      id,
      name: input.name.trim(),
      url: transport === 'stdio' ? undefined : assertHttpUrl((input.url || '').trim()),
      transport,
      headers: sanitizeHeaders(input.headers),
      command: transport === 'stdio' ? input.command?.trim() : undefined,
      args: transport === 'stdio' ? sanitizeStringArray(input.args) : [],
      env: transport === 'stdio' ? sanitizeHeaders(input.env) : {},
      cwd: transport === 'stdio' ? input.cwd?.trim() || null : null,
      isActive: input.isActive ?? true,
      tools: config.servers.find((server) => server.id === id)?.tools || [],
      syncedAt: config.servers.find((server) => server.id === id)?.syncedAt || null,
      lastError: null,
      healthStatus: config.servers.find((server) => server.id === id)?.healthStatus || 'unknown',
      healthCheckedAt: config.servers.find((server) => server.id === id)?.healthCheckedAt || null,
      healthLatencyMs: config.servers.find((server) => server.id === id)?.healthLatencyMs || null,
    };

    if (!nextServer.name) {
      return { success: false, error: 'Informe um nome para o servidor MCP.' };
    }
    if (transport === 'stdio' && !nextServer.command) {
      return { success: false, error: 'Informe o comando do servidor MCP stdio.' };
    }

    const servers = config.servers.some((server) => server.id === id)
      ? config.servers.map((server) => (server.id === id ? nextServer : server))
      : [...config.servers, nextServer];

    await saveMcpWorkspaceConfig(input.workspaceId, { servers });
    revalidatePath('/integrations');
    revalidatePath('/autopilot');
    return { success: true, id };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Falha ao salvar servidor MCP.' };
  }
}

export async function deleteMcpServerAction(workspaceId: string, serverId: string) {
  const auth = await requireWorkspace(workspaceId);
  if (auth.error) return { success: false, error: auth.error };

  const config = await getMcpWorkspaceConfig(workspaceId);
  await saveMcpWorkspaceConfig(workspaceId, {
    servers: config.servers.filter((server) => server.id !== serverId),
  });
  revalidatePath('/integrations');
  revalidatePath('/autopilot');
  return { success: true };
}

export async function syncMcpServerToolsAction(workspaceId: string, serverId: string) {
  const auth = await requireWorkspace(workspaceId);
  if (auth.error) return { success: false, error: auth.error };

  const config = await getMcpWorkspaceConfig(workspaceId);
  const server = config.servers.find((item) => item.id === serverId);
  if (!server) return { success: false, error: 'Servidor MCP nao encontrado.' };

  if (server.transport === 'stdio') {
    const stdioError = await requireStdioOptIn(auth.user!.id);
    if (stdioError) return { success: false, error: stdioError };
  }

  const startedAt = Date.now();
  const checkedAt = new Date().toISOString();
  try {
    const tools = await listMcpServerTools(server);
    await saveMcpWorkspaceConfig(workspaceId, {
      servers: config.servers.map((item) => (
        item.id === serverId
          ? {
            ...item,
            tools,
            syncedAt: checkedAt,
            lastError: null,
            healthStatus: 'healthy',
            healthCheckedAt: checkedAt,
            healthLatencyMs: Date.now() - startedAt,
          }
          : item
      )),
    });
    revalidatePath('/autopilot');
    return { success: true, tools };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await saveMcpWorkspaceConfig(workspaceId, {
      servers: config.servers.map((item) => (
        item.id === serverId
          ? {
            ...item,
            lastError: message,
            healthStatus: 'unreachable',
            healthCheckedAt: checkedAt,
            healthLatencyMs: Date.now() - startedAt,
          }
          : item
      )),
    });
    return { success: false, error: message };
  }
}

export async function testMcpServerConnectionAction(workspaceId: string, serverId: string) {
  const auth = await requireWorkspace(workspaceId);
  if (auth.error) return { success: false, error: auth.error };

  const config = await getMcpWorkspaceConfig(workspaceId);
  const server = config.servers.find((item) => item.id === serverId);
  if (!server) return { success: false, error: 'Servidor MCP nao encontrado.' };

  if (server.transport === 'stdio') {
    const stdioError = await requireStdioOptIn(auth.user!.id);
    if (stdioError) return { success: false, error: stdioError };
  }

  const startedAt = Date.now();
  const checkedAt = new Date().toISOString();
  try {
    const tools = await listMcpServerTools(server);
    const latencyMs = Date.now() - startedAt;
    await saveMcpWorkspaceConfig(workspaceId, {
      servers: config.servers.map((item) => item.id === serverId
        ? {
          ...item,
          healthStatus: 'healthy',
          healthCheckedAt: checkedAt,
          healthLatencyMs: latencyMs,
          lastError: null,
        }
        : item),
    });
    revalidatePath('/integrations/mcp');
    return { success: true, latencyMs, toolCount: tools.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await saveMcpWorkspaceConfig(workspaceId, {
      servers: config.servers.map((item) => item.id === serverId
        ? {
          ...item,
          healthStatus: 'unreachable',
          healthCheckedAt: checkedAt,
          healthLatencyMs: Date.now() - startedAt,
          lastError: message,
        }
        : item),
    });
    revalidatePath('/integrations/mcp');
    return { success: false, error: message };
  }
}
