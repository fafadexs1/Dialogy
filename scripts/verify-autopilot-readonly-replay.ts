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
  'greeting',
  'catalog_continuation',
  'commercial_registration_continuation',
  'commercial_completion',
  'clinical_red_flag_handoff',
  'contextual_close_reply',
  'generic_troubleshooting',
  'close_conversation',
  'transfer_handoff',
  'wifi_credentials',
  'wifi_credentials_after_identifier',
  'wifi_channel_diagnostics',
  'wifi_branch_switch',
  'reboot_confirmation',
  'wifi_change_confirmation',
  'contract_mismatch',
].includes(scenario)) {
  throw new Error('Unknown readonly replay scenario.');
}
const identityFreeScenario = [
  'greeting',
  'catalog_continuation',
  'commercial_registration_continuation',
  'commercial_completion',
  'clinical_red_flag_handoff',
  'contextual_close_reply',
  'generic_troubleshooting',
  'close_conversation',
  'transfer_handoff',
].includes(scenario);

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
  agentName: string;
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
            COALESCE(sa.name, ac.name, 'Autopilot Readonly Replay') AS agent_name,
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
  const document = requestedDocument || findDocument(messageResult.rows) || '';
  if (!document && !identityFreeScenario) {
    throw new Error('No CPF/CNPJ was found in the source conversation.');
  }
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
  if (!cpfFieldId && !identityFreeScenario) {
    throw new Error('Active SGP integration has no cpfFieldId mapping.');
  }

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
  const selectedTool = identityFreeScenario
    ? null
    : scenario === 'wifi_channel_diagnostics'
    ? wifiDiagnostic
    : scenario === 'reboot_confirmation'
      ? rebootTool
      : scenario === 'wifi_change_confirmation'
        ? wifiChangeTool
        : wifiView;
  const safety = selectedTool
    ? classifyMcpToolSafety(String(selectedTool.qualifiedName || ''), selectedTool)
    : null;
  const isSensitiveConfirmationScenario = ['reboot_confirmation', 'wifi_change_confirmation'].includes(scenario);
  if (
    !identityFreeScenario &&
    !isSensitiveConfirmationScenario &&
    (safety?.riskLevel !== 'low' || safety?.sideEffect !== 'none')
  ) {
    throw new Error('get_wifi_view is not classified as a safe read-only tool.');
  }
  if (isSensitiveConfirmationScenario && safety?.sideEffect === 'none') {
    throw new Error('Sensitive confirmation scenario selected a read-only tool.');
  }

  return {
    workspaceId: String(row.workspace_id),
    contactId: String(row.contact_id),
    configId: String(row.config_id),
    configUserId: String(row.config_user_id),
    agentName: String(row.agent_name || 'Autopilot Readonly Replay'),
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
     ) VALUES ($1, $2, $3, $4, true, $5,
       'intelligent_attendant', true, $6)`,
    [
      ids.agent,
      source.workspaceId,
      source.agentName,
      `readonly-replay-${runLabel}`,
      source.configUserId,
      source.configId,
    ],
  );
  await client.query(
    `INSERT INTO contacts (
       id, workspace_id, name, email, phone, phone_number_jid, avatar_url, address
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      ids.contact,
      source.workspaceId,
      source.contactName,
      source.contactEmail || null,
      replayPhone,
      `${replayPhone}@s.whatsapp.net`,
      source.contactAvatar || null,
      source.contactAddress || null,
    ],
  );
  if (source.cpfFieldId && source.document && scenario !== 'wifi_credentials_after_identifier') {
    await client.query(
      `INSERT INTO contact_custom_field_values (contact_id, field_id, value)
       VALUES ($1, $2, $3)`,
      [ids.contact, source.cpfFieldId, source.document],
    );
  }
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
  await client.query(
    `DELETE FROM workflow_executions
      WHERE workspace_id = $1
        AND conversation_id = $2`,
    [workspaceId, target.chat],
  );
  const tables = [
    'autopilot_response_deliveries',
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
        AND sa.token LIKE 'readonly-replay-%'
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

async function seedConversationHistory(
  client: PoolClient,
  source: SourceContext,
  turns: Array<{ content: string; fromMe: boolean }>,
) {
  for (const [index, turn] of turns.entries()) {
    const secondsAgo = (turns.length - index) * 15;
    await client.query(
      `INSERT INTO messages (
         id, workspace_id, chat_id, type, content, from_me, is_read,
         instance_name, raw_payload, metadata, sender_system_agent_id, created_at
       ) VALUES (
         $1, $2, $3, 'text', $4, $5, true,
         $6, '{}'::jsonb, '{}'::jsonb, $7,
         clock_timestamp() - ($8::int * interval '1 second')
       )`,
      [
        randomUUID(),
        source.workspaceId,
        ids.chat,
        turn.content,
        turn.fromMe,
        fakeInstanceName,
        turn.fromMe ? ids.agent : null,
        secondsAgo,
      ],
    );
  }
}

async function seedSourceHistoryBeforeMessage(
  client: PoolClient,
  source: SourceContext,
  targetMessage: string,
) {
  const history = await client.query(
    `WITH target AS (
       SELECT created_at
         FROM messages
        WHERE workspace_id = $1
          AND chat_id = $2
          AND from_me = false
          AND LOWER(TRIM(content)) = LOWER(TRIM($3))
        ORDER BY created_at DESC
        LIMIT 1
     )
     SELECT content, from_me
       FROM messages
      WHERE workspace_id = $1
        AND chat_id = $2
        AND created_at < (SELECT created_at FROM target)
      ORDER BY created_at DESC
      LIMIT 20`,
    [source.workspaceId, sourceChatId, targetMessage],
  );
  if (history.rows.length === 0) {
    throw new Error(`No source history found before replay target: ${targetMessage}`);
  }
  await seedConversationHistory(
    client,
    source,
    history.rows.reverse().map((row) => ({
      content: String(row.content || ''),
      fromMe: row.from_me === true,
    })),
  );
}

async function runReplay(client: PoolClient, source: SourceContext) {
  const selectedQualifiedTools = (
    identityFreeScenario
      ? []
      : scenario === 'wifi_branch_switch'
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
  const credentialRequestWithoutIdentifier = 'Quero verificar o nome da rede Wi-Fi e a senha.';
  const credentialIdentifierReply = [
    `Meu CPF e ${source.document}.`,
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
  if (scenario === 'greeting') {
    await client.query(
      `INSERT INTO messages (
         id, workspace_id, chat_id, type, content, from_me, is_read,
         instance_name, raw_payload, metadata, created_at
       ) VALUES
         ($1, $2, $3, 'text', 'Qual o status do pedido ABCD-1234?', false, true, $4,
          '{}'::jsonb, '{}'::jsonb, clock_timestamp() - interval '3 minutes'),
         ($5, $2, $3, 'text', 'Atendimento transferido para TicketMaster.', true, true, $4,
          '{}'::jsonb, '{}'::jsonb, clock_timestamp() - interval '2 minutes')`,
      [randomUUID(), source.workspaceId, ids.chat, fakeInstanceName, randomUUID()],
    );
  }
  if (scenario === 'catalog_continuation') {
    await client.query(
      `INSERT INTO messages (
         id, workspace_id, chat_id, type, content, from_me, is_read,
         instance_name, raw_payload, metadata, sender_system_agent_id, created_at
       ) VALUES
         ($1, $2, $3, 'text',
          'Temos os planos de 500, 600, 800 e 1000 mega. O plano de 1000 mega inclui Wi-Fi 6.',
          true, true, $4, '{}'::jsonb, '{}'::jsonb, $5,
          clock_timestamp() - interval '2 minutes')`,
      [randomUUID(), source.workspaceId, ids.chat, fakeInstanceName, ids.agent],
    );
  }
  if (scenario === 'commercial_registration_continuation') {
    await client.query(
      `INSERT INTO messages (
         id, workspace_id, chat_id, type, content, from_me, is_read,
         instance_name, raw_payload, metadata, sender_system_agent_id, created_at
       ) VALUES
         ($1, $2, $3, 'text',
          'Ja localizei os dados necessarios. Vou seguir com o atendimento usando as informacoes disponiveis e aviso antes de executar qualquer acao sensivel.',
          true, true, $4, '{}'::jsonb, '{}'::jsonb, $5,
          clock_timestamp() - interval '4 minutes'),
         ($6, $2, $3, 'text',
          'Meu bairro e Centro em Cidade Ocidental. Eu queria esse plano de 1000 MEGA.',
          false, true, $4, '{}'::jsonb, '{}'::jsonb, NULL,
          clock_timestamp() - interval '2 minutes'),
         ($7, $2, $3, 'text',
          'Agora, para finalizarmos, so preciso que voce me informe seu endereco completo com numero, por favor.',
          true, true, $4, '{}'::jsonb, '{}'::jsonb, $5,
          clock_timestamp() - interval '1 minute')`,
      [
        randomUUID(),
        source.workspaceId,
        ids.chat,
        fakeInstanceName,
        ids.agent,
        randomUUID(),
        randomUUID(),
      ],
    );
    await client.query(
      `INSERT INTO agent_tool_executions (
         workspace_id, chat_id, system_agent_id, autopilot_config_id,
         tool_name, status, input, output, requires_human_approval, created_at
       ) VALUES (
         $1, $2, $3, $4, 'sgp_fetch_contact_panel_data', 'success',
         '{"type":"sgp_fetch_contact_panel_data","payload":{}}'::jsonb,
         '{"contracts":[{"id":"historical-contract","connectionStatus":"online"}]}'::jsonb,
         false, clock_timestamp() - interval '3 minutes'
       )`,
      [source.workspaceId, ids.chat, ids.agent, source.configId],
    );
  }
  if (scenario === 'commercial_completion') {
    await seedSourceHistoryBeforeMessage(client, source, 'Pode sim');
  }
  if (scenario === 'clinical_red_flag_handoff') {
    await seedSourceHistoryBeforeMessage(client, source, 'Já te falei hoje as 19h00');
  }
  if (scenario === 'contextual_close_reply') {
    await seedSourceHistoryBeforeMessage(client, source, 'Não, somente!');
  }
  const messages = scenario === 'greeting'
    ? ['Fala ai galera']
    : scenario === 'catalog_continuation'
      ? ['Esse de 1000 parece ser perfeito pra mim']
    : scenario === 'commercial_registration_continuation'
      ? ['Quadra 12, Lote 13. Residencial Morada das Garcas']
    : scenario === 'commercial_completion'
      ? ['Pode sim']
    : scenario === 'clinical_red_flag_handoff'
      ? ['Já te falei hoje as 19h00']
    : scenario === 'contextual_close_reply'
      ? ['Não, somente!']
    : scenario === 'generic_troubleshooting'
      ? ['A internet da minha fibra esta toda hora falhando. Voce pode me ajudar?']
    : scenario === 'close_conversation'
      ? ['Valeu, pode encerrar']
    : scenario === 'transfer_handoff'
      ? ['Quero falar com um atendente humano']
    : scenario === 'wifi_branch_switch'
    ? [credentialMessage, diagnosticMessage]
    : scenario === 'wifi_credentials_after_identifier'
      ? [credentialRequestWithoutIdentifier, credentialIdentifierReply]
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
      name: source.contactName,
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
  const procedureExecutions = await client.query(
    `SELECT procedure_name, status, step_history
       FROM procedure_executions
      WHERE workspace_id = $1
        AND chat_id = $2
        AND created_at >= $3
      ORDER BY created_at ASC`,
    [source.workspaceId, ids.chat, startedAt],
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
  const expectedToolName = identityFreeScenario
    ? null
    : ['wifi_channel_diagnostics', 'wifi_branch_switch'].includes(scenario)
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
  const scenarioChecks = scenario === 'wifi_credentials_after_identifier'
    ? {
        firstTurnRequestedCpf: (
          /\b(cpf|cnpj|documento|identificador)\b/.test(firstTurnResponse)
          && /\b(informe|envie|confirme|preciso|necessario|necessário)\b/.test(firstTurnResponse)
        ),
        firstTurnDidNotCallSgp: !firstTurnSnapshot?.executionToolNames.includes(
          'sgp_fetch_contact_panel_data',
        ),
        secondTurnValidatedCustomer: secondTurnSnapshot?.executionToolNames.includes(
          'sgp_fetch_contact_panel_data',
        ) === true,
        secondTurnReadWifi: secondTurnSnapshot?.executionToolNames.includes(
          source.qualifiedWifiViewTool || '',
        ) === true,
        requestedContractWasUsed: executions.rows.some((execution) => (
          requestedToolName(execution) === 'sgp_fetch_contact_panel_data'
          && String(execution.input?.payload?.contractId || '') === String(source.contractId || '')
        )),
        secondResponseContainsWifiNameAndPassword: (
          /\b(ssid|nome da rede|rede wi-fi|wifi|wi-fi)\b/.test(secondTurnResponse)
          && /\b(senha|password)\b/.test(secondTurnResponse)
        ),
      }
    : scenario === 'greeting'
    ? {
        llmResponseStarted: hasEvent('llm_response_start'),
        llmResponseCompleted: events.rows.some(
          (event) => event.kind === 'llm_response' && event.status === 'success',
        ),
        turnPlanContinuesToLlm: events.rows.some(
          (event) => (
            event.kind === 'turn_plan'
            && event.payload?.customerNeed === 'none'
            && event.payload?.expectedNextAction === 'continue_llm'
          ),
        ),
        noFalseOrderStatusPlan: !events.rows.some(
          (event) => event.kind === 'turn_plan' && event.payload?.customerNeed === 'order_status_lookup',
        ),
        noAutomaticHandoff: (
          !audits.some((audit) => audit.toolName === 'transfer_chat')
          && finalChatState.rows[0]?.is_autopilot_active === true
          && finalChatState.rows[0]?.assigned_system_agent_id === ids.agent
        ),
        noSgpLookupForCasualOpening: !audits.some(
          (audit) => audit.toolName === 'sgp_fetch_contact_panel_data',
        ),
        responseDoesNotExposeSgpContracts: !/\b(contratos encontrados|dados operacionais|cliente:\s|contrato\s+\d+|\[object object\])\b/i.test(responseText),
        responseDoesNotPromiseManualLookup: !/\b(verificar manualmente|equipe comercial)\b/.test(normalizedResponse),
        noStructuredDelimiterMessageBlock: responseTexts.every(
          (text) => !/(?:^|:\s*)[{}\[\],]\s*$/.test(text.trim()),
        ),
      }
    : scenario === 'commercial_completion'
    ? {
        llmResponseStarted: hasEvent('llm_response_start'),
        llmResponseCompleted: events.rows.some(
          (event) => event.kind === 'llm_response' && event.status === 'success',
        ),
        noPrematureCloseExecution: !audits.some(
          (audit) => audit.toolName === 'close_chat',
        ),
        prematureCloseWasRejectedBeforeRuntime: hasEvent(
          'tool_planner',
          (payload) => Array.isArray(payload.rejectedActions) && payload.rejectedActions.some(
            (item: any) => item.tool === 'close_chat' && item.code === 'intent_not_allowed',
          ),
        ),
        chatRemainedOpenAndAssigned: (
          finalChatState.rows[0]?.status !== 'encerrados'
          && finalChatState.rows[0]?.is_autopilot_active === true
          && finalChatState.rows[0]?.assigned_system_agent_id === ids.agent
        ),
        responseConfirmsCommercialProgress: /\b(pre-cadastro|cadastro|contratacao|contratação|plano)\b/i.test(responseText),
        noCustomerVisibleToolFailure: !/\b(nao fiz nenhuma alteracao|não fiz nenhuma alteração|nao consegui encerrar|não consegui encerrar|sistema falhou)\b/i.test(responseText),
      }
    : scenario === 'clinical_red_flag_handoff'
    ? {
        llmResponseStarted: hasEvent('llm_response_start'),
        llmResponseCompleted: events.rows.some(
          (event) => event.kind === 'llm_response' && event.status === 'success',
        ),
        clinicalHistoryAuthorizedHandoff: hasEvent(
          'tool_planner',
          (payload) => payload.safetyCriticalHandoff === true,
        ),
        transferTargetWasHydrated: executions.rows.some(
          (execution) => (
            requestedToolName(execution) === 'transfer_chat'
            && Boolean(execution.input?.payload?.teamId)
          ),
        ),
        internalNoteSucceededBeforeTransfer: (
          audits.findIndex((audit) => audit.toolName === 'add_internal_note' && audit.status === 'success') >= 0
          && audits.findIndex((audit) => audit.toolName === 'add_internal_note' && audit.status === 'success')
            < audits.findIndex((audit) => audit.toolName === 'transfer_chat' && audit.status === 'success')
        ),
        transferChatSucceeded: audits.some(
          (audit) => audit.toolName === 'transfer_chat' && audit.status === 'success',
        ),
        autopilotReleasedAfterTransfer: (
          finalChatState.rows[0]?.is_autopilot_active === false
          && !finalChatState.rows[0]?.assigned_system_agent_id
        ),
        responseIsTerminalAndClinicallySafe: (
          /\b(pronto-socorro|sinais de alerta|urgencia|urgência)\b/i.test(responseText)
          && /\b(transfer|encaminh|equipe humana)\b/i.test(responseText)
        ),
        noRepeatedTimeQuestion: !/\bqual horario especifico|qual horário específico\b/i.test(responseText),
        noCustomerVisibleToolFailure: !/\b(nao consegui|não consegui|sistema falhou|faltam dados ou contexto)\b/i.test(responseText),
      }
    : scenario === 'contextual_close_reply'
    ? {
        closeChatSucceeded: audits.some(
          (audit) => audit.toolName === 'close_chat' && audit.status === 'success',
        ),
        closeChatExecutedExactlyOnce: audits.filter(
          (audit) => audit.toolName === 'close_chat',
        ).length === 1,
        chatWasActuallyClosed: finalChatState.rows[0]?.status === 'encerrados',
        noRepeatedAnythingElseQuestion: !/\bposso ajudar em mais alguma coisa\b/i.test(responseText),
        noCustomerVisibleToolFailure: !/\b(nao consegui|não consegui|sistema falhou)\b/i.test(responseText),
      }
    : scenario === 'close_conversation'
    ? {
        closeChatSucceeded: audits.some(
          (audit) => audit.toolName === 'close_chat' && audit.status === 'success',
        ),
        closeChatExecutedExactlyOnce: audits.filter(
          (audit) => audit.toolName === 'close_chat',
        ).length === 1,
        chatWasActuallyClosed: finalChatState.rows[0]?.status === 'encerrados',
        dedicatedCloseGateApproved: hasEvent(
          'close_intent_gate',
          (payload) => payload.decision?.execute === true,
        ) || (
          audits.some((audit) => audit.toolName === 'close_chat' && audit.status === 'success')
          && hasEvent('tool_execution')
        ),
        noSgpLookupForCloseRequest: !audits.some(
          (audit) => audit.toolName === 'sgp_fetch_contact_panel_data',
        ),
        noCancellationCatalogFallback: !/\b(ferramenta mcp|catalogo de cancelamento|verificar manualmente)\b/i.test(responseText),
      }
    : scenario === 'transfer_handoff'
    ? {
        transferChatSucceeded: audits.some(
          (audit) => audit.toolName === 'transfer_chat' && audit.status === 'success',
        ),
        transferChatExecutedExactlyOnce: audits.filter(
          (audit) => audit.toolName === 'transfer_chat',
        ).length === 1,
        autopilotReleasedAfterTransfer: (
          finalChatState.rows[0]?.is_autopilot_active === false
          && !finalChatState.rows[0]?.assigned_system_agent_id
        ),
        noSgpLookupForHumanRequest: !audits.some(
          (audit) => audit.toolName === 'sgp_fetch_contact_panel_data',
        ),
      }
    : scenario === 'catalog_continuation'
    ? {
        llmResponseStarted: hasEvent('llm_response_start'),
        llmResponseCompleted: events.rows.some(
          (event) => event.kind === 'llm_response' && event.status === 'success',
        ),
        turnPlanContinuesToLlmWithoutTools: events.rows.some(
          (event) => (
            event.kind === 'turn_plan'
            && event.payload?.customerNeed === 'generic_external_lookup'
            && event.payload?.expectedNextAction === 'continue_llm'
            && Array.isArray(event.payload?.requiredToolNames)
            && event.payload.requiredToolNames.length === 0
            && Array.isArray(event.payload?.preResponseActions)
            && event.payload.preResponseActions.length === 0
          ),
        ),
        workflowContinuesToLlm: events.rows.some(
          (event) => (
            event.kind === 'workflow_plan'
            && event.payload?.executionMode === 'continue_llm'
          ),
        ),
        noToolWasExecutedBeforeOrAfterLlm: audits.length === 0,
        noSgpCustomerLookup: !audits.some(
          (audit) => audit.toolName === 'sgp_fetch_contact_panel_data',
        ),
        noDeterministicFlowMessageBypass: !events.rows.some(
          (event) => (
            event.kind === 'message_send'
            && event.payload?.deterministicFlowMessage === true
          ),
        ),
        responseAcknowledgesSelectedPlan: /\b(1000|1\s*giga|plano)\b/i.test(responseText),
        responseDoesNotExposeOperationalCustomerData: !/\b(contratos encontrados|dados operacionais|cliente:\s|contrato\s+\d+)\b/i.test(responseText),
      }
    : scenario === 'commercial_registration_continuation'
    ? {
        llmResponseStarted: hasEvent('llm_response_start'),
        llmResponseCompleted: events.rows.some(
          (event) => event.kind === 'llm_response' && event.status === 'success',
        ),
        workflowContinuesToLlm: events.rows.some(
          (event) => (
            event.kind === 'workflow_plan'
            && event.payload?.executionMode === 'continue_llm'
          ),
        ),
        noToolExecutedForAddressTurn: audits.length === 0,
        responseAdvancesRegistration: (
          responseText.includes('?')
          || /\b(cpf|cnpj|telefone|confirm|pre-cadastro|cadastro|finaliz|concluir|prosseguir)\b/i.test(responseText)
        ),
        noGenericLoopRefusal: !/\b(pausei esta tentativa|descreva o pedido com mais detalhes|solicite atendimento humano)\b/i.test(responseText),
        oldLookupDidNotForceGenericRepair: !/\bja localizei os dados necessarios\b/i.test(responseText),
        autopilotRemainedActive: (
          finalChatState.rows[0]?.is_autopilot_active === true
          && finalChatState.rows[0]?.assigned_system_agent_id === ids.agent
        ),
      }
    : scenario === 'generic_troubleshooting'
    ? {
        llmGeneratedCustomerResponse: events.rows.some(
          (event) => (
            ['procedure_llm_response', 'llm_response'].includes(event.kind)
            && event.status === 'success'
          ),
        ),
        didNotSelectOpticalLosProcedure: !procedureExecutions.rows.some(
          (execution) => /\b(los|loss|luz vermelha)\b/i.test(String(execution.procedure_name || '')),
        ),
        diagnosticProcedureDidNotRaceAhead: (
          procedureExecutions.rows.length === 0
          || procedureExecutions.rows.some(
            (execution) => (
              execution.status === 'waiting_input'
              && Array.isArray(execution.step_history)
              && execution.step_history.some((step: any) => step.status === 'waiting')
            ),
          )
        ),
        noAutomaticHandoffOrInternalNote: !audits.some(
          (audit) => ['transfer_chat', 'add_internal_note'].includes(audit.toolName),
        ),
        autopilotRemainedActive: (
          finalChatState.rows[0]?.is_autopilot_active === true
          && finalChatState.rows[0]?.assigned_system_agent_id === ids.agent
        ),
        responseIsUsefulDiagnosticQuestion: (
          responseText.includes('?')
          && /\b(internet|conexao|fibra|modem|roteador|dispositivo|cabo|luz|queda|falha)\b/i.test(responseText)
        ),
        noProcedureOrLoopLeakage: !/\b(procedimento|instrucao operacional|etapa automatica|evitar repetir|pausei esta tentativa)\b/i.test(responseText),
      }
    : scenario === 'contract_mismatch'
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
  const expectedDeliveries = scenario === 'close_conversation'
    ? responseDeliveries.rows.filter((delivery) => delivery.delivery_key === 'explicit-close')
    : primaryDeliveries;
  const primaryDelivery = primaryDeliveries[0];
  const checks = {
    responsePersisted: Boolean(response.rows[0]),
    singlePrimaryResponseDelivery: scenario === 'wifi_credentials_after_identifier'
      ? response.rows.length === messages.length
      : scenario === 'greeting'
      ? primaryDeliveries.length >= 1
      : expectedDeliveries.length === messages.length,
    durableResponseDeliverySent: expectedDeliveries.every((delivery) => delivery.status === 'sent'),
    responseBlocksFullyDelivered: scenario === 'wifi_credentials_after_identifier'
      ? providerRequests.length === response.rows.length && response.rows.length === messages.length
      : (
      expectedDeliveries.every(
        (delivery) => Number(delivery.next_block_index) === Number(delivery.block_count),
      )
      && (
        ['greeting', 'clinical_red_flag_handoff'].includes(scenario)
          ? response.rows.length >= primaryDeliveries.reduce(
              (total, delivery) => total + Number(delivery.block_count),
              0,
            )
          : response.rows.length === expectedDeliveries.reduce(
              (total, delivery) => total + Number(delivery.block_count),
              0,
            )
      )
    ),
    providerAcceptedEveryResponseBlock: (
      providerRequests.length === response.rows.length
      && providerRequests.every(
        (entry) => entry.path === `/message/sendText/${fakeInstanceName}`,
      )
    ),
    sgpValidationSucceeded: identityFreeScenario || audits.some(
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
    intentClassifierRoutingExpected: scenario === 'greeting'
      ? hasEvent('intent_classifier_ai')
      : [
          'generic_troubleshooting',
          'catalog_continuation',
          'commercial_registration_continuation',
          'commercial_completion',
          'clinical_red_flag_handoff',
          'contextual_close_reply',
          'close_conversation',
          'wifi_credentials_after_identifier',
        ].includes(scenario)
        ? true
        : !hasEvent('intent_classifier_ai'),
    operationalRagWasSkipped: scenario === 'wifi_credentials_after_identifier' || identityFreeScenario || hasEvent(
      'rag_retrieval',
      (payload) => payload.status === 'skipped'
        || payload.reason === 'deterministic_operational_turn',
    ),
    unrelatedCloseGateWasSkipped: ['close_conversation', 'contextual_close_reply'].includes(scenario)
      ? true
      : !hasEvent('close_intent_gate'),
    requiredToolFailureTerminatesSafely: (
      identityFreeScenario
      || scenario === 'contract_mismatch'
      || sensitiveConfirmationScenario
      || (['wifi_channel_diagnostics', 'wifi_branch_switch'].includes(scenario) ? diagnosticPathSucceeded : expectedToolSucceeded)
      || hasEvent('required_tool_failure_terminal')
    ),
    requiredToolFailureHandsOff: (
      identityFreeScenario
      || scenario === 'contract_mismatch'
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
