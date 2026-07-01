import module from 'node:module';
const originalRequire = module.prototype.require;
module.prototype.require = function patchedRequire(id) {
  if (id === 'server-only') return {};
  return originalRequire.call(this, id);
};

import 'dotenv/config';

import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { Pool, type PoolClient } from 'pg';

import { classifyMcpToolSafety } from '@/services/mcp/tool-safety';
import { parseQualifiedMcpToolName } from '@/services/mcp/client';

process.env.AI_ORCHESTRATOR_RAG_TIMEOUT_MS ||= '4000';
process.env.AI_INTENT_CLASSIFIER_TIMEOUT_MS ||= '4000';
process.env.AI_WORKFLOW_CLASSIFIER_TIMEOUT_MS ||= '4000';
process.env.AI_ORCHESTRATOR_LLM_TIMEOUT_MS ||= '12000';

const sourceChatId = process.argv[2]?.trim();
if (!sourceChatId) {
  throw new Error('Usage: npm run e2e:autopilot:readonly-replay -- <source-chat-id>');
}
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
const scenario = String(
  process.argv[5] || process.env.AUTOPILOT_READONLY_REPLAY_SCENARIO || 'wifi_credentials',
).trim().toLowerCase();
if (![
  'wifi_credentials',
  'wifi_channel_diagnostics',
  'wifi_branch_switch',
  'reboot_confirmation',
  'wifi_change_confirmation',
  'contract_mismatch',
].includes(scenario)) {
  throw new Error('Unknown readonly replay scenario.');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 15000,
});
const KEEP_DATA = process.env.AUTOPILOT_READONLY_REPLAY_KEEP_DATA === 'true';
const runLabel = `autopilot-readonly-replay-${Date.now()}`;
const syntheticWifiPassword = 'DialogyTesteSomenteNaoAplicar!42';
process.env.QUEUE_MODE = 'enqueue';
process.env.BULLMQ_PREFIX = runLabel;
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
const ids = {
  agent: randomUUID(),
  chat: randomUUID(),
  cluster: randomUUID(),
  contact: randomUUID(),
  instance: randomUUID(),
};
const fakeInstanceName = `${runLabel}-local-provider`;
const replayPhone = `55${String(Date.now()).slice(-11)}`;
const providerRequests: Array<{
  path: string;
  body: Record<string, unknown>;
}> = [];
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
  providerRequests.push({
    path: request.url || '',
    body,
  });
  response.writeHead(200, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify({
    key: { id: `readonly-provider-${providerRequests.length}` },
    status: 'PENDING',
  }));
});
let providerBaseUrl = '';

type SourceContext = {
  workspaceId: string;
  contactId: string;
  configId: string;
  configUserId: string;
  cpfFieldId: string;
  contactName: string;
  contactEmail: string;
  contactJid: string;
  contactAvatar: string;
  contactAddress: string;
  qualifiedWifiViewTool: string | null;
  qualifiedWifiDiagnosticTool: string | null;
  qualifiedWifiCachedTool: string | null;
  qualifiedRebootTool: string | null;
  qualifiedWifiChangeTool: string | null;
  document: string;
  contractId: string | null;
};

function onlyDigits(value: unknown) {
  return String(value || '').replace(/\D/g, '');
}

function redact(value: unknown) {
  return String(value || '')
    .replaceAll(syntheticWifiPassword, '[redigido]')
    .replace(/\b\d{11,14}\b/g, '[documento]')
    .replace(/(\bcontrato\s*(?:n[.\s]*|numero\s*)?[:#-]?\s*)\d+/gi, '$1[contrato]')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[ip]')
    .replace(/((?:ssid|rede|usuario|user|username|login)\s*[:=-]\s*)[^\s,;]+/gi, '$1[redigido]')
    .replace(/((?:senha|password)\s*[:=-]\s*)\S+/gi, '$1[redigido]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}

function describeOutputShape(value: unknown, path = 'output'): string[] {
  if (typeof value === 'string' && path.endsWith('.text')) {
    try {
      return describeOutputShape(JSON.parse(value), `${path}<json>`);
    } catch {
      // Non-JSON MCP text is represented only by type and length below.
    }
  }
  if (Array.isArray(value)) {
    const itemShapes = value.slice(0, 5).flatMap((item) => describeOutputShape(item, `${path}[]`));
    return itemShapes.length > 0 ? itemShapes : [`${path}:array(empty)`];
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return [`${path}:object(empty)`];
    return entries.flatMap(([key, nested]) => describeOutputShape(nested, `${path}.${key}`));
  }
  const type = value === null ? 'null' : typeof value;
  const length = typeof value === 'string' ? `(length=${value.length})` : '';
  return [`${path}:${type}${length}`];
}

function safeOutputShape(value: unknown): string[] {
  const unique = new Set(describeOutputShape(value).map((entry) => (
    /\b(password|passphrase|senha|ssid|username|login)\b/i.test(entry)
      ? entry.replace(/\(length=\d+\)/g, '(redacted)')
      : entry
  )));
  return [...unique].slice(0, 50);
}

function findDocument(messages: Array<{ content: unknown }>): string | null {
  for (const message of messages) {
    const candidates = String(message.content || '').match(/(?:\d[\s.\-/]*){11,14}/g) || [];
    for (const candidate of candidates) {
      const digits = onlyDigits(candidate);
      if (digits.length === 11 || digits.length === 14) return digits;
    }
  }
  return null;
}

async function loadSourceContext(client: PoolClient): Promise<SourceContext> {
  const source = await client.query(
    `SELECT c.workspace_id, c.contact_id,
            COALESCE(c.autopilot_config_id, sa.autopilot_config_id) AS config_id,
            ac.user_id AS config_user_id, ac.enabled_tool_names,
            ct.name AS contact_name, ct.email AS contact_email,
            ct.phone_number_jid, ct.avatar_url, ct.address
       FROM chats c
       LEFT JOIN system_agents sa ON sa.id = c.assigned_system_agent_id
       JOIN autopilot_configs ac
         ON ac.id = COALESCE(c.autopilot_config_id, sa.autopilot_config_id)
       JOIN contacts ct ON ct.id = c.contact_id
      WHERE c.id = $1
      LIMIT 1`,
    [sourceChatId],
  );
  const row = source.rows[0];
  if (!row) throw new Error('Source chat/config/contact not found.');
  if (!row.config_user_id) throw new Error('Source autopilot config has no owner user.');

  const messageResult = await client.query(
    `SELECT content
       FROM messages
      WHERE workspace_id = $1
        AND chat_id = $2
        AND from_me = false
      ORDER BY created_at DESC
      LIMIT 40`,
    [row.workspace_id, sourceChatId],
  );
  const requestedDocument = onlyDigits(
    process.argv[3] || process.env.AUTOPILOT_READONLY_REPLAY_DOCUMENT,
  );
  if (requestedDocument && ![11, 14].includes(requestedDocument.length)) {
    throw new Error('CPF/CNPJ explicito deve conter 11 ou 14 digitos.');
  }
  const document = requestedDocument || findDocument(messageResult.rows);
  if (!document) throw new Error('No CPF/CNPJ was found in the source conversation.');
  const requestedContractId = onlyDigits(
    process.argv[4] || process.env.AUTOPILOT_READONLY_REPLAY_CONTRACT_ID,
  );
  const sgpIntegration = await client.query(
    `SELECT config
       FROM workspace_integrations
      WHERE workspace_id = $1
        AND provider = 'sgp'
        AND is_active = true
      LIMIT 1`,
    [row.workspace_id],
  );
  const cpfFieldId = String(sgpIntegration.rows[0]?.config?.cpfFieldId || '').trim();
  if (!cpfFieldId) throw new Error('Active SGP integration has no cpfFieldId mapping.');

  const integration = await client.query(
    `SELECT config
       FROM workspace_integrations
      WHERE workspace_id = $1
        AND provider = 'mcp'
        AND is_active = true
      LIMIT 1`,
    [row.workspace_id],
  );
  const servers = Array.isArray(integration.rows[0]?.config?.servers)
    ? integration.rows[0].config.servers
    : [];
  const allMcpTools = servers
    .filter((server: any) => server?.isActive === true)
    .flatMap((server: any) => Array.isArray(server.tools) ? server.tools : []);
  const enabledToolNames = new Set(
    Array.isArray(row.enabled_tool_names) ? row.enabled_tool_names.map(String) : [],
  );
  const wifiView = allMcpTools
    .find((tool: any) => /:get_wifi_view$/i.test(String(tool?.qualifiedName || '')));
  const wifiDiagnostic = allMcpTools
    .filter((tool: any) => enabledToolNames.has(String(tool?.qualifiedName || '')))
    .sort((left: any, right: any) => {
      const priority = (tool: any) => (
        /:scan_wifi_neighbors$/i.test(String(tool?.qualifiedName || '')) ? 2
          : /:get_wifi_scan_cached$/i.test(String(tool?.qualifiedName || '')) ? 1
            : 0
      );
      return priority(right) - priority(left);
    })
    .find((tool: any) => /:(?:scan_wifi_neighbors|get_wifi_scan_cached)$/i.test(String(tool?.qualifiedName || '')));
  const wifiCached = allMcpTools
    .filter((tool: any) => enabledToolNames.has(String(tool?.qualifiedName || '')))
    .find((tool: any) => /:get_wifi_scan_cached$/i.test(String(tool?.qualifiedName || '')));
  const rebootTool = allMcpTools
    .filter((tool: any) => enabledToolNames.has(String(tool?.qualifiedName || '')))
    .find((tool: any) => /:reboot_router$/i.test(String(tool?.qualifiedName || '')));
  const wifiChangeTool = allMcpTools
    .filter((tool: any) => enabledToolNames.has(String(tool?.qualifiedName || '')))
    .find((tool: any) => /:(?:change|update|set)_wifi_credentials(?:_[a-z0-9]+)?$/i.test(String(tool?.qualifiedName || '')));
  if (['wifi_credentials', 'wifi_branch_switch', 'contract_mismatch'].includes(scenario) && !wifiView?.qualifiedName) {
    throw new Error('Enabled qualified get_wifi_view MCP tool not found.');
  }
  if (['wifi_channel_diagnostics', 'wifi_branch_switch'].includes(scenario) && !wifiDiagnostic?.qualifiedName) {
    throw new Error('Enabled qualified Wi-Fi diagnostic MCP tool not found.');
  }
  if (scenario === 'reboot_confirmation' && !rebootTool?.qualifiedName) {
    throw new Error('Enabled qualified reboot MCP tool not found.');
  }
  if (scenario === 'wifi_change_confirmation' && !wifiChangeTool?.qualifiedName) {
    throw new Error('Enabled qualified Wi-Fi change MCP tool not found.');
  }
  const selectedTool = scenario === 'wifi_channel_diagnostics'
    ? wifiDiagnostic
    : scenario === 'reboot_confirmation'
      ? rebootTool
      : scenario === 'wifi_change_confirmation'
        ? wifiChangeTool
        : wifiView;
  const safety = classifyMcpToolSafety(String(selectedTool?.qualifiedName || ''), selectedTool);
  const isSensitiveConfirmationScenario = ['reboot_confirmation', 'wifi_change_confirmation'].includes(scenario);
  if (!isSensitiveConfirmationScenario && (safety.riskLevel !== 'low' || safety.sideEffect !== 'none')) {
    throw new Error('get_wifi_view is not classified as a safe read-only tool.');
  }
  if (isSensitiveConfirmationScenario && safety.sideEffect === 'none') {
    throw new Error('Sensitive confirmation scenario selected a read-only tool.');
  }

  return {
    workspaceId: String(row.workspace_id),
    contactId: String(row.contact_id),
    configId: String(row.config_id),
    configUserId: String(row.config_user_id),
    cpfFieldId,
    contactName: String(row.contact_name || 'Cliente'),
    contactEmail: String(row.contact_email || ''),
    contactJid: String(row.phone_number_jid || ''),
    contactAvatar: String(row.avatar_url || ''),
    contactAddress: String(row.address || ''),
    qualifiedWifiViewTool: wifiView?.qualifiedName ? String(wifiView.qualifiedName) : null,
    qualifiedWifiDiagnosticTool: wifiDiagnostic?.qualifiedName
      ? String(wifiDiagnostic.qualifiedName)
      : null,
    qualifiedWifiCachedTool: wifiCached?.qualifiedName
      ? String(wifiCached.qualifiedName)
      : null,
    qualifiedRebootTool: rebootTool?.qualifiedName ? String(rebootTool.qualifiedName) : null,
    qualifiedWifiChangeTool: wifiChangeTool?.qualifiedName ? String(wifiChangeTool.qualifiedName) : null,
    document,
    contractId: requestedContractId || null,
  };
}

async function seedReplay(client: PoolClient, source: SourceContext) {
  await client.query(
    `INSERT INTO whatsapp_clusters (id, name, api_url, api_key, is_active)
     VALUES ($1, $2, $3, $4, true)`,
    [
      ids.cluster,
      `Readonly Replay Provider ${runLabel}`,
      providerBaseUrl,
      `readonly-api-key-${runLabel}`,
    ],
  );
  await client.query(
    `INSERT INTO evolution_api_instances (
       id, workspace_id, cluster_id, instance_name, webhook_key,
       display_name, type, webhook_url
     ) VALUES ($1, $2, $3, $4, $5, $6, 'baileys', $7)`,
    [
      ids.instance,
      source.workspaceId,
      ids.cluster,
      fakeInstanceName,
      `readonly-webhook-${runLabel}`,
      'Readonly Replay WhatsApp',
      'https://example.invalid/readonly-replay',
    ],
  );
  await client.query(
    `INSERT INTO system_agents (
       id, workspace_id, name, token, is_active, created_by_id, type,
       hide_from_chatlist, autopilot_config_id
     ) VALUES ($1, $2, 'Autopilot Readonly Replay', $3, true, $4,
       'intelligent_attendant', true, $5)`,
    [ids.agent, source.workspaceId, `readonly-replay-${runLabel}`, source.configUserId, source.configId],
  );
  await client.query(
    `INSERT INTO contacts (
       id, workspace_id, name, email, phone, phone_number_jid, avatar_url, address
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      ids.contact,
      source.workspaceId,
      'Autopilot Readonly Replay',
      source.contactEmail || null,
      replayPhone,
      `${replayPhone}@s.whatsapp.net`,
      source.contactAvatar || null,
      source.contactAddress || null,
    ],
  );
  await client.query(
    `INSERT INTO contact_custom_field_values (contact_id, field_id, value)
     VALUES ($1, $2, $3)`,
    [ids.contact, source.cpfFieldId, source.document],
  );
  await client.query(
    `INSERT INTO chats (
       id, workspace_id, contact_id, status, is_autopilot_active,
       autopilot_config_id, copilot_mode, assigned_system_agent_id,
       source, instance_type, unread_count
     ) VALUES ($1, $2, $3, 'atendimentos', true, $4, 'auto', $5,
       'whatsapp', 'baileys', 0)`,
    [ids.chat, source.workspaceId, ids.contact, source.configId, ids.agent],
  );
}

async function cleanupReplay(
  client: PoolClient,
  workspaceId: string,
  target: { chat: string; agent: string } = ids,
) {
  const tables = [
    'orchestrator_tool_calls',
    'resource_mapping_ledger',
    'agent_decision_ledger',
    'orchestrator_events',
    'orchestrator_runs',
    'agent_procedure_sessions',
    'agent_tool_executions',
    'chat_case_memories',
    'autopilot_usage_logs',
    'rag_retrieval_logs',
    'autopilot_conversation_states',
    'procedure_executions',
    'messages',
  ];
  for (const table of tables) {
    try {
      await client.query(`DELETE FROM ${table} WHERE workspace_id = $1 AND chat_id = $2`, [
        workspaceId,
        target.chat,
      ]);
    } catch (error: any) {
      if (error?.code !== '42P01' && error?.code !== '42703') throw error;
    }
  }
  await client.query('DELETE FROM chats WHERE id = $1', [target.chat]);
  await client.query('DELETE FROM system_agents WHERE id = $1', [target.agent]);
  if ('contact' in target && target.contact) {
    await client.query('DELETE FROM contacts WHERE id = $1', [target.contact]);
  }
}

async function cleanupProviderFixture(client: PoolClient) {
  await client.query('DELETE FROM evolution_api_instances WHERE id = $1', [ids.instance]);
  await client.query('DELETE FROM whatsapp_clusters WHERE id = $1', [ids.cluster]);
}

async function cleanupStaleReplays(client: PoolClient, source: SourceContext) {
  const stale = await client.query(
    `SELECT c.id AS chat_id, sa.id AS agent_id
       FROM chats c
       JOIN system_agents sa ON sa.id = c.assigned_system_agent_id
      WHERE c.workspace_id = $1
        AND c.contact_id = $2
        AND c.autopilot_config_id = $3
        AND sa.name = 'Autopilot Readonly Replay'
        AND sa.hide_from_chatlist = true
        AND sa.created_at < clock_timestamp() - interval '5 minutes'`,
    [source.workspaceId, source.contactId, source.configId],
  );
  for (const row of stale.rows) {
    await cleanupReplay(client, source.workspaceId, {
      chat: String(row.chat_id),
      agent: String(row.agent_id),
    });
  }
}

async function runReplay(client: PoolClient, source: SourceContext) {
  const selectedQualifiedTools = (
    scenario === 'wifi_branch_switch'
      ? [source.qualifiedWifiViewTool, source.qualifiedWifiDiagnosticTool]
      : scenario === 'wifi_channel_diagnostics'
        ? [source.qualifiedWifiDiagnosticTool]
        : scenario === 'reboot_confirmation'
          ? [source.qualifiedRebootTool]
          : scenario === 'wifi_change_confirmation'
            ? [source.qualifiedWifiChangeTool]
            : [source.qualifiedWifiViewTool]
  ).filter((toolName): toolName is string => Boolean(toolName));
  const selectedMcpTools = selectedQualifiedTools.map(parseQualifiedMcpToolName);
  if (selectedMcpTools.some((tool) => !tool?.serverId)) {
    throw new Error('Could not resolve every selected MCP server id.');
  }
  process.env.MCP_ALLOW_ENDPOINT_OVERRIDES = 'true';
  process.env.MCP_HTTP_ENDPOINT_OVERRIDES = JSON.stringify(Object.fromEntries(
    selectedMcpTools.map((tool) => [tool!.serverId, 'http://127.0.0.1:8090/mcp']),
  ));

  const credentialMessage = [
    `Esqueci o usuario e a senha do meu Wi-Fi. Meu CPF e ${source.document}.`,
    source.contractId ? `Contrato: ${source.contractId}.` : '',
  ].filter(Boolean).join(' ');
  const diagnosticMessage = [
    `Agora meu Wi-Fi esta lento. Analise as redes ao redor, interferencia e canais e recomende o melhor canal. Meu CPF e ${source.document}. Nao altere nenhuma configuracao.`,
    source.contractId ? `Contrato: ${source.contractId}.` : '',
  ].filter(Boolean).join(' ');
  const rebootMessage = [
    `Quero reiniciar o meu roteador. Meu CPF e ${source.document}.`,
    source.contractId ? `Contrato: ${source.contractId}.` : '',
  ].filter(Boolean).join(' ');
  const wifiChangeMessage = [
    `Quero trocar a senha do meu Wi-Fi. Meu CPF e ${source.document}.`,
    source.contractId ? `Contrato: ${source.contractId}.` : '',
  ].filter(Boolean).join(' ');
  const wifiChangeValueMessage = `Nova senha: ${syntheticWifiPassword}`;
  const messages = scenario === 'wifi_branch_switch'
    ? [credentialMessage, diagnosticMessage]
    : scenario === 'wifi_change_confirmation'
      ? [wifiChangeMessage, wifiChangeValueMessage]
    : [
        scenario === 'wifi_channel_diagnostics'
          ? diagnosticMessage
          : scenario === 'reboot_confirmation'
            ? rebootMessage
            : credentialMessage,
      ];
  const inboundIds: string[] = [];
  const turnSnapshots: Array<{
    responseText: string;
    pendingConfirmation: boolean;
    pendingToolName: string | null;
    pendingArgumentNames: string[];
    executionToolNames: string[];
  }> = [];
  let startedAt: Date | null = null;
  const requestedToolName = (execution: any) => execution.input?.type === 'mcp_call_tool'
    ? String(execution.input?.payload?.toolName || execution.tool_name)
    : String(execution.input?.type || execution.tool_name);
  const chat = {
    id: ids.chat,
    workspace_id: source.workspaceId,
    status: 'atendimentos',
    source: 'whatsapp',
    instance_type: 'baileys',
    agentId: null,
    assigned_system_agent_id: ids.agent,
    is_autopilot_active: true,
    autopilot_config_id: source.configId,
    copilot_mode: 'auto',
    messages: [],
    contact: {
      id: ids.contact,
      name: 'Autopilot Readonly Replay',
      email: source.contactEmail,
      phone_number_jid: `${replayPhone}@s.whatsapp.net`,
      avatar_url: source.contactAvatar,
      address: source.contactAddress,
    },
  };

  const { processAutopilotForChat } = await import('../src/services/autopilot-service');
  for (const message of messages) {
    const inboundId = randomUUID();
    const inbound = await client.query(
      `INSERT INTO messages (
         id, workspace_id, chat_id, type, content, from_me, is_read,
         instance_name, raw_payload, metadata, created_at
       ) VALUES ($1, $2, $3, 'text', $4, false, true, $5,
         '{}'::jsonb, '{}'::jsonb, clock_timestamp())
       RETURNING created_at`,
      [inboundId, source.workspaceId, ids.chat, message, fakeInstanceName],
    );
    inboundIds.push(inboundId);
    startedAt ||= inbound.rows[0].created_at;
    await processAutopilotForChat(
      source.workspaceId,
      chat as any,
      message,
      fakeInstanceName,
      inboundId,
    );
    const turnResponse = await client.query(
      `SELECT content
         FROM messages
        WHERE workspace_id = $1
          AND chat_id = $2
          AND from_me = true
          AND sender_system_agent_id = $3
          AND created_at >= $4
          AND COALESCE(api_message_status, '') <> 'internal'
        ORDER BY created_at ASC`,
      [source.workspaceId, ids.chat, ids.agent, inbound.rows[0].created_at],
    );
    const turnState = await client.query(
      `SELECT pending_confirmation
         FROM autopilot_conversation_states
        WHERE workspace_id = $1
          AND chat_id = $2
        LIMIT 1`,
      [source.workspaceId, ids.chat],
    );
    const turnExecutions = await client.query(
      `SELECT tool_name, input
         FROM agent_tool_executions
        WHERE workspace_id = $1
          AND chat_id = $2
          AND created_at >= $3
        ORDER BY created_at ASC`,
      [source.workspaceId, ids.chat, inbound.rows[0].created_at],
    );
    const pendingConfirmation = turnState.rows[0]?.pending_confirmation;
    const pendingAction = pendingConfirmation?.action;
    const pendingArguments = pendingAction?.type === 'mcp_call_tool'
      && pendingAction?.payload?.arguments
      && typeof pendingAction.payload.arguments === 'object'
        ? pendingAction.payload.arguments
        : {};
    turnSnapshots.push({
      responseText: turnResponse.rows.map((row) => String(row.content || '')).join('\n'),
      pendingConfirmation: Boolean(pendingConfirmation),
      pendingToolName: pendingAction?.type === 'mcp_call_tool'
        ? String(pendingAction.payload?.toolName || '')
        : pendingAction?.type
          ? String(pendingAction.type)
          : null,
      pendingArgumentNames: Object.keys(pendingArguments).sort(),
      executionToolNames: turnExecutions.rows.map(requestedToolName),
    });
  }
  if (!startedAt) throw new Error('Replay did not create an inbound message.');

  const response = await client.query(
    `SELECT content, api_message_status
       FROM messages
      WHERE workspace_id = $1
        AND chat_id = $2
        AND from_me = true
        AND sender_system_agent_id = $3
        AND created_at >= $4
        AND COALESCE(api_message_status, '') <> 'internal'
      ORDER BY created_at ASC`,
    [source.workspaceId, ids.chat, ids.agent, startedAt],
  );
  const responseDeliveries = await client.query(
    `SELECT delivery_key, status, next_block_index, jsonb_array_length(blocks) AS block_count
       FROM autopilot_response_deliveries
      WHERE workspace_id = $1
        AND chat_id = $2
        AND source_message_id = ANY($3::uuid[])
      ORDER BY created_at ASC`,
    [source.workspaceId, ids.chat, inboundIds],
  );
  const executions = await client.query(
    `SELECT tool_name, status, input, output, error
       FROM agent_tool_executions
      WHERE workspace_id = $1
        AND chat_id = $2
        AND created_at >= $3
      ORDER BY created_at ASC`,
    [source.workspaceId, ids.chat, startedAt],
  );
  const state = await client.query(
    `SELECT pending_confirmation
       FROM autopilot_conversation_states
      WHERE workspace_id = $1
        AND chat_id = $2
      LIMIT 1`,
    [source.workspaceId, ids.chat],
  );
  const events = await client.query(
    `SELECT kind, status, payload
       FROM orchestrator_events
      WHERE workspace_id = $1
        AND chat_id = $2
        AND created_at >= $3
      ORDER BY created_at ASC`,
    [source.workspaceId, ids.chat, startedAt],
  );
  const finalChatState = await client.query(
    `SELECT status, is_autopilot_active, assigned_system_agent_id
     FROM chats
     WHERE id = $1
       AND workspace_id = $2
     LIMIT 1`,
    [ids.chat, source.workspaceId],
  );

  const audits = executions.rows.map((execution) => ({
    toolName: requestedToolName(execution),
    status: String(execution.status),
    error: redact(execution.error),
    inputShape: safeOutputShape(execution.input),
    outputShape: safeOutputShape(execution.output),
  }));
  const responseTexts = response.rows.map((row) => String(row.content || ''));
  const responseText = responseTexts.join('\n');
  const normalizedResponse = responseText.toLowerCase();
  const destructiveAudits = audits.filter((audit) => {
    const name = audit.toolName;
    return /\b(reboot|change|set_parameters|clear_pending|import_mesh)\b/i.test(name);
  });
  const expectedToolName = ['wifi_channel_diagnostics', 'wifi_branch_switch'].includes(scenario)
    ? source.qualifiedWifiDiagnosticTool
    : scenario === 'reboot_confirmation'
      ? source.qualifiedRebootTool
      : scenario === 'wifi_change_confirmation'
        ? source.qualifiedWifiChangeTool
        : source.qualifiedWifiViewTool;
  const expectedToolAudits = audits.filter((audit) => audit.toolName === expectedToolName);
  const cachedToolAudits = audits.filter((audit) => audit.toolName === source.qualifiedWifiCachedTool);
  const hasEvent = (kind: string, predicate?: (payload: any) => boolean) => events.rows.some(
    (event) => event.kind === kind && (!predicate || predicate(event.payload || {})),
  );
  const expectedToolSucceeded = expectedToolAudits.some((audit) => audit.status === 'success');
  const cachedToolSucceeded = cachedToolAudits.some((audit) => audit.status === 'success');
  const diagnosticPathSucceeded = expectedToolSucceeded || cachedToolSucceeded;
  const terminalContractMismatch = hasEvent(
    'turn_plan_post_tool_terminal',
    (payload) => (
      payload.procedureRuntimeSuppressed === true
      && Array.isArray(payload.reasons)
      && payload.reasons.includes('requested_contract_not_owned_by_validated_customer')
    ),
  );
  const mcpAudits = audits.filter((audit) => audit.toolName.startsWith('mcp:'));
  const sensitiveConfirmationScenario = ['reboot_confirmation', 'wifi_change_confirmation'].includes(scenario);
  const firstTurnSnapshot = turnSnapshots[0];
  const secondTurnSnapshot = turnSnapshots[1];
  const firstTurnResponse = String(firstTurnSnapshot?.responseText || '').toLowerCase();
  const secondTurnResponse = String(secondTurnSnapshot?.responseText || '').toLowerCase();
  const scenarioChecks = scenario === 'contract_mismatch'
    ? {
        noMcpAttemptForUnvalidatedContract: mcpAudits.length === 0,
        terminalContractMismatchDetected: terminalContractMismatch,
        procedureRuntimeWasNotEntered: !hasEvent('procedure_runtime'),
        responseRequestsContractOrDocumentCorrection: (
          /\bcontrato\b/.test(normalizedResponse)
          && /\b(cpf|cnpj|titular|confira|verifique)\b/.test(normalizedResponse)
          && /\b(nao foi encontrado|não foi encontrado|nao pertence|não pertence)\b/.test(normalizedResponse)
        ),
      }
    : scenario === 'wifi_change_confirmation'
    ? {
        sensitiveToolWasNotExecuted: expectedToolAudits.length === 0,
        firstTurnValidatedCustomerAndContract: firstTurnSnapshot?.executionToolNames.includes(
          'sgp_fetch_contact_panel_data',
        ) === true,
        singleSgpValidationAcrossCollectionFlow: audits.filter(
          (audit) => audit.toolName === 'sgp_fetch_contact_panel_data' && audit.status === 'success',
        ).length === 1,
        firstTurnRequestedOnlyMissingPassword: (
          /\bapenas\b/.test(firstTurnResponse)
          && /\bnova senha\b/.test(firstTurnResponse)
          && !/\bnovo nome\b/.test(firstTurnResponse)
        ),
        firstTurnDidNotStageConfirmation: firstTurnSnapshot?.pendingConfirmation === false,
        secondTurnStagedQualifiedConfirmation: (
          secondTurnSnapshot?.pendingConfirmation === true
          && secondTurnSnapshot.pendingToolName === source.qualifiedWifiChangeTool
          && secondTurnSnapshot.executionToolNames.length === 0
        ),
        pendingActionUsesWifiFieldsNotAdminCredentials: (
          secondTurnSnapshot?.pendingArgumentNames.includes('client_ip') === true
          && secondTurnSnapshot.pendingArgumentNames.includes('password_24')
          && secondTurnSnapshot.pendingArgumentNames.includes('password_5g')
          && !secondTurnSnapshot.pendingArgumentNames.includes('password')
          && !secondTurnSnapshot.pendingArgumentNames.includes('username')
        ),
        explicitConfirmationWasRequested: (
          /\b(confirm|autoriza|posso|deseja prosseguir)\w*/.test(secondTurnResponse)
          && /\bnenhuma mudanca foi aplicada\b/.test(secondTurnResponse)
        ),
        noSuccessClaimBeforeExecution: !/\b(pronto|alterad[oa] com sucesso|concluido)\b/.test(normalizedResponse),
      }
    : sensitiveConfirmationScenario
    ? {
        sensitiveToolWasNotExecuted: expectedToolAudits.length === 0,
        explicitConfirmationWasRequested: (
          Boolean(state.rows[0]?.pending_confirmation)
          && /\b(confirm|autoriza|posso|deseja prosseguir)\w*/.test(normalizedResponse)
        ),
        noSuccessClaimBeforeExecution: !/\b(pronto|alterad[oa] com sucesso|reiniciad[oa] com sucesso|concluido)\b/.test(normalizedResponse),
      }
    : scenario === 'wifi_branch_switch'
    ? {
        credentialLookupSucceededBeforeBranchSwitch: audits.some(
          (audit) => audit.toolName === source.qualifiedWifiViewTool && audit.status === 'success',
        ),
        diagnosticSucceededAfterBranchSwitch: diagnosticPathSucceeded,
        singleSgpValidationReusedAcrossBranches: (
          audits.filter(
          (audit) => audit.toolName === 'sgp_fetch_contact_panel_data' && audit.status === 'success',
          ).length === 1
          && secondTurnSnapshot?.executionToolNames.includes('sgp_fetch_contact_panel_data') === false
        ),
        oneCredentialLookupAttempt: audits.filter(
          (audit) => audit.toolName === source.qualifiedWifiViewTool,
        ).length === 1,
        oneLiveDiagnosticAttempt: expectedToolAudits.length === 1,
        atMostOneCachedRecoveryAttempt: cachedToolAudits.length <= 1,
        twoSuccessfulSwitchResolutions: events.rows.filter(
          (event) => event.kind === 'switch_resolution' && event.status === 'success',
        ).length === 2,
        noSwitchFallbackAcrossTurns: !events.rows.some(
          (event) => event.kind === 'switch_resolution' && event.status === 'fallback',
        ),
        firstResponseContainsCredentials: (
          /\b(senha|password)\b/.test(String(responseTexts[0] || '').toLowerCase())
          && /\b(ssid|rede|usuario|login)\b/.test(String(responseTexts[0] || '').toLowerCase())
        ),
        secondResponseContainsChannelAnalysis: (
          /\b(canal|channel)\b/.test(String(responseTexts.at(-1) || '').toLowerCase())
          && /\b(rede|wifi|wi-fi|interfer|sinal|vizinh)\b/.test(String(responseTexts.at(-1) || '').toLowerCase())
        ),
      }
    : scenario === 'wifi_channel_diagnostics'
    ? {
        qualifiedWifiDiagnosticSucceeded: diagnosticPathSucceeded,
        singleQualifiedWifiDiagnosticAttempt: expectedToolAudits.length === 1,
        singleCachedRecoveryAttempt: cachedToolAudits.length <= 1,
        cachedRecoverySucceededWhenLiveFailed: expectedToolSucceeded || cachedToolSucceeded,
        responseContainsChannelAnalysis: (
          /\b(canal|channel)\b/.test(normalizedResponse)
          && /\b(rede|wifi|wi-fi|interfer|sinal|vizinh)\b/.test(normalizedResponse)
        ),
      }
    : {
        qualifiedWifiViewSucceeded: expectedToolSucceeded,
        singleQualifiedWifiViewAttempt: expectedToolAudits.length === 1,
        responseContainsCredentialLabels: (
          /\b(senha|password)\b/.test(normalizedResponse)
          && /\b(ssid|rede|usuario|login)\b/.test(normalizedResponse)
        ),
      };
  const primaryDeliveries = responseDeliveries.rows.filter(
    (delivery) => delivery.delivery_key === 'primary',
  );
  const primaryDelivery = primaryDeliveries[0];
  const checks = {
    responsePersisted: Boolean(response.rows[0]),
    singlePrimaryResponseDelivery: primaryDeliveries.length === messages.length,
    durableResponseDeliverySent: primaryDeliveries.every((delivery) => delivery.status === 'sent'),
    responseBlocksFullyDelivered: (
      primaryDeliveries.every(
        (delivery) => Number(delivery.next_block_index) === Number(delivery.block_count),
      )
      && response.rows.length === primaryDeliveries.reduce(
        (total, delivery) => total + Number(delivery.block_count),
        0,
      )
    ),
    providerAcceptedEveryResponseBlock: (
      providerRequests.length === response.rows.length
      && providerRequests.every(
        (entry) => entry.path === `/message/sendText/${fakeInstanceName}`,
      )
    ),
    sgpValidationSucceeded: audits.some(
      (audit) => audit.toolName === 'sgp_fetch_contact_panel_data' && audit.status === 'success',
    ),
    ...scenarioChecks,
    responseIsNotRawJson: (
      !/^\s*[{[]/.test(responseText)
      && !/"(?:networks|neighbors|channel|signal|ssid)"\s*:/i.test(responseText)
    ),
    noDestructiveToolAttempt: destructiveAudits.length === 0,
    noPendingConfirmation: sensitiveConfirmationScenario
      ? Boolean(state.rows[0]?.pending_confirmation)
      : !state.rows[0]?.pending_confirmation,
    deterministicIntentWithoutLlmClassifier: !hasEvent('intent_classifier_ai'),
    operationalRagWasSkipped: hasEvent(
      'rag_retrieval',
      (payload) => payload.status === 'skipped'
        || payload.reason === 'deterministic_operational_turn',
    ),
    unrelatedCloseGateWasSkipped: !hasEvent('close_intent_gate'),
    requiredToolFailureTerminatesSafely: (
      scenario === 'contract_mismatch'
      || sensitiveConfirmationScenario
      || (['wifi_channel_diagnostics', 'wifi_branch_switch'].includes(scenario) ? diagnosticPathSucceeded : expectedToolSucceeded)
      || hasEvent('required_tool_failure_terminal')
    ),
    requiredToolFailureHandsOff: (
      scenario === 'contract_mismatch'
      || sensitiveConfirmationScenario
      || (['wifi_channel_diagnostics', 'wifi_branch_switch'].includes(scenario) ? diagnosticPathSucceeded : expectedToolSucceeded)
      || (
      hasEvent('required_tool_failure_terminal', (payload) => payload.handoffTriggered === true)
      && finalChatState.rows[0]?.status === 'gerais'
      && finalChatState.rows[0]?.is_autopilot_active === false
      && !finalChatState.rows[0]?.assigned_system_agent_id
      )
    ),
  };
  const failed = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);

  console.log(JSON.stringify({
    runLabel,
    scenario,
    sourceChatId,
    syntheticChatId: ids.chat,
    checks,
    toolAudit: audits,
    responseStatus: response.rows[0]?.api_message_status || null,
    responseCount: response.rows.length,
    responseDelivery: primaryDelivery || null,
    responseLength: responseText.length,
    responsePreview: redact(responseText),
    turnTrace: turnSnapshots.map((snapshot) => ({
      responsePreview: redact(snapshot.responseText),
      pendingConfirmation: snapshot.pendingConfirmation,
      pendingToolName: snapshot.pendingToolName
        ? snapshot.pendingToolName.replace(/^mcp:[^:]+:/, 'mcp:*:')
        : null,
      pendingArgumentNames: snapshot.pendingArgumentNames,
      executionToolNames: snapshot.executionToolNames.map((toolName) => (
        toolName.replace(/^mcp:[^:]+:/, 'mcp:*:')
      )),
    })),
    eventTrace: events.rows.map((event) => ({
      kind: event.kind,
      status: event.status,
      customerNeed: event.payload?.customerNeed || null,
      expectedNextAction: event.payload?.expectedNextAction || null,
      requiredToolNames: event.payload?.requiredToolNames || null,
      preResponseActions: event.payload?.preResponseActions || null,
      widenedAllowedToolNames: event.payload?.widenedAllowedToolNames || null,
      recentToolNames: event.payload?.metadata?.recentToolNames
        || event.payload?.toolNames
        || null,
      recentSgpMemoryMatchesCustomer: event.payload?.metadata?.recentSgpMemoryMatchesCustomer
        ?? null,
      recentSgpIdentityDiagnostics: event.payload?.metadata?.recentSgpIdentityDiagnostics
        || null,
      reason: redact(event.payload?.reason || event.payload?.fallbackReason || ''),
    })),
    credentialsRedactedFromLog: true,
    cleanup: KEEP_DATA ? 'kept' : 'scheduled',
  }, null, 2));

  if (failed.length > 0) {
    throw new Error(`Readonly replay failed: ${failed.join(', ')}`);
  }
}

async function main() {
  providerServer.listen(0, '127.0.0.1');
  await once(providerServer, 'listening');
  const providerAddress = providerServer.address();
  if (!providerAddress || typeof providerAddress === 'string') {
    throw new Error('Could not start readonly replay provider fixture.');
  }
  providerBaseUrl = `http://127.0.0.1:${providerAddress.port}`;
  const { createQueueWorker } = await import('../src/lib/queue/worker');
  const { createAiQueueWorker } = await import('../src/lib/queue/ai-worker');
  const queueWorker = createQueueWorker();
  const aiQueueWorker = createAiQueueWorker();
  await Promise.all([
    queueWorker.worker.waitUntilReady(),
    aiQueueWorker.worker.waitUntilReady(),
  ]);
  const client = await pool.connect();
  let source: SourceContext | null = null;
  let seeded = false;
  try {
    source = await loadSourceContext(client);
    await cleanupStaleReplays(client, source);
    await seedReplay(client, source);
    seeded = true;
    await runReplay(client, source);
  } finally {
    if (seeded && source && !KEEP_DATA) {
      await cleanupReplay(client, source.workspaceId);
    }
    await cleanupProviderFixture(client);
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
  }
}

main().then(() => {
  process.exit(0);
}).catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
