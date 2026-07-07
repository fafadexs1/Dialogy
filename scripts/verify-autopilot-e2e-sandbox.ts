// Bypass Next.js server-only check in standalone Node.js script.
import module from 'module';
const originalRequire = module.prototype.require;
module.prototype.require = function patchedRequire(id) {
  if (id === 'server-only') {
    return {};
  }
  return originalRequire.call(this, id);
};

import 'dotenv/config';
import { randomUUID } from 'crypto';
import { Pool, type PoolClient } from 'pg';

process.env.AI_ORCHESTRATOR_RAG_TIMEOUT_MS ||= '2500';
process.env.AI_INTENT_CLASSIFIER_TIMEOUT_MS ||= '2500';
process.env.AI_WORKFLOW_CLASSIFIER_TIMEOUT_MS ||= '2500';
process.env.AI_ORCHESTRATOR_LLM_TIMEOUT_MS ||= '6000';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 15000,
});

const KEEP_DATA = process.env.AUTOPILOT_E2E_KEEP_DATA === 'true';
const RUN_LABEL = `codex-e2e-${Date.now()}`;
const userId = randomUUID();
const workspaceId = randomUUID();
const configId = randomUUID();
const systemAgentId = randomUUID();
const contactId = randomUUID();
const chatId = randomUUID();
const messageId = randomUUID();
const instanceName = `${RUN_LABEL}-instance`;
const customerMessage = 'Minha internet travando no Wi-Fi e muito lenta';

const flowGraph = {
  version: 1,
  nodes: [
    {
      id: 'incoming',
      kind: 'trigger',
      title: 'Mensagem recebida',
      subtitle: 'Inicio',
      position: { x: 0, y: 0 },
    },
    {
      id: 'wifi-intent',
      kind: 'intent',
      title: 'Atendimento Wi-Fi',
      subtitle: 'Suporte',
      position: { x: 160, y: 0 },
      config: {
        intent: 'troubleshooting',
        instructions: 'Resolva problemas de Wi-Fi seguindo a rota escolhida pelo Switch.',
      },
    },
    {
      id: 'wifi-switch',
      kind: 'switch',
      title: 'Classificar problema Wi-Fi',
      subtitle: 'Rotas',
      position: { x: 320, y: 0 },
      config: {
        instructions: 'Escolha se o cliente quer alterar nome/senha ou diagnosticar lentidao.',
        confidenceThreshold: 0.65,
        fallbackRouteId: 'outro',
        routes: [
          {
            id: 'alterar_wifi',
            label: 'Alterar nome e senha do Wi-Fi',
            description: 'Cliente quer trocar SSID, nome da rede, senha ou credenciais.',
            examples: ['trocar senha do wifi', 'mudar nome da rede'],
            targetNodeId: 'alterar-intent',
          },
          {
            id: 'lentidao_wifi',
            label: 'Lentidao no Wi-Fi',
            description: 'Cliente relata internet lenta, oscilando, travando ou sinal fraco.',
            examples: ['wifi lento', 'internet travando'],
            targetNodeId: 'lentidao-intent',
          },
          {
            id: 'outro',
            label: 'Outro problema',
            description: 'Use quando nao houver evidencia suficiente.',
            targetNodeId: 'outro-intent',
          },
        ],
      },
    },
    {
      id: 'alterar-intent',
      kind: 'intent',
      title: 'Alterar Wi-Fi',
      subtitle: 'Coleta',
      position: { x: 520, y: -120 },
      config: {
        intent: 'troubleshooting',
        instructions: 'Colete novo nome e nova senha do Wi-Fi.',
      },
    },
    {
      id: 'alterar-message',
      kind: 'send_message',
      title: 'Coletar dados do Wi-Fi',
      subtitle: 'Resposta',
      position: { x: 720, y: -120 },
      config: {
        message: 'Claro. Me envie o novo nome da rede e a nova senha que deseja usar.',
      },
    },
    {
      id: 'lentidao-intent',
      kind: 'intent',
      title: 'Diagnosticar lentidao',
      subtitle: 'Suporte',
      position: { x: 520, y: 80 },
      config: {
        intent: 'troubleshooting',
        instructions: 'Conduza diagnostico de lentidao no Wi-Fi.',
      },
    },
    {
      id: 'lentidao-message',
      kind: 'send_message',
      title: 'Iniciar diagnostico',
      subtitle: 'Resposta',
      position: { x: 720, y: 80 },
      config: {
        message: 'Vou iniciar o diagnostico de lentidao do Wi-Fi. Primeiro, confirme se a lentidao acontece perto ou longe do roteador.',
      },
    },
    {
      id: 'outro-intent',
      kind: 'intent',
      title: 'Entender melhor',
      subtitle: 'Fallback',
      position: { x: 520, y: 260 },
      config: {
        intent: 'support_request',
        instructions: 'Pergunte mais detalhes.',
      },
    },
    {
      id: 'outro-message',
      kind: 'send_message',
      title: 'Perguntar detalhes',
      subtitle: 'Fallback',
      position: { x: 720, y: 260 },
      config: {
        message: 'Me conte um pouco melhor o que aconteceu para eu direcionar seu atendimento.',
      },
    },
  ],
  edges: [
    { id: 'incoming-intent', source: 'incoming', target: 'wifi-intent' },
    { id: 'intent-switch', source: 'wifi-intent', target: 'wifi-switch' },
    { id: 'switch-alterar', source: 'wifi-switch', target: 'alterar-intent', routeId: 'alterar_wifi' },
    { id: 'alterar-response', source: 'alterar-intent', target: 'alterar-message' },
    { id: 'switch-lentidao', source: 'wifi-switch', target: 'lentidao-intent', routeId: 'lentidao_wifi' },
    { id: 'lentidao-response', source: 'lentidao-intent', target: 'lentidao-message' },
    { id: 'switch-outro', source: 'wifi-switch', target: 'outro-intent', routeId: 'outro' },
    { id: 'outro-response', source: 'outro-intent', target: 'outro-message' },
  ],
};

async function deleteWorkspaceData(client: PoolClient) {
  const tables = [
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
  ];

  await client.query('UPDATE users SET last_active_workspace_id = NULL WHERE id = $1', [userId]);

  for (const table of tables) {
    try {
      await client.query(`DELETE FROM ${table} WHERE workspace_id = $1`, [workspaceId]);
    } catch (error: any) {
      if (error?.code !== '42P01' && error?.code !== '42703') {
        throw error;
      }
    }
  }

  await client.query('DELETE FROM workspaces WHERE id = $1', [workspaceId]);
  await client.query('DELETE FROM users WHERE id = $1', [userId]);
}

async function seedSandbox(client: PoolClient) {
  await client.query(
    `INSERT INTO users (id, full_name, email, avatar_url, is_superadmin)
     VALUES ($1, $2, $3, '', false)`,
    [userId, 'Codex E2E User', `${RUN_LABEL}@example.invalid`],
  );

  await client.query(
    `INSERT INTO workspaces (id, name, owner_id)
     VALUES ($1, $2, $3)`,
    [workspaceId, `Codex Autopilot E2E ${RUN_LABEL}`, userId],
  );

  await client.query(
    `UPDATE users
     SET last_active_workspace_id = $1
     WHERE id = $2`,
    [workspaceId, userId],
  );

  const roleRes = await client.query(
    `INSERT INTO roles (workspace_id, name, description, is_default)
     VALUES ($1, 'Owner', 'Synthetic owner role for Codex E2E', true)
     RETURNING id`,
    [workspaceId],
  );

  await client.query(
    `INSERT INTO user_workspace_roles (user_id, workspace_id, role_id)
     VALUES ($1, $2, $3)`,
    [userId, workspaceId, roleRes.rows[0].id],
  );

  await client.query(
    `INSERT INTO autopilot_configs (
        id, workspace_id, user_id, name, ai_model, knowledge_base, knowledge_base_documents,
        is_primary, is_active, is_private, default_fallback_reply, enabled_tool_names,
        flow_graph, knowledge_collections, tool_mode
     ) VALUES (
        $1, $2, $3, 'Codex E2E Switch Agent', 'googleai/gemini-2.5-flash-lite',
        'Base sintetica para validar Switch Wi-Fi.', '[]'::jsonb,
        true, true, false, 'Vou encaminhar seu atendimento para um humano.', '[]'::jsonb,
        $4::jsonb, '[]'::jsonb, 'on_demand'
     )`,
    [configId, workspaceId, userId, JSON.stringify(flowGraph)],
  );

  await client.query(
    `INSERT INTO system_agents (
        id, workspace_id, name, token, is_active, created_by_id, type,
        hide_from_chatlist, autopilot_config_id
     ) VALUES ($1, $2, 'Codex E2E IA', $3, true, $4, 'intelligent_attendant', false, $5)`,
    [systemAgentId, workspaceId, `codex-token-${RUN_LABEL}`, userId, configId],
  );

  await client.query(
    `INSERT INTO contacts (id, workspace_id, name, phone, phone_number_jid)
     VALUES ($1, $2, 'Cliente Codex E2E', '5500000000000', '5500000000000@s.whatsapp.net')`,
    [contactId, workspaceId],
  );

  await client.query(
    `INSERT INTO chats (
        id, workspace_id, contact_id, status, is_autopilot_active,
        autopilot_config_id, copilot_mode, assigned_system_agent_id,
        source, instance_type, unread_count
     ) VALUES ($1, $2, $3, 'atendimentos', true, $4, 'auto', $5, 'whatsapp', 'baileys', 0)`,
    [chatId, workspaceId, contactId, configId, systemAgentId],
  );

  await client.query(
    `INSERT INTO messages (
        id, workspace_id, chat_id, type, content, from_me, is_read,
        instance_name, raw_payload, metadata
     ) VALUES ($1, $2, $3, 'text', $4, false, true, $5, '{}'::jsonb, '{}'::jsonb)`,
    [messageId, workspaceId, chatId, customerMessage, instanceName],
  );
}

async function assertSandboxResult(client: PoolClient) {
  const summaryRes = await client.query(
    `SELECT
       (SELECT count(*)::int FROM messages WHERE workspace_id = $1 AND chat_id = $2 AND from_me = true) AS outbound_messages,
       (SELECT count(*)::int FROM orchestrator_runs WHERE workspace_id = $1 AND chat_id = $2) AS orchestrator_runs,
       (SELECT count(*)::int FROM agent_decision_ledger WHERE workspace_id = $1 AND chat_id = $2) AS decision_ledger_rows,
       (SELECT count(*)::int FROM orchestrator_events WHERE workspace_id = $1 AND chat_id = $2 AND kind = 'switch_resolution') AS switch_events`,
    [workspaceId, chatId],
  );
  const summary = summaryRes.rows[0];

  const switchRes = await client.query(
    `SELECT payload
     FROM orchestrator_events
     WHERE workspace_id = $1
       AND chat_id = $2
       AND kind = 'switch_resolution'
     ORDER BY created_at DESC
     LIMIT 1`,
    [workspaceId, chatId],
  );
  const switchPayload = switchRes.rows[0]?.payload || {};

  const ledgerRes = await client.query(
    `SELECT decision_type, goal, metadata
     FROM agent_decision_ledger
     WHERE workspace_id = $1
       AND chat_id = $2
     ORDER BY created_at DESC
     LIMIT 1`,
    [workspaceId, chatId],
  );
  const latestDecision = ledgerRes.rows[0] || {};
  const ledgerSwitch = latestDecision.metadata?.switchResolution || null;

  const responseRes = await client.query(
    `SELECT content, api_message_status, metadata
     FROM messages
     WHERE workspace_id = $1
       AND chat_id = $2
       AND from_me = true
       AND sender_system_agent_id = $3
     ORDER BY created_at DESC
     LIMIT 1`,
    [workspaceId, chatId, systemAgentId],
  );
  const response = responseRes.rows[0] || {};

  const checks = {
    outboundMessagePersisted: Number(summary.outbound_messages) >= 1,
    orchestratorRunCreated: Number(summary.orchestrator_runs) >= 1,
    decisionLedgerCreated: Number(summary.decision_ledger_rows) >= 1,
    switchEventCreated: Number(summary.switch_events) >= 1,
    switchChoseSlowWifi: switchPayload.routeId === 'lentidao_wifi',
    ledgerCapturedSwitch: ledgerSwitch?.routeId === 'lentidao_wifi',
    responseMentionsDiagnostic: String(response.content || '').toLowerCase().includes('diagnostico'),
  };

  const failed = Object.entries(checks)
    .filter(([, ok]) => !ok)
    .map(([name]) => name);

  const result = {
    runLabel: RUN_LABEL,
    workspaceId,
    chatId,
    messageId,
    checks,
    summary,
    switchRoute: switchPayload.routeId || null,
    ledgerDecisionType: latestDecision.decision_type || null,
    ledgerGoal: latestDecision.goal || null,
    responseStatus: response.api_message_status || null,
    responsePreview: String(response.content || '').slice(0, 180),
    cleanup: KEEP_DATA ? 'kept' : 'scheduled',
  };

  console.log(JSON.stringify(result, null, 2));

  if (failed.length > 0) {
    throw new Error(`Autopilot E2E sandbox failed checks: ${failed.join(', ')}`);
  }
}

async function main() {
  console.log(`[E2E] Starting sandbox ${RUN_LABEL}`);
  const client = await pool.connect();
  let seeded = false;
  try {
    console.log('[E2E] Seeding synthetic workspace/chat/agent');
    await seedSandbox(client);
    seeded = true;

    const chatObj = {
      id: chatId,
      workspace_id: workspaceId,
      status: 'atendimentos',
      source: 'whatsapp',
      instance_type: 'baileys',
      agentId: null,
      assigned_system_agent_id: systemAgentId,
      is_autopilot_active: true,
      autopilot_config_id: configId,
      copilot_mode: 'auto',
      messages: [],
      contact: {
        id: contactId,
        name: 'Cliente Codex E2E',
        email: '',
        phone_number_jid: '5500000000000@s.whatsapp.net',
        avatar_url: '',
        address: '',
      },
    };

    const { processAutopilotForChat } = await import('../src/services/autopilot-service');
    console.log('[E2E] Running processAutopilotForChat');
    await processAutopilotForChat(
      workspaceId,
      chatObj as any,
      customerMessage,
      instanceName,
      messageId,
    );

    await new Promise((resolve) => setTimeout(resolve, 1200));
    console.log('[E2E] Asserting persisted runtime evidence');
    await assertSandboxResult(client);
  } finally {
    if (seeded && !KEEP_DATA) {
      console.log('[E2E] Cleaning synthetic data');
      await deleteWorkspaceData(client);
    }
    client.release();
    await pool.end();
  }
}

main().then(() => {
  process.exit(0);
}).catch(async (error) => {
  console.error(error);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
