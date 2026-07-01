import 'dotenv/config';

import { Pool, type PoolClient } from 'pg';

import { buildDeterministicFallbackProposal } from '@/ai/flows/autopilot-flow-builder';
import type { AutopilotConfigDraftSnapshot, AutopilotFlowGraph } from '@/lib/types';
import {
  listAgentToolCatalogItems,
  type AgentToolCatalogItem,
} from '@/services/agent-tools/catalog';
import { auditAutopilotFlowGraph, summarizeFlowAuditIssues } from '@/services/autopilot/flow-audit';
import { autoLayoutFlowNodes, findFlowLayoutOverlaps } from '@/services/autopilot/flow-layout';
import {
  analyzeAutopilotToolCoverage,
  summarizeAutopilotToolCoverageBlockers,
} from '@/services/autopilot/tool-coverage';
import { classifyMcpToolSafety, resolveMcpToolTimeoutMs } from '@/services/mcp/tool-safety';

const APPLY = process.argv.includes('--apply');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 15000,
});

function arrayValue(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function objectValue<T>(value: unknown, fallback: T): T {
  if (value && typeof value === 'object') return value as T;
  if (typeof value !== 'string') return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed as T : fallback;
  } catch {
    return fallback;
  }
}

function buildSnapshot(row: Record<string, any>): AutopilotConfigDraftSnapshot {
  return {
    name: String(row.name || ''),
    gemini_api_key: row.gemini_api_key || null,
    ai_model: row.ai_model || null,
    transcription_model: row.transcription_model || null,
    knowledge_base: row.knowledge_base || null,
    knowledge_base_documents: objectValue(row.knowledge_base_documents, []),
    knowledge_collections: objectValue(row.knowledge_collections, []),
    is_active: Boolean(row.is_active),
    is_private: Boolean(row.is_private),
    default_fallback_reply: row.default_fallback_reply || null,
    escalation_policy: row.escalation_policy || null,
    closing_policy: row.closing_policy || null,
    enabled_tool_names: arrayValue(row.enabled_tool_names),
    flow_graph: objectValue<AutopilotFlowGraph | null>(row.flow_graph, null),
  };
}

function normalizeText(value: unknown) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function isTechnicalSupportTool(tool: AgentToolCatalogItem) {
  const name = String(tool.name);
  if ([
    'sgp_fetch_contracts',
    'sgp_fetch_contact_panel_data',
    'transfer_chat',
    'close_chat',
    'add_internal_note',
    'crm_update_contact_custom_fields',
  ].includes(name)) {
    return true;
  }
  if (tool.source !== 'mcp') return false;
  const text = normalizeText([
    tool.name,
    tool.description,
    tool.inputSchema ? JSON.stringify(tool.inputSchema) : '',
  ].join(' '));
  if (tool.sideEffect === 'none' && tool.riskLevel === 'low') {
    return /\b(get_wifi_view|scan_wifi_neighbors|get_wifi_scan_cached|get_router|list_connected_devices|get_mesh_topology_cached|find_router_by_ip)\w*/.test(text);
  }
  return /\b(reboot_router|reiniciar roteador|change_wifi_credentials|update_wifi_credentials|trocar.*wifi|alterar.*wifi)\w*/.test(text);
}

async function loadWorkspaceCatalog(client: PoolClient, workspaceId: string) {
  const integration = await client.query(
    `SELECT config
       FROM workspace_integrations
      WHERE workspace_id = $1
        AND provider = 'mcp'
      LIMIT 1`,
    [workspaceId],
  );
  const config = objectValue<Record<string, any>>(integration.rows[0]?.config, {});
  const servers = Array.isArray(config.servers) ? config.servers : [];
  const mcpCatalog: AgentToolCatalogItem[] = servers.flatMap((server: any) => {
    if (server?.isActive !== true || !Array.isArray(server.tools)) return [];
    return server.tools.flatMap((tool: any): AgentToolCatalogItem[] => {
      const qualifiedName = String(tool?.qualifiedName || '').trim();
      if (!qualifiedName.startsWith('mcp:')) return [];
      const safety = classifyMcpToolSafety(qualifiedName, tool);
      return [{
        name: qualifiedName as AgentToolCatalogItem['name'],
        version: 'mcp',
        description: String(tool.description || tool.title || qualifiedName),
        class: safety.class,
        riskLevel: safety.riskLevel,
        sideEffect: safety.sideEffect,
        idempotent: safety.idempotent,
        timeoutMs: resolveMcpToolTimeoutMs(),
        maxAttempts: 1,
        requiresHumanApproval: safety.requiresHumanApproval,
        customerVisible: true,
        allowedIntents: [],
        requiredSlots: [],
        fallbackAction: 'handoff',
        source: 'mcp',
        enabledByDefault: false,
        serverId: String(server.id || ''),
        serverName: String(server.name || ''),
        inputSchema: tool.inputSchema || null,
        outputSchema: tool.outputSchema || null,
      }];
    });
  });
  return [...listAgentToolCatalogItems(), ...mcpCatalog];
}

function reachableTools(graph: AutopilotFlowGraph, routeId: string) {
  const decision = graph.nodes.find((node) => (
    node.kind === 'decision' && node.config?.routes?.some((route) => route.id === routeId)
  ));
  const target = decision?.config?.routes?.find((route) => route.id === routeId)?.targetNodeId;
  if (!target) return [];
  const visited = new Set<string>();
  const queue = [target];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const edge of graph.edges.filter((candidate) => candidate.source === current)) {
      if (!visited.has(edge.target)) queue.push(edge.target);
    }
  }
  return graph.nodes
    .filter((node) => visited.has(node.id) && node.kind === 'tool' && node.toolName)
    .map((node) => String(node.toolName));
}

function verifyWifiIsolation(graph: AutopilotFlowGraph) {
  const lookup = reachableTools(graph, 'consultar_wifi');
  const diagnostics = reachableTools(graph, 'diagnosticar_wifi');
  const change = reachableTools(graph, 'trocar_wifi');
  const reboot = reachableTools(graph, 'reiniciar_roteador');
  const has = (values: string[], pattern: RegExp) => values.some((value) => pattern.test(value));
  const errors: string[] = [];
  if (!has(lookup, /get_wifi_view/i)) errors.push('credential lookup route has no get_wifi_view capability');
  if (has(lookup, /reboot|change_wifi|update_wifi/i)) errors.push('credential lookup route reaches a mutating tool');
  if (!has(diagnostics, /scan|neighbor|channel|connected|router/i)) errors.push('diagnostic route has no network evidence tool');
  if (has(diagnostics, /reboot|change_wifi|update_wifi/i)) errors.push('diagnostic route reaches a mutating tool');
  if (!has(change, /change_wifi|update_wifi/i)) errors.push('credential change route has no specific change tool');
  if (has(change, /reboot/i)) errors.push('credential change route reaches reboot');
  if (!has(reboot, /reboot/i)) errors.push('reboot route has no reboot tool');
  if (has(reboot, /change_wifi|update_wifi/i)) errors.push('reboot route reaches credential change');
  return errors;
}

function toolLabel(toolName: string) {
  return toolName.startsWith('mcp:') ? `mcp:*:${toolName.split(':').at(-1)}` : toolName;
}

async function insertVersion(
  client: PoolClient,
  input: {
    configId: string;
    workspaceId: string;
    userId: string | null;
    versionNumber: number;
    label: string;
    snapshot: AutopilotConfigDraftSnapshot;
  },
) {
  await client.query(
    `INSERT INTO autopilot_config_versions
       (config_id, workspace_id, user_id, version_number, label, snapshot)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [
      input.configId,
      input.workspaceId,
      input.userId,
      input.versionNumber,
      input.label,
      JSON.stringify(input.snapshot),
    ],
  );
}

async function main() {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT *
         FROM autopilot_configs
        WHERE name ILIKE '%Lucas%'
          AND name ILIKE '%Suporte%'
        ORDER BY is_active DESC, updated_at DESC
        LIMIT 2`,
    );
    if (result.rowCount !== 1) {
      throw new Error(`Expected one Lucas technical support config, found ${result.rowCount || 0}.`);
    }
    const config = result.rows[0];
    const draftResult = await client.query(
      'SELECT snapshot FROM autopilot_config_drafts WHERE config_id = $1 LIMIT 1',
      [config.id],
    );
    const publishedSnapshot = buildSnapshot(config);
    const draftSnapshot = draftResult.rows[0]
      ? objectValue<AutopilotConfigDraftSnapshot | null>(draftResult.rows[0].snapshot, null)
      : null;
    const effectiveSnapshot = draftSnapshot || publishedSnapshot;
    const catalog = await loadWorkspaceCatalog(client, String(config.workspace_id));
    const persistedEnabled = new Set(effectiveSnapshot.enabled_tool_names || []);
    const selectedTools = catalog
      .filter((tool) => persistedEnabled.has(String(tool.name)))
      .filter(isTechnicalSupportTool);
    const capabilities = selectedTools.map((tool) => (
      `${tool.name}: ${tool.description} [risk=${tool.riskLevel}; sideEffect=${tool.sideEffect}]`
    )).join('\n');
    const request = [
      'Reconstrua o fluxo completo do Lucas, suporte tecnico TicketMaster.',
      'Separe obrigatoriamente consulta de credenciais Wi-Fi, diagnostico de canais/redes/dispositivos, troca de nome ou senha e reboot em branches independentes.',
      'Valide CPF/CNPJ/contrato antes de acessar a ONT.',
      'Use get_wifi_view para consulta de SSID/senha.',
      'Use scan/cache/get_router/dispositivos para diagnostico e responda com evidencia real.',
      'Troca de credenciais e reboot exigem pedido e confirmacao explicitos.',
      'Nunca altere nome, senha ou canal em testes.',
      'Inclua transferencia humana, nota interna, atualizacao de CRM e encerramento apenas nos momentos corretos.',
      'Ferramentas tecnicas habilitadas que devem ser avaliadas pelo nome real e descricao:',
      capabilities,
    ].join('\n');
    const proposal = buildDeterministicFallbackProposal({
      conversation: [{ role: 'user', content: request }],
      currentSystemPrompt: effectiveSnapshot.knowledge_base || '',
      tools: selectedTools,
    }, new Error('deterministic production repair'));
    proposal.flowGraph.nodes = autoLayoutFlowNodes(
      proposal.flowGraph.nodes,
      proposal.flowGraph.edges,
    );

    const audit = auditAutopilotFlowGraph(proposal.flowGraph);
    const coverage = analyzeAutopilotToolCoverage({
      graph: proposal.flowGraph,
      enabledToolNames: proposal.enabledToolNames,
      toolCatalog: selectedTools,
    });
    const overlaps = findFlowLayoutOverlaps(proposal.flowGraph.nodes);
    const isolationErrors = verifyWifiIsolation(proposal.flowGraph);
    const invalidMcpNames = proposal.enabledToolNames.filter((toolName) => (
      toolName === 'mcp_call_tool' || (toolName.startsWith('mcp:') && toolName.split(':').length < 3)
    ));
    const danglingTools = proposal.flowGraph.nodes
      .filter((node) => (
        node.kind === 'tool'
        && !proposal.flowGraph.edges.some((edge) => edge.source === node.id)
      ))
      .map((node) => ({
        id: node.id,
        title: node.title,
        tool: toolLabel(String(node.toolName || node.title)),
        incoming: proposal.flowGraph.edges
          .filter((edge) => edge.target === node.id)
          .map((edge) => edge.source),
      }));
    const blockers = [
      ...(audit.status === 'failed' ? [summarizeFlowAuditIssues(audit.issues) || 'flow audit failed'] : []),
      ...(coverage.status === 'branch_required' ? [summarizeAutopilotToolCoverageBlockers(coverage)] : []),
      ...(overlaps.length > 0 ? [`layout has ${overlaps.length} overlap(s)`] : []),
      ...isolationErrors,
      ...(invalidMcpNames.length > 0 ? ['proposal contains an unqualified MCP tool name'] : []),
    ].filter(Boolean);

    console.log(JSON.stringify({
      mode: APPLY ? 'apply' : 'dry-run',
      agent: 'Lucas Suporte Tecnico',
      source: draftSnapshot ? 'draft' : 'published',
      previous: {
        enabledTools: effectiveSnapshot.enabled_tool_names.length,
        nodes: effectiveSnapshot.flow_graph?.nodes.length || 0,
        edges: effectiveSnapshot.flow_graph?.edges.length || 0,
      },
      proposal: {
        enabledTools: proposal.enabledToolNames.map(toolLabel),
        nodes: proposal.flowGraph.nodes.length,
        edges: proposal.flowGraph.edges.length,
        audit: audit.status,
        coverage: coverage.status,
        overlaps: overlaps.length,
        isolatedWifiBranches: isolationErrors.length === 0,
        danglingTools,
      },
      excludedPreviouslyEnabledTools: effectiveSnapshot.enabled_tool_names
        .filter((toolName) => !proposal.enabledToolNames.includes(toolName))
        .map(toolLabel),
      blockers,
    }, null, 2));

    if (blockers.length > 0) {
      throw new Error(`Repair proposal rejected by ${blockers.length} gate(s).`);
    }
    if (!APPLY) return;

    await client.query('BEGIN');
    try {
      const locked = await client.query(
        'SELECT * FROM autopilot_configs WHERE id = $1 FOR UPDATE',
        [config.id],
      );
      if (locked.rowCount !== 1) throw new Error('Lucas config disappeared during apply.');
      const nextVersionResult = await client.query(
        `SELECT COALESCE(MAX(version_number), 0) + 1 AS next_version
           FROM autopilot_config_versions
          WHERE config_id = $1`,
        [config.id],
      );
      let nextVersion = Number(nextVersionResult.rows[0]?.next_version || 1);
      await insertVersion(client, {
        configId: String(config.id),
        workspaceId: String(config.workspace_id),
        userId: config.user_id ? String(config.user_id) : null,
        versionNumber: nextVersion++,
        label: 'Backup automatico antes do reparo MCP-aware',
        snapshot: publishedSnapshot,
      });
      if (draftSnapshot) {
        await insertVersion(client, {
          configId: String(config.id),
          workspaceId: String(config.workspace_id),
          userId: config.user_id ? String(config.user_id) : null,
          versionNumber: nextVersion++,
          label: 'Backup do rascunho antes do reparo MCP-aware',
          snapshot: draftSnapshot,
        });
      }
      const nextSnapshot: AutopilotConfigDraftSnapshot = {
        ...effectiveSnapshot,
        knowledge_base: proposal.systemPrompt,
        enabled_tool_names: proposal.enabledToolNames,
        flow_graph: proposal.flowGraph,
      };
      await client.query(
        `UPDATE autopilot_configs
            SET knowledge_base = $2,
                enabled_tool_names = $3::jsonb,
                flow_graph = $4::jsonb,
                updated_at = timezone('utc', now())
          WHERE id = $1`,
        [
          config.id,
          nextSnapshot.knowledge_base,
          JSON.stringify(nextSnapshot.enabled_tool_names),
          JSON.stringify(nextSnapshot.flow_graph),
        ],
      );
      await client.query('DELETE FROM autopilot_config_drafts WHERE config_id = $1', [config.id]);
      await insertVersion(client, {
        configId: String(config.id),
        workspaceId: String(config.workspace_id),
        userId: config.user_id ? String(config.user_id) : null,
        versionNumber: nextVersion,
        label: 'Flow MCP-aware com branches Wi-Fi isolados',
        snapshot: nextSnapshot,
      });
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
    console.log(JSON.stringify({ applied: true, agent: 'Lucas Suporte Tecnico' }));
  } finally {
    client.release();
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
