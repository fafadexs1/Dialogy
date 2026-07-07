// Runs a fully persisted, isolated autopilot conversation against a real local MCP stdio server.
import module from 'node:module';
const originalRequire = module.prototype.require;
module.prototype.require = function patchedRequire(id) {
  if (id === 'server-only') return {};
  return originalRequire.call(this, id);
};

import 'dotenv/config';

import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';

import { Pool, type PoolClient } from 'pg';

process.env.AI_ORCHESTRATOR_RAG_TIMEOUT_MS ||= '2500';
process.env.AI_INTENT_CLASSIFIER_TIMEOUT_MS ||= '2500';
process.env.AI_WORKFLOW_CLASSIFIER_TIMEOUT_MS ||= '2500';
process.env.AI_ORCHESTRATOR_LLM_TIMEOUT_MS ||= '6000';
process.env.EVOLUTION_API_TIMEOUT_MS = '1000';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error('DATABASE_URL is required for the autopilot conversation canary.');

const pool = new Pool({
  connectionString: DATABASE_URL,
  connectionTimeoutMillis: 15000,
});

const KEEP_DATA = process.env.AUTOPILOT_CANARY_KEEP_DATA === 'true';
const RUN_LABEL = `autopilot-canary-${Date.now()}`;
process.env.QUEUE_MODE = 'enqueue';
process.env.BULLMQ_PREFIX = RUN_LABEL;
process.env.QUEUE_ENABLED_JOBS = [
  'evolution_webhook_process',
  'whatsapp_send',
  'webhook_outbound',
  'queue_auto_close',
  'marketing_auto_close',
  'ai_document_ingest',
  'ai_autopilot_process',
  'ai_autopilot_learning_cycle',
  'ai_case_memory_refresh',
].join(',');
const workspaceRoot = resolve(process.cwd());
const mcpServerPath = resolve(workspaceRoot, 'scripts/fixtures/autopilot-canary-mcp-server.mjs');
const mcpLogPath = resolve(tmpdir(), `${RUN_LABEL}-mcp.jsonl`);

const ids = {
  user: randomUUID(),
  workspace: randomUUID(),
  config: randomUUID(),
  agent: randomUUID(),
  contact: randomUUID(),
  chat: randomUUID(),
  cluster: randomUUID(),
  instance: randomUUID(),
};
const instanceName = `${RUN_LABEL}-fake-whatsapp`;
const providerRequests: Array<{
  path: string;
  body: Record<string, unknown>;
  statusCode: number;
}> = [];
let providerExplicitFailuresRemaining = 0;
let providerUncertainFailuresRemaining = 0;
const providerServer = createServer(async (request, response) => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const rawBody = Buffer.concat(chunks).toString('utf8');
  let body: Record<string, unknown> = {};
  try {
    body = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    body = {};
  }
  const statusCode = providerUncertainFailuresRemaining > 0
    ? 0
    : providerExplicitFailuresRemaining > 0
      ? 503
      : 200;
  if (providerUncertainFailuresRemaining > 0) {
    providerUncertainFailuresRemaining -= 1;
  }
  if (providerExplicitFailuresRemaining > 0) {
    providerExplicitFailuresRemaining -= 1;
  }
  providerRequests.push({
    path: request.url || '',
    body,
    statusCode,
  });
  if (statusCode === 0) {
    request.socket.destroy();
    return;
  }
  response.writeHead(statusCode, { 'Content-Type': 'application/json' });
  response.end(statusCode === 200
    ? JSON.stringify({
        key: { id: `provider-${providerRequests.length}` },
        status: 'PENDING',
      })
    : JSON.stringify({ error: 'canary transient provider failure' }));
});
let providerBaseUrl = '';

const qualifiedTools = {
  listProducts: 'mcp:canary:list_products',
  getOrderStatus: 'mcp:canary:get_order_status',
  schedulePickup: 'mcp:canary:schedule_pickup',
  cancelOrder: 'mcp:canary:cancel_order',
} as const;

const mcpTools = [
  {
    qualifiedName: qualifiedTools.listProducts,
    serverId: 'canary',
    serverName: 'Autopilot Canary MCP',
    name: 'list_products',
    title: 'Listar produtos',
    description: 'Lista produtos, planos, precos e disponibilidade do catalogo.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Filtro opcional do catalogo' },
      },
    },
    outputSchema: null,
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  },
  {
    qualifiedName: qualifiedTools.getOrderStatus,
    serverId: 'canary',
    serverName: 'Autopilot Canary MCP',
    name: 'get_order_status',
    title: 'Consultar pedido',
    description: 'Consulta o status de um pedido sem altera-lo.',
    inputSchema: {
      type: 'object',
      required: ['order_id'],
      properties: {
        order_id: { type: 'string', description: 'Numero do pedido' },
      },
    },
    outputSchema: null,
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  },
  {
    qualifiedName: qualifiedTools.schedulePickup,
    serverId: 'canary',
    serverName: 'Autopilot Canary MCP',
    name: 'schedule_pickup',
    title: 'Agendar coleta',
    description: 'Agenda uma coleta logistica usando codigo do pacote e janela de coleta.',
    inputSchema: {
      type: 'object',
      required: ['package_code', 'pickup_window'],
      properties: {
        package_code: { type: 'string', description: 'codigo do pacote' },
        pickup_window: { type: 'string', description: 'janela desejada para a coleta' },
      },
    },
    outputSchema: null,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  {
    qualifiedName: qualifiedTools.cancelOrder,
    serverId: 'canary',
    serverName: 'Autopilot Canary MCP',
    name: 'cancel_order',
    title: 'Cancelar pedido',
    description: 'Cancela definitivamente um pedido pelo numero informado.',
    inputSchema: {
      type: 'object',
      required: ['order_id'],
      properties: {
        order_id: { type: 'string', description: 'Numero do pedido' },
      },
    },
    outputSchema: null,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
];

const flowGraph = {
  version: 1,
  nodes: [
    {
      id: 'start',
      kind: 'start',
      title: 'Mensagem recebida',
      subtitle: 'Inicio',
      position: { x: 0, y: 0 },
    },
    {
      id: 'agent',
      kind: 'sub_agent',
      title: 'Agente Canary',
      subtitle: 'Atendimento principal',
      position: { x: 180, y: 0 },
      config: {
        useAi: true,
        instructions: 'Atenda usando somente ferramentas habilitadas e resultados comprovados.',
      },
    },
    ...mcpTools.map((tool, index) => ({
      id: `tool-${tool.name}`,
      kind: 'tool',
      title: tool.title,
      subtitle: 'MCP local',
      position: { x: 420, y: index * 120 - 180 },
      toolName: tool.qualifiedName,
      risk: tool.annotations.destructiveHint ? 'high' : 'low',
      config: {
        instructions: tool.description,
        inputSchema: tool.inputSchema,
      },
    })),
  ],
  edges: [
    { id: 'start-agent', source: 'start', target: 'agent' },
    ...mcpTools.map((tool) => ({
      id: `agent-${tool.name}`,
      source: 'agent',
      target: `tool-${tool.name}`,
    })),
  ],
};

type McpLogEntry = {
  at: string;
  toolName: string;
  args: Record<string, unknown>;
};

type TurnExpectation = {
  responseIncludes: string[];
  responseExcludes?: string[];
  expectedMcpCalls?: string[];
  expectedAudit?: Array<{ toolName: string; status: 'success' | 'error' | 'rejected' }>;
  pendingToolName?: string | null;
};

const turns: Array<{ message: string; expect: TurnExpectation }> = [
  {
    message: 'Quais produtos tem com preco e disponibilidade?',
    expect: {
      responseIncludes: ['Plano Canary Pro', 'R$ 129,90'],
      responseExcludes: ['{"', 'structuredContent'],
      expectedMcpCalls: ['list_products'],
      expectedAudit: [{ toolName: qualifiedTools.listProducts, status: 'success' }],
      pendingToolName: null,
    },
  },
  {
    message: 'Qual o status do pedido AB1234?',
    expect: {
      responseIncludes: ['AB1234', 'em separacao'],
      responseExcludes: ['{"', 'structuredContent'],
      expectedMcpCalls: ['get_order_status'],
      expectedAudit: [{ toolName: qualifiedTools.getOrderStatus, status: 'success' }],
      pendingToolName: null,
    },
  },
  {
    message: 'Quero agendar uma coleta logistica',
    expect: {
      responseIncludes: ['package_code', 'pickup_window', 'campo: valor'],
      expectedMcpCalls: [],
      expectedAudit: [],
      pendingToolName: null,
    },
  },
  {
    message: 'package_code: CX-77; pickup_window: 14h as 18h',
    expect: {
      responseIncludes: ['confirmacao explicita', 'CX-77'],
      expectedMcpCalls: [],
      expectedAudit: [{ toolName: qualifiedTools.schedulePickup, status: 'rejected' }],
      pendingToolName: qualifiedTools.schedulePickup,
    },
  },
  {
    message: 'Confirmo',
    expect: {
      responseIncludes: ['coleta agendada', 'CX-77', 'CANARY-CX-77'],
      responseExcludes: ['{"', 'structuredContent'],
      expectedMcpCalls: ['schedule_pickup'],
      expectedAudit: [{ toolName: qualifiedTools.schedulePickup, status: 'success' }],
      pendingToolName: null,
    },
  },
  {
    message: 'Cancele o pedido AB1234',
    expect: {
      responseIncludes: ['confirmacao explicita', 'AB1234'],
      expectedMcpCalls: [],
      expectedAudit: [{ toolName: qualifiedTools.cancelOrder, status: 'rejected' }],
      pendingToolName: qualifiedTools.cancelOrder,
    },
  },
  {
    message: 'Melhor nao',
    expect: {
      responseIncludes: ['acao pendente foi cancelada', 'nao sera executada'],
      expectedMcpCalls: [],
      expectedAudit: [],
      pendingToolName: null,
    },
  },
  {
    message: 'Sim',
    expect: {
      responseIncludes: ['nao vou repeti'],
      expectedMcpCalls: [],
      expectedAudit: [],
      pendingToolName: null,
    },
  },
];

function normalize(value: unknown) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function readMcpLog(): McpLogEntry[] {
  if (!existsSync(mcpLogPath)) return [];
  return readFileSync(mcpLogPath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as McpLogEntry);
}

function pendingRequestedToolName(pending: any): string | null {
  const action = pending?.action;
  if (!action) return null;
  return action.type === 'mcp_call_tool'
    ? String(action.payload?.toolName || '')
    : String(action.type || '');
}

async function deleteSandboxData(client: PoolClient) {
  const workspaceTables = [
    'autopilot_chat_leases',
    'autopilot_tool_execution_claims',
    'orchestrator_tool_calls',
    'resource_mapping_ledger',
    'agent_decision_ledger',
    'orchestrator_events',
    'orchestrator_runs',
    'agent_procedure_sessions',
    'agent_procedure_definitions',
    'agent_tool_executions',
    'chat_case_memories',
    'autopilot_usage_logs',
    'rag_retrieval_logs',
    'autopilot_conversation_states',
    'procedure_executions',
    'messages',
    'chats',
    'contacts',
    'system_agents',
    'autopilot_rules',
    'autopilot_configs',
    'user_workspace_roles',
    'roles',
    'workspace_integrations',
    'evolution_api_instances',
  ];

  await client.query('UPDATE users SET last_active_workspace_id = NULL WHERE id = $1', [ids.user]);
  for (const table of workspaceTables) {
    try {
      await client.query(`DELETE FROM ${table} WHERE workspace_id = $1`, [ids.workspace]);
    } catch (error: any) {
      if (error?.code !== '42P01' && error?.code !== '42703') throw error;
    }
  }
  await client.query('DELETE FROM workspaces WHERE id = $1', [ids.workspace]);
  await client.query('DELETE FROM whatsapp_clusters WHERE id = $1', [ids.cluster]);
  await client.query('DELETE FROM users WHERE id = $1', [ids.user]);
}

async function seedSandbox(client: PoolClient) {
  writeFileSync(mcpLogPath, '', 'utf8');

  await client.query(
    `INSERT INTO users (id, full_name, email, avatar_url, is_superadmin)
     VALUES ($1, 'Autopilot Canary User', $2, '', false)`,
    [ids.user, `${RUN_LABEL}@example.invalid`],
  );
  await client.query(
    `INSERT INTO workspaces (id, name, owner_id)
     VALUES ($1, $2, $3)`,
    [ids.workspace, `Autopilot Canary ${RUN_LABEL}`, ids.user],
  );
  await client.query(
    'UPDATE users SET last_active_workspace_id = $1 WHERE id = $2',
    [ids.workspace, ids.user],
  );
  const role = await client.query(
    `INSERT INTO roles (workspace_id, name, description, is_default)
     VALUES ($1, 'Owner', 'Autopilot canary owner', true)
     RETURNING id`,
    [ids.workspace],
  );
  await client.query(
    `INSERT INTO user_workspace_roles (user_id, workspace_id, role_id)
     VALUES ($1, $2, $3)`,
    [ids.user, ids.workspace, role.rows[0].id],
  );
  await client.query(
    `INSERT INTO whatsapp_clusters (id, name, api_url, api_key, is_active)
     VALUES ($1, $2, $3, $4, true)`,
    [
      ids.cluster,
      `Autopilot Canary Provider ${RUN_LABEL}`,
      providerBaseUrl,
      `canary-api-key-${RUN_LABEL}`,
    ],
  );
  await client.query(
    `INSERT INTO evolution_api_instances (
       id, workspace_id, cluster_id, instance_name, webhook_key,
       display_name, type, webhook_url
     ) VALUES ($1, $2, $3, $4, $5, $6, 'baileys', $7)`,
    [
      ids.instance,
      ids.workspace,
      ids.cluster,
      instanceName,
      `canary-webhook-${RUN_LABEL}`,
      'Autopilot Canary WhatsApp',
      'https://example.invalid/canary',
    ],
  );

  const mcpConfig = {
    servers: [{
      id: 'canary',
      name: 'Autopilot Canary MCP',
      transport: 'stdio',
      command: process.execPath,
      args: [mcpServerPath],
      env: {
        AUTOPILOT_CANARY_MCP_LOG_PATH: mcpLogPath,
      },
      cwd: workspaceRoot,
      isActive: true,
      syncedAt: new Date().toISOString(),
      lastError: null,
      tools: mcpTools,
    }],
  };
  await client.query(
    `INSERT INTO workspace_integrations (workspace_id, provider, config, is_active, updated_at)
     VALUES ($1, 'mcp', $2::jsonb, true, NOW())`,
    [ids.workspace, JSON.stringify(mcpConfig)],
  );

  const model = process.env.AUTOPILOT_CANARY_MODEL
    || process.env.AI_DEFAULT_MODEL
    || 'googleai/gemini-2.5-flash-lite';
  await client.query(
    `INSERT INTO autopilot_configs (
       id, workspace_id, user_id, name, ai_model, knowledge_base,
       knowledge_base_documents, is_primary, is_active, is_private,
       default_fallback_reply, enabled_tool_names, flow_graph,
       knowledge_collections, tool_mode
     ) VALUES (
       $1, $2, $3, 'Autopilot Conversation Canary', $4,
       'Canary sintetico. Use somente resultados reais das tools.', '[]'::jsonb,
       true, true, false, 'Nao consegui concluir automaticamente.',
       $5::jsonb, $6::jsonb, '[]'::jsonb, 'on_demand'
     )`,
    [
      ids.config,
      ids.workspace,
      ids.user,
      model,
      JSON.stringify(Object.values(qualifiedTools)),
      JSON.stringify(flowGraph),
    ],
  );
  await client.query(
    `INSERT INTO system_agents (
       id, workspace_id, name, token, is_active, created_by_id, type,
       hide_from_chatlist, autopilot_config_id
     ) VALUES ($1, $2, 'Autopilot Canary IA', $3, true, $4,
       'intelligent_attendant', false, $5)`,
    [ids.agent, ids.workspace, `canary-token-${RUN_LABEL}`, ids.user, ids.config],
  );
  await client.query(
    `INSERT INTO contacts (id, workspace_id, name, phone, phone_number_jid)
     VALUES ($1, $2, 'Cliente Canary', '5500000000000', '5500000000000@s.whatsapp.net')`,
    [ids.contact, ids.workspace],
  );
  await client.query(
    `INSERT INTO chats (
       id, workspace_id, contact_id, status, is_autopilot_active,
       autopilot_config_id, copilot_mode, assigned_system_agent_id,
       source, instance_type, unread_count
     ) VALUES ($1, $2, $3, 'atendimentos', true, $4, 'auto', $5,
       'whatsapp', 'baileys', 0)`,
    [ids.chat, ids.workspace, ids.contact, ids.config, ids.agent],
  );
}

async function loadChat(client: PoolClient) {
  const { rows } = await client.query(
    `SELECT c.*, ct.name AS contact_name, ct.email AS contact_email,
            ct.phone_number_jid, ct.avatar_url, ct.address
       FROM chats c
       JOIN contacts ct ON ct.id = c.contact_id
      WHERE c.id = $1
      LIMIT 1`,
    [ids.chat],
  );
  const row = rows[0];
  if (!row) throw new Error('Canary chat disappeared.');
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    status: row.status,
    source: row.source,
    instance_type: row.instance_type,
    agentId: row.agent_id,
    assigned_system_agent_id: row.assigned_system_agent_id,
    is_autopilot_active: row.is_autopilot_active,
    autopilot_config_id: row.autopilot_config_id,
    copilot_mode: row.copilot_mode,
    messages: [],
    contact: {
      id: ids.contact,
      name: row.contact_name,
      email: row.contact_email || '',
      phone_number_jid: row.phone_number_jid,
      avatar_url: row.avatar_url || '',
      address: row.address || '',
    },
  };
}

async function runTurn(
  client: PoolClient,
  turnIndex: number,
  message: string,
  expectation: TurnExpectation,
) {
  const beforeMcpLog = readMcpLog();
  const inboundId = randomUUID();
  const inbound = await client.query(
    `INSERT INTO messages (
       id, workspace_id, chat_id, type, content, from_me, is_read,
       instance_name, raw_payload, metadata, created_at
     ) VALUES ($1, $2, $3, 'text', $4, false, true, $5,
       '{}'::jsonb, '{}'::jsonb, clock_timestamp())
     RETURNING created_at`,
    [inboundId, ids.workspace, ids.chat, message, instanceName],
  );
  const startedAt = inbound.rows[0].created_at;
  const chat = await loadChat(client);
  const { processAutopilotForChat } = await import('../src/services/autopilot-service');
  await processAutopilotForChat(
    ids.workspace,
    chat as any,
    message,
    instanceName,
    inboundId,
  );

  const response = await client.query(
    `SELECT id, content, api_message_status, metadata, created_at
       FROM messages
      WHERE workspace_id = $1
        AND chat_id = $2
        AND from_me = true
        AND sender_system_agent_id = $3
        AND created_at >= $4
        AND COALESCE(api_message_status, '') <> 'internal'
      ORDER BY created_at DESC
      LIMIT 1`,
    [ids.workspace, ids.chat, ids.agent, startedAt],
  );
  const responseRow = response.rows[0];
  if (!responseRow) throw new Error(`Turn ${turnIndex + 1} produced no customer-visible response.`);

  const audit = await client.query(
    `SELECT tool_name, status, input, error
       FROM agent_tool_executions
      WHERE workspace_id = $1
        AND chat_id = $2
        AND created_at >= $3
      ORDER BY created_at ASC`,
    [ids.workspace, ids.chat, startedAt],
  );
  const state = await client.query(
    `SELECT pending_confirmation
       FROM autopilot_conversation_states
      WHERE chat_id = $1
      LIMIT 1`,
    [ids.chat],
  );
  const events = await client.query(
    `SELECT kind, status
       FROM orchestrator_events
      WHERE workspace_id = $1
        AND chat_id = $2
        AND created_at >= $3
      ORDER BY created_at ASC`,
    [ids.workspace, ids.chat, startedAt],
  );
  const deliveries = await client.query(
    `SELECT id, delivery_key, status, next_block_index, jsonb_array_length(blocks) AS block_count
       FROM autopilot_response_deliveries
      WHERE workspace_id = $1
        AND chat_id = $2
        AND source_message_id = $3
        AND delivery_key = 'primary'
      ORDER BY created_at ASC`,
    [ids.workspace, ids.chat, inboundId],
  );

  const afterMcpLog = readMcpLog();
  const mcpCalls = afterMcpLog.slice(beforeMcpLog.length);
  const actualMcpToolNames = mcpCalls.map((entry) => entry.toolName);
  const expectedMcpToolNames = expectation.expectedMcpCalls || [];
  const actualAudit = audit.rows.map((row) => ({
    toolName: String(row.tool_name),
    status: String(row.status),
  }));
  const expectedAudit = expectation.expectedAudit || [];
  const pendingToolName = pendingRequestedToolName(state.rows[0]?.pending_confirmation);
  const responseText = String(responseRow.content || '');

  const failures: string[] = [];
  for (const requiredText of expectation.responseIncludes) {
    if (!normalize(responseText).includes(normalize(requiredText))) {
      failures.push(`response_missing:${requiredText}`);
    }
  }
  for (const forbiddenText of expectation.responseExcludes || []) {
    if (normalize(responseText).includes(normalize(forbiddenText))) {
      failures.push(`response_forbidden:${forbiddenText}`);
    }
  }
  if (JSON.stringify(actualMcpToolNames) !== JSON.stringify(expectedMcpToolNames)) {
    failures.push(`mcp_calls:${JSON.stringify(actualMcpToolNames)}!=${JSON.stringify(expectedMcpToolNames)}`);
  }
  if (JSON.stringify(actualAudit) !== JSON.stringify(expectedAudit)) {
    failures.push(`tool_audit:${JSON.stringify(actualAudit)}!=${JSON.stringify(expectedAudit)}`);
  }
  if (pendingToolName !== (expectation.pendingToolName ?? null)) {
    failures.push(`pending_tool:${pendingToolName}!=${expectation.pendingToolName ?? null}`);
  }
  if (mcpCalls.some((entry) => entry.toolName === 'cancel_order')) {
    failures.push('destructive_mcp_call:cancel_order');
  }
  const unnecessaryGateEvents = events.rows.filter((event) => (
    event.kind === 'intent_classifier_ai' ||
    event.kind === 'close_intent_gate' ||
    (event.kind === 'rag_retrieval' && event.status !== 'skipped')
  ));
  if (unnecessaryGateEvents.length > 0) {
    failures.push(`unnecessary_gate_events:${JSON.stringify(unnecessaryGateEvents)}`);
  }
  const primaryDelivery = deliveries.rows[0];
  if (
    deliveries.rows.length !== 1
    || primaryDelivery?.status !== 'sent'
    || Number(primaryDelivery?.next_block_index) !== Number(primaryDelivery?.block_count)
    || responseRow.metadata?.autopilotResponseDeliveryId !== primaryDelivery?.id
    || responseRow.metadata?.autopilotSourceMessageId !== inboundId
  ) {
    failures.push(`response_delivery:${JSON.stringify(deliveries.rows)}`);
  }

  const trace = {
    turn: turnIndex + 1,
    customerMessage: message,
    responsePreview: responseText.slice(0, 220),
    responseStatus: responseRow.api_message_status || null,
    toolAudit: actualAudit,
    mcpCalls,
    gateEvents: events.rows.filter((event) => (
      event.kind === 'intent_classifier_ai' ||
      event.kind === 'close_intent_gate' ||
      event.kind === 'rag_retrieval'
    )),
    pendingToolName,
    responseDelivery: primaryDelivery || null,
    passed: failures.length === 0,
    failures,
  };
  console.log(JSON.stringify(trace, null, 2));
  if (failures.length > 0) {
    throw new Error(`Canary turn ${turnIndex + 1} failed: ${failures.join(', ')}`);
  }
  return trace;
}

async function runConcurrentDuplicateProbe(client: PoolClient) {
  const beforeMcpLog = readMcpLog();
  const inboundId = randomUUID();
  const message = 'Qual o status do pedido RACE-9001?';
  const inbound = await client.query(
    `INSERT INTO messages (
       id, workspace_id, chat_id, type, content, from_me, is_read,
       instance_name, raw_payload, metadata, created_at
     ) VALUES ($1, $2, $3, 'text', $4, false, true, $5,
       '{}'::jsonb, '{}'::jsonb, clock_timestamp())
     RETURNING created_at`,
    [inboundId, ids.workspace, ids.chat, message, instanceName],
  );
  const startedAt = inbound.rows[0].created_at;
  const chat = await loadChat(client);
  const { processAutopilotForChat } = await import('../src/services/autopilot-service');

  await Promise.all([
    processAutopilotForChat(ids.workspace, chat as any, message, instanceName, inboundId),
    processAutopilotForChat(ids.workspace, chat as any, message, instanceName, inboundId),
  ]);

  const responses = await client.query(
    `SELECT id, content, api_message_status, metadata
       FROM messages
      WHERE workspace_id = $1
        AND chat_id = $2
        AND from_me = true
        AND sender_system_agent_id = $3
        AND created_at >= $4
        AND COALESCE(api_message_status, '') <> 'internal'
      ORDER BY created_at ASC`,
    [ids.workspace, ids.chat, ids.agent, startedAt],
  );
  const audit = await client.query(
    `SELECT tool_name, status
       FROM agent_tool_executions
      WHERE workspace_id = $1
        AND chat_id = $2
        AND created_at >= $3
      ORDER BY created_at ASC`,
    [ids.workspace, ids.chat, startedAt],
  );
  const runs = await client.query(
    `SELECT status, metadata
       FROM orchestrator_runs
      WHERE workspace_id = $1
        AND chat_id = $2
        AND source_message_id = $3
      ORDER BY created_at ASC`,
    [ids.workspace, ids.chat, inboundId],
  );
  const deliveries = await client.query(
    `SELECT id, delivery_key, status, next_block_index, jsonb_array_length(blocks) AS block_count
       FROM autopilot_response_deliveries
      WHERE workspace_id = $1
        AND chat_id = $2
        AND source_message_id = $3
        AND delivery_key = 'primary'
      ORDER BY created_at ASC`,
    [ids.workspace, ids.chat, inboundId],
  );
  const mcpCalls = readMcpLog().slice(beforeMcpLog.length);
  const failures: string[] = [];

  if (responses.rows.length !== 1) {
    failures.push(`visible_responses:${responses.rows.length}!=1`);
  }
  if (
    mcpCalls.length !== 1
    || mcpCalls[0]?.toolName !== 'get_order_status'
    || mcpCalls[0]?.args?.order_id !== 'RACE-9001'
  ) {
    failures.push(`mcp_calls:${JSON.stringify(mcpCalls)}`);
  }
  if (
    audit.rows.length !== 1
    || audit.rows[0]?.tool_name !== qualifiedTools.getOrderStatus
    || audit.rows[0]?.status !== 'success'
  ) {
    failures.push(`tool_audit:${JSON.stringify(audit.rows)}`);
  }
  if (
    runs.rows.length !== 1
    || !['success', 'fallback', 'skipped'].includes(String(runs.rows[0]?.status))
    || runs.rows[0]?.metadata?.responseSent !== true
  ) {
    failures.push(`orchestrator_runs:${JSON.stringify(runs.rows)}`);
  }
  const primaryDelivery = deliveries.rows[0];
  if (
    deliveries.rows.length !== 1
    || primaryDelivery?.status !== 'sent'
    || Number(primaryDelivery?.next_block_index) !== Number(primaryDelivery?.block_count)
    || responses.rows[0]?.metadata?.autopilotResponseDeliveryId !== primaryDelivery?.id
    || responses.rows[0]?.metadata?.autopilotSourceMessageId !== inboundId
  ) {
    failures.push(`response_delivery:${JSON.stringify(deliveries.rows)}`);
  }

  const trace = {
    turn: 'concurrent-duplicate',
    customerMessage: message,
    responseCount: responses.rows.length,
    responsePreview: String(responses.rows[0]?.content || '').slice(0, 220),
    toolAudit: audit.rows,
    mcpCalls,
    orchestratorRuns: runs.rows,
    responseDelivery: primaryDelivery || null,
    passed: failures.length === 0,
    failures,
  };
  console.log(JSON.stringify(trace, null, 2));
  if (failures.length > 0) {
    throw new Error(`Concurrent duplicate probe failed: ${failures.join(', ')}`);
  }
  return trace;
}

async function waitFor<T>(
  load: () => Promise<T | null>,
  timeoutMs = 90_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await load();
    if (value) return value;
    await new Promise((resolveWait) => setTimeout(resolveWait, 200));
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for canary state.`);
}

async function runWebhookTransportProbe(client: PoolClient) {
  const beforeMcpLog = readMcpLog();
  const beforeProviderRequests = providerRequests.length;
  const externalMessageId = `webhook-${randomUUID()}`;
  const customerMessage = 'Qual o status do pedido WEBHOOK-7001?';
  const webhookKey = `canary-webhook-${RUN_LABEL}`;
  const payload = {
    event: 'messages.upsert',
    instance: instanceName,
    sender: '5500000000000@s.whatsapp.net',
    server_url: providerBaseUrl,
    data: {
      key: {
        id: externalMessageId,
        fromMe: false,
        remoteJid: '5500000000000@s.whatsapp.net',
      },
      pushName: 'Cliente Canary',
      message: {
        conversation: customerMessage,
      },
      messageType: 'conversation',
      messageTimestamp: Math.floor(Date.now() / 1000),
      status: 'PENDING',
      source: 'web',
    },
  };
  const { POST } = await import('../src/services/whatsapp/evolution-webhook-handler');
  const invokeWebhook = () => POST(
    new Request(`http://127.0.0.1/api/webhooks/evolution/${webhookKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
    { params: Promise.resolve({ instanceName: webhookKey }) },
  );
  const responses = await Promise.all([invokeWebhook(), invokeWebhook()]);
  if (responses.some((response) => response.status !== 202)) {
    throw new Error(`Webhook transport did not return 202: ${responses.map((item) => item.status)}`);
  }

  const completed = await waitFor(async () => {
    const state = await client.query(
      `SELECT
         ewe.id AS event_id,
         ewe.status AS event_status,
         ewe.attempt_count,
         inbound.id AS inbound_id,
         delivery.id AS delivery_id,
         delivery.status AS delivery_status,
         delivery.next_block_index,
         jsonb_array_length(delivery.blocks) AS block_count,
         outbound.id AS outbound_id,
         outbound.api_message_status AS outbound_status,
         outbound.message_id_from_api AS provider_message_id,
         outbound.content AS outbound_content
       FROM evolution_webhook_events ewe
       LEFT JOIN messages inbound
         ON inbound.message_id_from_api = $1
        AND inbound.from_me = false
       LEFT JOIN autopilot_response_deliveries delivery
         ON delivery.source_message_id = inbound.id
        AND delivery.delivery_key = 'primary'
       LEFT JOIN messages outbound
         ON outbound.metadata->>'autopilotResponseDeliveryId' = delivery.id::text
        AND outbound.from_me = true
       WHERE ewe.workspace_id = $2
         AND ewe.instance_name = $3
         AND ewe.event_name = 'messages.upsert'
         AND ewe.dedup_key = $4
       LIMIT 1`,
      [externalMessageId, ids.workspace, instanceName, `message:${externalMessageId}`],
    );
    const row = state.rows[0];
    return row?.event_status === 'processed'
      && row?.delivery_status === 'sent'
      && row?.outbound_status === 'SENT'
      && row?.provider_message_id
      ? row
      : null;
  });

  const cardinality = await client.query(
    `SELECT
       (SELECT count(*)::int
          FROM evolution_webhook_events
         WHERE workspace_id = $1
           AND instance_name = $2
           AND event_name = 'messages.upsert'
           AND dedup_key = $3) AS event_count,
       (SELECT count(*)::int
          FROM messages
         WHERE workspace_id = $1
           AND message_id_from_api = $4
           AND from_me = false) AS inbound_count`,
    [ids.workspace, instanceName, `message:${externalMessageId}`, externalMessageId],
  );
  const mcpCalls = readMcpLog().slice(beforeMcpLog.length);
  const newProviderRequests = providerRequests.slice(beforeProviderRequests);
  const failures: string[] = [];
  if (cardinality.rows[0]?.event_count !== 1) failures.push('durable_event_count');
  if (cardinality.rows[0]?.inbound_count !== 1) failures.push('inbound_message_count');
  if (Number(completed.attempt_count) !== 1) failures.push(`attempt_count:${completed.attempt_count}`);
  if (Number(completed.next_block_index) !== Number(completed.block_count)) {
    failures.push('delivery_block_progress');
  }
  if (
    mcpCalls.length !== 1
    || mcpCalls[0]?.toolName !== 'get_order_status'
    || mcpCalls[0]?.args?.order_id !== 'WEBHOOK-7001'
  ) {
    failures.push(`mcp_calls:${JSON.stringify(mcpCalls)}`);
  }
  if (newProviderRequests.length !== 1) {
    failures.push(`provider_requests:${newProviderRequests.length}`);
  }
  if (!normalize(completed.outbound_content).includes('webhook-7001')) {
    failures.push('response_content');
  }

  const trace = {
    turn: 'webhook-transport-duplicate',
    durableEventStatus: completed.event_status,
    durableAttempts: Number(completed.attempt_count),
    inboundMessages: cardinality.rows[0]?.inbound_count,
    providerRequests: newProviderRequests.length,
    responseStatus: completed.outbound_status,
    mcpCalls,
    passed: failures.length === 0,
    failures,
  };
  console.log(JSON.stringify(trace, null, 2));
  if (failures.length > 0) {
    throw new Error(`Webhook transport probe failed: ${failures.join(', ')}`);
  }
  return trace;
}

async function runProviderRecoveryProbe(client: PoolClient) {
  const beforeMcpLog = readMcpLog();
  const beforeProviderRequests = providerRequests.length;
  const externalMessageId = `provider-recovery-${randomUUID()}`;
  const customerMessage = 'Qual o status do pedido RETRY-503?';
  const webhookKey = `canary-webhook-${RUN_LABEL}`;
  providerExplicitFailuresRemaining = 1;
  const payload = {
    event: 'messages.upsert',
    instance: instanceName,
    sender: '5500000000000@s.whatsapp.net',
    server_url: providerBaseUrl,
    data: {
      key: {
        id: externalMessageId,
        fromMe: false,
        remoteJid: '5500000000000@s.whatsapp.net',
      },
      pushName: 'Cliente Canary',
      message: { conversation: customerMessage },
      messageType: 'conversation',
      messageTimestamp: Math.floor(Date.now() / 1000),
      status: 'PENDING',
      source: 'web',
    },
  };
  const { POST } = await import('../src/services/whatsapp/evolution-webhook-handler');
  const response = await POST(
    new Request(`http://127.0.0.1/api/webhooks/evolution/${webhookKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
    { params: Promise.resolve({ instanceName: webhookKey }) },
  );
  if (response.status !== 202) {
    throw new Error(`Provider recovery webhook returned ${response.status}.`);
  }

  const completed = await waitFor(async () => {
    const state = await client.query(
      `SELECT
         ewe.status AS event_status,
         inbound.id AS inbound_id,
         delivery.status AS delivery_status,
         delivery.next_block_index,
         jsonb_array_length(delivery.blocks) AS block_count,
         count(outbound.id)::int AS outbound_count,
         count(outbound.id) FILTER (
           WHERE upper(COALESCE(outbound.api_message_status, '')) = 'FAILED'
         )::int AS failed_outbound_count,
         count(outbound.id) FILTER (
           WHERE upper(COALESCE(outbound.api_message_status, '')) = 'SENT'
         )::int AS sent_outbound_count,
         max(outbound.content) FILTER (
           WHERE upper(COALESCE(outbound.api_message_status, '')) = 'SENT'
         ) AS sent_outbound_content
       FROM evolution_webhook_events ewe
       LEFT JOIN messages inbound
         ON inbound.message_id_from_api = $1
        AND inbound.from_me = false
       LEFT JOIN autopilot_response_deliveries delivery
         ON delivery.source_message_id = inbound.id
        AND delivery.delivery_key = 'primary'
       LEFT JOIN messages outbound
         ON outbound.metadata->>'autopilotResponseDeliveryId' = delivery.id::text
        AND outbound.from_me = true
       WHERE ewe.workspace_id = $2
         AND ewe.instance_name = $3
         AND ewe.event_name = 'messages.upsert'
         AND ewe.dedup_key = $4
       GROUP BY ewe.status, inbound.id, delivery.id
       LIMIT 1`,
      [externalMessageId, ids.workspace, instanceName, `message:${externalMessageId}`],
    );
    const row = state.rows[0];
    return row?.event_status === 'processed'
      && row?.delivery_status === 'sent'
      && Number(row?.sent_outbound_count) === 1
      ? row
      : null;
  });

  const mcpCalls = readMcpLog().slice(beforeMcpLog.length);
  const sends = providerRequests.slice(beforeProviderRequests);
  const chatState = await client.query(
    `SELECT is_autopilot_active, assigned_system_agent_id, status
       FROM chats
      WHERE id = $1`,
    [ids.chat],
  );
  const failures: string[] = [];
  if (sends.length !== 2 || sends[0]?.statusCode !== 503 || sends[1]?.statusCode !== 200) {
    failures.push(`provider_attempts:${JSON.stringify(sends.map((item) => item.statusCode))}`);
  }
  if (Number(completed.failed_outbound_count) !== 1) {
    failures.push(`failed_outbound:${completed.failed_outbound_count}`);
  }
  if (Number(completed.sent_outbound_count) !== 1) {
    failures.push(`sent_outbound:${completed.sent_outbound_count}`);
  }
  if (
    !normalize(completed.sent_outbound_content).includes('retry-503')
    || !normalize(completed.sent_outbound_content).includes('em separacao')
  ) {
    failures.push(`sent_outbound_content:${completed.sent_outbound_content}`);
  }
  if (Number(completed.next_block_index) !== Number(completed.block_count)) {
    failures.push('delivery_block_progress');
  }
  if (
    mcpCalls.length !== 1
    || mcpCalls[0]?.toolName !== 'get_order_status'
    || mcpCalls[0]?.args?.order_id !== 'RETRY-503'
  ) {
    failures.push(`mcp_calls:${JSON.stringify(mcpCalls)}`);
  }
  if (
    chatState.rows[0]?.is_autopilot_active !== true
    || chatState.rows[0]?.assigned_system_agent_id !== ids.agent
  ) {
    failures.push(`chat_state:${JSON.stringify(chatState.rows[0])}`);
  }

  const trace = {
    turn: 'provider-explicit-503-recovery',
    providerAttempts: sends.map((item) => item.statusCode),
    failedOutboundMessages: Number(completed.failed_outbound_count),
    sentOutboundMessages: Number(completed.sent_outbound_count),
    mcpCalls,
    chatStillAutomated: chatState.rows[0]?.is_autopilot_active === true,
    passed: failures.length === 0,
    failures,
  };
  console.log(JSON.stringify(trace, null, 2));
  if (failures.length > 0) {
    throw new Error(`Provider recovery probe failed: ${failures.join(', ')}`);
  }
  return trace;
}

async function runUncertainProviderHandoffProbe(client: PoolClient) {
  const beforeMcpLog = readMcpLog();
  const beforeProviderRequests = providerRequests.length;
  const externalMessageId = `provider-uncertain-${randomUUID()}`;
  const customerMessage = 'Qual o status do pedido UNCERTAIN-1?';
  const webhookKey = `canary-webhook-${RUN_LABEL}`;
  providerUncertainFailuresRemaining = 1;
  const payload = {
    event: 'messages.upsert',
    instance: instanceName,
    sender: '5500000000000@s.whatsapp.net',
    server_url: providerBaseUrl,
    data: {
      key: {
        id: externalMessageId,
        fromMe: false,
        remoteJid: '5500000000000@s.whatsapp.net',
      },
      pushName: 'Cliente Canary',
      message: { conversation: customerMessage },
      messageType: 'conversation',
      messageTimestamp: Math.floor(Date.now() / 1000),
      status: 'PENDING',
      source: 'web',
    },
  };
  const { POST } = await import('../src/services/whatsapp/evolution-webhook-handler');
  const response = await POST(
    new Request(`http://127.0.0.1/api/webhooks/evolution/${webhookKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
    { params: Promise.resolve({ instanceName: webhookKey }) },
  );
  if (response.status !== 202) {
    throw new Error(`Uncertain provider webhook returned ${response.status}.`);
  }

  const completed = await waitFor(async () => {
    const state = await client.query(
      `SELECT
         ewe.status AS event_status,
         inbound.id AS inbound_id,
         delivery.status AS delivery_status,
         count(outbound.id)::int AS outbound_count,
         count(outbound.id) FILTER (
           WHERE upper(COALESCE(outbound.api_message_status, '')) = 'FAILED'
         )::int AS failed_outbound_count,
         c.status AS chat_status,
         c.is_autopilot_active,
         c.assigned_system_agent_id,
         count(note.id)::int AS uncertainty_note_count
       FROM evolution_webhook_events ewe
       LEFT JOIN messages inbound
         ON inbound.message_id_from_api = $1
        AND inbound.from_me = false
       LEFT JOIN autopilot_response_deliveries delivery
         ON delivery.source_message_id = inbound.id
        AND delivery.delivery_key = 'primary'
       LEFT JOIN messages outbound
         ON outbound.metadata->>'autopilotResponseDeliveryId' = delivery.id::text
        AND outbound.from_me = true
       LEFT JOIN chats c ON c.id = inbound.chat_id
       LEFT JOIN messages note
         ON note.chat_id = c.id
        AND note.metadata->>'event' = 'autopilot_provider_delivery_uncertain'
        AND note.metadata->>'sourceMessageId' = inbound.id::text
       WHERE ewe.workspace_id = $2
         AND ewe.instance_name = $3
         AND ewe.event_name = 'messages.upsert'
         AND ewe.dedup_key = $4
       GROUP BY ewe.status, inbound.id, delivery.id, c.id
       LIMIT 1`,
      [externalMessageId, ids.workspace, instanceName, `message:${externalMessageId}`],
    );
    const row = state.rows[0];
    return row?.event_status === 'processed'
      && row?.delivery_status === 'error'
      && row?.is_autopilot_active === false
      && row?.chat_status === 'gerais'
      && Number(row?.uncertainty_note_count) === 1
      ? row
      : null;
  });

  const mcpCalls = readMcpLog().slice(beforeMcpLog.length);
  const sends = providerRequests.slice(beforeProviderRequests);
  const failures: string[] = [];
  if (sends.length !== 1 || sends[0]?.statusCode !== 0) {
    failures.push(`provider_attempts:${JSON.stringify(sends.map((item) => item.statusCode))}`);
  }
  if (Number(completed.outbound_count) !== 1 || Number(completed.failed_outbound_count) !== 1) {
    failures.push(
      `outbound_messages:${completed.outbound_count}/${completed.failed_outbound_count}`,
    );
  }
  if (completed.assigned_system_agent_id !== null) {
    failures.push(`assigned_system_agent:${completed.assigned_system_agent_id}`);
  }
  if (
    mcpCalls.length !== 1
    || mcpCalls[0]?.toolName !== 'get_order_status'
    || mcpCalls[0]?.args?.order_id !== 'UNCERTAIN-1'
  ) {
    failures.push(`mcp_calls:${JSON.stringify(mcpCalls)}`);
  }

  const trace = {
    turn: 'provider-uncertain-no-blind-retry',
    providerAttempts: sends.map((item) => item.statusCode),
    failedOutboundMessages: Number(completed.failed_outbound_count),
    deliveryStatus: completed.delivery_status,
    chatStatus: completed.chat_status,
    autopilotActive: completed.is_autopilot_active,
    uncertaintyNotes: Number(completed.uncertainty_note_count),
    mcpCalls,
    passed: failures.length === 0,
    failures,
  };
  console.log(JSON.stringify(trace, null, 2));
  if (failures.length > 0) {
    throw new Error(`Uncertain provider probe failed: ${failures.join(', ')}`);
  }
  return trace;
}

async function main() {
  console.log(`[AUTOPILOT_CANARY] Starting ${RUN_LABEL}`);
  if (!existsSync(mcpServerPath)) throw new Error(`MCP fixture not found: ${mcpServerPath}`);
  providerServer.listen(0, '127.0.0.1');
  await once(providerServer, 'listening');
  const address = providerServer.address();
  if (!address || typeof address === 'string') {
    throw new Error('Could not start local Evolution provider fixture.');
  }
  providerBaseUrl = `http://127.0.0.1:${address.port}`;
  const client = await pool.connect();
  const { createQueueWorker } = await import('../src/lib/queue/worker');
  const { createAiQueueWorker } = await import('../src/lib/queue/ai-worker');
  const queueWorker = createQueueWorker();
  const aiQueueWorker = createAiQueueWorker();
  await Promise.all([
    queueWorker.worker.waitUntilReady(),
    aiQueueWorker.worker.waitUntilReady(),
  ]);
  let seeded = false;
  const traces: unknown[] = [];
  try {
    await seedSandbox(client);
    seeded = true;
    for (const [index, turn] of turns.entries()) {
      traces.push(await runTurn(client, index, turn.message, turn.expect));
    }
    traces.push(await runConcurrentDuplicateProbe(client));
    traces.push(await runWebhookTransportProbe(client));
    traces.push(await runProviderRecoveryProbe(client));
    traces.push(await runUncertainProviderHandoffProbe(client));

    const allMcpCalls = readMcpLog();
    const destructiveCalls = allMcpCalls.filter((entry) => entry.toolName === 'cancel_order');
    if (destructiveCalls.length > 0) {
      throw new Error('Canary safety violation: cancel_order reached the MCP server.');
    }
    const scheduleCalls = allMcpCalls.filter((entry) => entry.toolName === 'schedule_pickup');
    if (scheduleCalls.length !== 1) {
      throw new Error(`Expected one schedule_pickup call, received ${scheduleCalls.length}.`);
    }
    const acceptedProviderRequests = providerRequests.filter((entry) => entry.statusCode === 200);
    if (acceptedProviderRequests.length !== traces.length - 1) {
      throw new Error(
        `Expected ${traces.length - 1} accepted provider sends, received ${acceptedProviderRequests.length}.`,
      );
    }
    if (providerRequests.length !== traces.length + 1) {
      throw new Error(
        `Expected one explicit provider retry, received ${providerRequests.length - traces.length}.`,
      );
    }
    if (providerRequests.some((entry) => !entry.path.startsWith(`/message/sendText/${instanceName}`))) {
      throw new Error(`Unexpected provider route: ${JSON.stringify(providerRequests)}`);
    }

    console.log(JSON.stringify({
      runLabel: RUN_LABEL,
      passed: true,
      turns: traces.length,
      mcpCallCounts: Object.fromEntries(
        [...new Set(allMcpCalls.map((entry) => entry.toolName))]
          .map((toolName) => [toolName, allMcpCalls.filter((entry) => entry.toolName === toolName).length]),
      ),
      destructiveCalls: destructiveCalls.length,
      providerAcceptedMessages: acceptedProviderRequests.length,
      providerRejectedAttempts: providerRequests.length - acceptedProviderRequests.length,
      cleanup: KEEP_DATA ? 'kept' : 'scheduled',
    }, null, 2));
  } finally {
    if (seeded && !KEEP_DATA) {
      await deleteSandboxData(client);
    }
    client.release();
    await Promise.all([
      queueWorker.worker.close(),
      aiQueueWorker.worker.close(),
    ]);
    await Promise.all([
      queueWorker.connection.quit(),
      aiQueueWorker.connection.quit(),
    ]);
    providerServer.close();
    await once(providerServer, 'close').catch(() => undefined);
    await pool.end();
    if (!KEEP_DATA) rmSync(mcpLogPath, { force: true });
  }
}

main().then(() => {
  process.exit(0);
}).catch(async (error) => {
  console.error(error);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
