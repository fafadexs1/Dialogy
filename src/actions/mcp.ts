'use server';

import { randomUUID } from 'crypto';
import { revalidatePath } from 'next/cache';

import { getCurrentUser } from '@/actions/user';
import { db } from '@/lib/db';
import type { KnowledgeBaseDocument } from '@/lib/types';
import { hasWorkspacePermission } from '@/lib/workspace-permissions';
import { listMcpServerTools } from '@/services/mcp/client';
import { fetchMcpServerManuals, fetchToolManualMarkdown } from '@/services/mcp/manuals';
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
        : input.transport === 'direct_http'
          ? 'direct_http'
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
      manualsCatalog: config.servers.find((server) => server.id === id)?.manualsCatalog,
      manualsSyncedAt: config.servers.find((server) => server.id === id)?.manualsSyncedAt || null,
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

export async function syncMcpServerToolsAction(workspaceId: string, serverId: string, strictPublicNetwork = false) {
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
    const tools = await listMcpServerTools(server, strictPublicNetwork);
    let manualsCatalog = server.manualsCatalog;
    let manualsSyncedAt = server.manualsSyncedAt;
    try {
      const catalog = await fetchMcpServerManuals(server);
      if (catalog) {
        manualsCatalog = catalog;
        manualsSyncedAt = checkedAt;
      }
    } catch {
      // Non-blocking catalog sync
    }

    await saveMcpWorkspaceConfig(workspaceId, {
      servers: config.servers.map((item) => (
        item.id === serverId
          ? {
            ...item,
            tools,
            manualsCatalog,
            manualsSyncedAt,
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
    revalidatePath('/integrations/mcp');
    return { success: true, tools, manualsCatalog };
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

export async function syncMcpManualsAction(workspaceId: string, serverId: string) {
  const auth = await requireWorkspace(workspaceId);
  if (auth.error) return { success: false, error: auth.error };

  const config = await getMcpWorkspaceConfig(workspaceId);
  const server = config.servers.find((item) => item.id === serverId);
  if (!server) return { success: false, error: 'Servidor MCP nao encontrado.' };

  try {
    const catalog = await fetchMcpServerManuals(server);
    if (!catalog) {
      return { success: false, error: 'Não foi possível obter o catálogo de manuais deste servidor.' };
    }

    const syncedAt = new Date().toISOString();
    await saveMcpWorkspaceConfig(workspaceId, {
      servers: config.servers.map((item) =>
        item.id === serverId
          ? {
              ...item,
              manualsCatalog: catalog,
              manualsSyncedAt: syncedAt,
            }
          : item
      ),
    });

    revalidatePath('/integrations/mcp');
    return { success: true, catalog };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Falha ao sincronizar manuais.' };
  }
}

export async function getMcpToolManualAction(workspaceId: string, serverId: string, toolName: string) {
  const auth = await requireWorkspace(workspaceId);
  if (auth.error) return { success: false, error: auth.error };

  const config = await getMcpWorkspaceConfig(workspaceId);
  const server = config.servers.find((item) => item.id === serverId);
  if (!server) return { success: false, error: 'Servidor MCP nao encontrado.' };

  try {
    const manual = await fetchToolManualMarkdown(server, toolName);
    if (!manual) {
      return { success: false, error: `Manual não encontrado para a ferramenta '${toolName}'.` };
    }
    return { success: true, manual };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Falha ao carregar manual.' };
  }
}

export async function syncAcsManualsToKnowledgeAction(input: {
  workspaceId: string;
  serverId: string;
  autopilotConfigId?: string;
}) {
  const auth = await requireWorkspace(input.workspaceId);
  if (auth.error) return { success: false, error: auth.error };

  const config = await getMcpWorkspaceConfig(input.workspaceId);
  const server = config.servers.find((item) => item.id === input.serverId);
  if (!server) return { success: false, error: 'Servidor MCP nao encontrado.' };

  try {
    let catalog = server.manualsCatalog;
    if (!catalog) {
      catalog = await fetchMcpServerManuals(server);
    }
    if (!catalog || !catalog.tools.length) {
      return { success: false, error: 'Nenhum manual de ferramentas encontrado no servidor MCP.' };
    }

    let configId = input.autopilotConfigId;
    if (!configId) {
      const activeRes = await db.query(
        'SELECT id FROM autopilot_configs WHERE workspace_id = $1 ORDER BY updated_at DESC LIMIT 1',
        [input.workspaceId]
      );
      if (activeRes.rows.length === 0) {
        return { success: false, error: 'Nenhuma configuração de Autopilot encontrada para este workspace.' };
      }
      configId = activeRes.rows[0].id;
    }

    const currentConfigRes = await db.query(
      'SELECT id, knowledge_base_documents FROM autopilot_configs WHERE id = $1 AND workspace_id = $2 LIMIT 1',
      [configId, input.workspaceId]
    );
    if (currentConfigRes.rows.length === 0) {
      return { success: false, error: 'Configuração do Autopilot não encontrada.' };
    }

    const rawCurrentDocs = currentConfigRes.rows[0].knowledge_base_documents;
    let currentDocs: KnowledgeBaseDocument[] = [];
    if (Array.isArray(rawCurrentDocs)) {
      currentDocs = rawCurrentDocs;
    } else if (typeof rawCurrentDocs === 'string') {
      try {
        currentDocs = JSON.parse(rawCurrentDocs);
      } catch {
        currentDocs = [];
      }
    }

    const newDocs: KnowledgeBaseDocument[] = [...currentDocs];
    let syncedCount = 0;

    // First, sync index manual
    const indexManual = await fetchToolManualMarkdown(server, 'index');
    if (indexManual && indexManual.markdown) {
      const docSource = `mcp_acs:${server.id}:index`;
      const docIndex = newDocs.findIndex((d) => d.source === docSource);
      const doc: KnowledgeBaseDocument = {
        id: docIndex >= 0 ? newDocs[docIndex].id : randomUUID(),
        name: `Manual Geral ACS: Visão Geral e /como-usar`,
        content: indexManual.markdown,
        sourceFormat: 'markdown',
        summary: 'Diretrizes operacionais gerais, regras de segurança, autenticação e fluxos para ferramentas ACS.',
        category: 'Roteadores Técnicos (ACS)',
        tags: ['mcp', 'acs', 'router', 'como-usar', 'manual'],
        priority: 10,
        status: 'active',
        source: docSource,
        contextRole: 'policy',
        updatedAt: new Date().toISOString(),
      };
      if (docIndex >= 0) newDocs[docIndex] = doc;
      else newDocs.push(doc);
      syncedCount++;
    }

    // Next, each tool manual
    for (const tool of catalog.tools) {
      const toolManual = await fetchToolManualMarkdown(server, tool.name);
      const markdown = toolManual?.markdown || tool.summary;
      if (!markdown) continue;

      const docSource = `mcp_acs:${server.id}:${tool.name}`;
      const docIndex = newDocs.findIndex((d) => d.source === docSource);
      const doc: KnowledgeBaseDocument = {
        id: docIndex >= 0 ? newDocs[docIndex].id : randomUUID(),
        name: `Manual ACS: ${tool.title || tool.name}`,
        content: markdown,
        sourceFormat: 'markdown',
        summary: tool.summary,
        category: `ACS - ${tool.category || 'Roteadores'}`,
        tags: ['mcp', 'acs', 'router', tool.name],
        priority: 9,
        status: 'active',
        source: docSource,
        contextRole: 'procedure',
        updatedAt: new Date().toISOString(),
      };
      if (docIndex >= 0) newDocs[docIndex] = doc;
      else newDocs.push(doc);
      syncedCount++;
    }

    await db.query(
      'UPDATE autopilot_configs SET knowledge_base_documents = $1, updated_at = NOW() WHERE id = $2',
      [JSON.stringify(newDocs), configId]
    );

    revalidatePath('/autopilot');
    revalidatePath(`/autopilot/${configId}`);
    revalidatePath('/integrations/mcp');

    return { success: true, count: syncedCount };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Falha ao sincronizar manuais para a base de conhecimento.' };
  }
}

