import 'dotenv/config';

import { Pool } from 'pg';
import type { AgentToolCatalogItem } from '@/services/agent-tools/catalog';
import { listAgentToolCatalogItems } from '@/services/agent-tools/catalog';
import { analyzeAutopilotToolCoverage } from '@/services/autopilot/tool-coverage';
import { classifyMcpToolSafety } from '@/services/mcp/tool-safety';

const chatIds = process.argv.slice(2).map((value) => value.trim()).filter(Boolean);
if (chatIds.length === 0) {
  throw new Error('Usage: npm run inspect:autopilot:chat -- <chat-id> [chat-id...]');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 15000,
});

function redactPreview(value: unknown): string {
  return String(value || '')
    .replace(/\b\d{11,14}\b/g, '[documento]')
    .replace(/\b\d{10,13}\b/g, '[telefone]')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[ip]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
}

function requestedToolName(input: unknown, fallback: unknown): string {
  const action = input && typeof input === 'object' ? input as any : {};
  return action.type === 'mcp_call_tool'
    ? String(action.payload?.toolName || fallback || '')
    : String(action.type || fallback || '');
}

async function inspectChat(chatId: string) {
  const chatResult = await pool.query(
    `SELECT c.id, c.workspace_id, c.status, c.copilot_mode,
            c.is_autopilot_active, c.autopilot_config_id,
            c.assigned_system_agent_id, c.source, c.instance_type,
            sa.name AS system_agent_name,
            ac.name AS config_name, ac.ai_model, ac.tool_mode,
            ac.enabled_tool_names, ac.flow_graph
       FROM chats c
       LEFT JOIN system_agents sa ON sa.id = c.assigned_system_agent_id
       LEFT JOIN autopilot_configs ac ON ac.id = COALESCE(c.autopilot_config_id, sa.autopilot_config_id)
      WHERE c.id = $1
      LIMIT 1`,
    [chatId],
  );
  const chat = chatResult.rows[0];
  if (!chat) return { chatId, found: false };

  const enabledToolNames = Array.isArray(chat.enabled_tool_names) ? chat.enabled_tool_names.map(String) : [];
  const flowGraph = chat.flow_graph && typeof chat.flow_graph === 'object' ? chat.flow_graph : null;
  const mcpResult = await pool.query(
    `SELECT config
       FROM workspace_integrations
      WHERE workspace_id = $1
        AND provider = 'mcp'
      LIMIT 1`,
    [chat.workspace_id],
  );
  const servers = Array.isArray(mcpResult.rows[0]?.config?.servers)
    ? mcpResult.rows[0].config.servers
    : [];
  const enabledMcpConfigs = servers.flatMap((server: any) => (
    Array.isArray(server.tools)
      ? server.tools.map((tool: any) => ({ server, tool }))
      : []
  )).filter(({ tool }: any) => enabledToolNames.includes(String(tool.qualifiedName || '')));
  const mcpCatalogItems: AgentToolCatalogItem[] = enabledMcpConfigs.map(({ server, tool }: any) => {
    const qualifiedName = String(tool.qualifiedName || '');
    const safety = classifyMcpToolSafety(qualifiedName, tool);
    return {
      name: qualifiedName as any,
      version: 'mcp',
      description: String(tool.description || tool.title || qualifiedName),
      class: safety.class,
      riskLevel: safety.riskLevel,
      sideEffect: safety.sideEffect,
      idempotent: safety.idempotent,
      timeoutMs: 8000,
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
    };
  });
  const toolCatalog = [
    ...listAgentToolCatalogItems().filter((tool) => enabledToolNames.includes(String(tool.name))),
    ...mcpCatalogItems,
  ];
  const toolCoverage = analyzeAutopilotToolCoverage({
    graph: flowGraph,
    enabledToolNames,
    toolCatalog,
  });
  const mcpTools = enabledMcpConfigs.map(({ server, tool }: any) => {
    const qualifiedName = String(tool.qualifiedName || '');
    const safety = classifyMcpToolSafety(qualifiedName, tool);
    return {
      qualifiedName,
      serverId: String(server.id || ''),
      serverName: String(server.name || ''),
      active: server.isActive === true,
      description: redactPreview(tool.description || tool.title),
      riskLevel: safety.riskLevel,
      sideEffect: safety.sideEffect,
      safetyInferredFrom: safety.inferredFrom,
      requiredFields: Array.isArray(tool.inputSchema?.required)
        ? tool.inputSchema.required.map(String)
        : [],
    };
  });

  const messages = await pool.query(
    `SELECT content, from_me, created_at
       FROM messages
      WHERE workspace_id = $1
        AND chat_id = $2
        AND COALESCE(api_message_status, '') <> 'internal'
      ORDER BY created_at DESC
      LIMIT 12`,
    [chat.workspace_id, chatId],
  );
  const toolExecutions = await pool.query(
    `SELECT tool_name, status, input, error, created_at
       FROM agent_tool_executions
      WHERE workspace_id = $1
        AND chat_id = $2
      ORDER BY created_at DESC
      LIMIT 20`,
    [chat.workspace_id, chatId],
  );
  const runs = await pool.query(
    `SELECT id, status, intent, confidence_score, metadata, timings, created_at
       FROM orchestrator_runs
      WHERE workspace_id = $1
        AND chat_id = $2
      ORDER BY created_at DESC
      LIMIT 10`,
    [chat.workspace_id, chatId],
  );

  return {
    chatId,
    found: true,
    workspaceId: chat.workspace_id,
    agent: {
      id: chat.assigned_system_agent_id,
      name: chat.system_agent_name,
      configId: chat.autopilot_config_id,
      configName: chat.config_name,
      model: chat.ai_model,
      toolMode: chat.tool_mode,
      active: chat.is_autopilot_active,
      copilotMode: chat.copilot_mode,
    },
    channel: {
      source: chat.source,
      instanceType: chat.instance_type,
      status: chat.status,
    },
    enabledToolNames,
    enabledMcpTools: mcpTools,
    flow: flowGraph ? {
      nodeCount: Array.isArray(flowGraph.nodes) ? flowGraph.nodes.length : 0,
      edgeCount: Array.isArray(flowGraph.edges) ? flowGraph.edges.length : 0,
      toolCoverage,
      nodes: Array.isArray(flowGraph.nodes)
        ? flowGraph.nodes.map((node: any) => ({
            id: node.id,
            kind: node.kind,
            title: node.title,
            toolName: node.toolName || null,
          }))
        : [],
    } : null,
    recentMessages: messages.rows.reverse().map((message) => ({
      role: message.from_me ? 'agent' : 'customer',
      preview: redactPreview(message.content),
      createdAt: message.created_at,
    })),
    recentToolExecutions: toolExecutions.rows.map((execution) => ({
      toolName: requestedToolName(execution.input, execution.tool_name),
      auditedToolName: execution.tool_name,
      status: execution.status,
      error: redactPreview(execution.error),
      createdAt: execution.created_at,
    })),
    recentRuns: runs.rows.map((run) => ({
      id: run.id,
      status: run.status,
      intent: run.intent,
      confidence: run.confidence_score,
      fallbackReason: run.metadata?.fallbackReason || null,
      turnPlan: run.metadata?.turnPlan || null,
      timings: run.timings,
      createdAt: run.created_at,
    })),
  };
}

async function main() {
  const results = [];
  for (const chatId of chatIds) results.push(await inspectChat(chatId));
  console.log(JSON.stringify(results, null, 2));
  await pool.end();
}

main().catch(async (error) => {
  console.error(error);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
