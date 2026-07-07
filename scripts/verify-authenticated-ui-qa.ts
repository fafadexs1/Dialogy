import 'dotenv/config';

import { randomUUID } from 'crypto';
import { existsSync } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { chromium, type Browser, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { Pool, type PoolClient } from 'pg';

const BASE_URL = process.env.UI_QA_BASE_URL || 'http://localhost:9002';
const KEEP_DATA = process.env.UI_QA_KEEP_DATA === 'true';
const RUN_LABEL = `codex-ui-${Date.now()}`;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 15000,
});

const workspaceId = randomUUID();
const configId = randomUUID();
const systemAgentId = randomUUID();
let authUserId: string | null = null;

const email = `${RUN_LABEL}@example.invalid`;
const password = `CodexUi${randomUUID().slice(0, 8)}!a1`;

const flowGraph = {
  version: 1,
  nodes: [
    {
      id: 'incoming',
      kind: 'trigger',
      title: 'Mensagem recebida',
      position: { x: 0, y: 0 },
    },
    {
      id: 'wifi-switch',
      kind: 'switch',
      title: 'Classificar problema Wi-Fi',
      subtitle: 'Switch de suporte',
      position: { x: 260, y: 0 },
      config: {
        instructions: 'Escolha a rota conforme o problema de Wi-Fi relatado pelo cliente.',
        confidenceThreshold: 0.65,
        fallbackRouteId: 'outro',
        routes: [
          {
            id: 'alterar_wifi',
            label: 'Alterar nome e senha do Wi-Fi',
            description: 'Cliente quer trocar SSID, nome da rede ou senha.',
            examples: ['trocar senha do wifi', 'mudar nome da rede'],
            targetNodeId: 'alterar-message',
          },
          {
            id: 'lentidao_wifi',
            label: 'Lentidao no Wi-Fi',
            description: 'Cliente relata internet lenta, travando ou sinal fraco.',
            examples: ['wifi lento', 'internet travando'],
            targetNodeId: 'lentidao-message',
          },
          {
            id: 'outro',
            label: 'Outro problema',
            description: 'Use quando nao houver evidencia suficiente.',
            targetNodeId: 'outro-message',
          },
        ],
      },
    },
    {
      id: 'alterar-message',
      kind: 'send_message',
      title: 'Coletar dados',
      position: { x: 560, y: -120 },
      config: {
        message: 'Me envie o novo nome da rede e a nova senha desejada.',
      },
    },
    {
      id: 'lentidao-message',
      kind: 'send_message',
      title: 'Iniciar diagnostico',
      position: { x: 560, y: 80 },
      config: {
        message: 'Vou iniciar o diagnostico de lentidao do Wi-Fi.',
      },
    },
    {
      id: 'outro-message',
      kind: 'send_message',
      title: 'Entender melhor',
      position: { x: 560, y: 260 },
      config: {
        message: 'Me conte melhor o que aconteceu para eu direcionar o atendimento.',
      },
    },
  ],
  edges: [
    { id: 'incoming-switch', source: 'incoming', target: 'wifi-switch' },
    { id: 'switch-alterar', source: 'wifi-switch', target: 'alterar-message', routeId: 'alterar_wifi' },
    { id: 'switch-lentidao', source: 'wifi-switch', target: 'lentidao-message', routeId: 'lentidao_wifi' },
    { id: 'switch-outro', source: 'wifi-switch', target: 'outro-message', routeId: 'outro' },
  ],
};

function decodeJwtRole(token: string | undefined) {
  if (!token) return null;
  const [, payload] = token.split('.');
  if (!payload) return null;

  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return typeof decoded.role === 'string' ? decoded.role : null;
  } catch {
    return null;
  }
}

function getSupabaseAdminClient() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const keyCandidates = [
    process.env.SUPABASE_SECRET_KEY,
    process.env.SUPABASE_SECRET,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY,
  ].filter(Boolean) as string[];
  const serviceRoleKey = keyCandidates.find((key) => decodeJwtRole(key) === 'service_role');

  if (!url || !serviceRoleKey) {
    throw new Error('Missing Supabase URL or service role key for authenticated UI QA.');
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

function resolveChromiumLaunchOptions() {
  const explicitPath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  if (explicitPath && existsSync(explicitPath)) {
    return { executablePath: explicitPath };
  }

  const candidates = [
    path.join(process.env.PROGRAMFILES || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env.PROGRAMFILES || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ];

  const executablePath = candidates.find((candidate) => candidate && existsSync(candidate));

  return executablePath ? { executablePath } : {};
}

async function seedAuthUser() {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      full_name: 'Codex UI QA User',
    },
  });

  if (error || !data.user) {
    throw new Error(`Failed to create QA auth user: ${error?.message || 'missing user'}`);
  }

  authUserId = data.user.id;
}

async function deleteAuthUser() {
  if (!authUserId) return;

  const supabase = getSupabaseAdminClient();
  const { error } = await supabase.auth.admin.deleteUser(authUserId);

  if (error) {
    console.warn(`[UI_QA] Failed to delete auth user ${authUserId}: ${error.message}`);
  }
}

async function seedDatabase(client: PoolClient) {
  if (!authUserId) {
    throw new Error('Cannot seed database before auth user exists.');
  }

  await client.query(
    `INSERT INTO users (id, full_name, email, avatar_url, is_superadmin, last_active_workspace_id)
     VALUES ($1, 'Codex UI QA User', $2, '', false, NULL)
     ON CONFLICT (email) DO UPDATE
     SET
       full_name = EXCLUDED.full_name,
       avatar_url = COALESCE(users.avatar_url, EXCLUDED.avatar_url),
       is_superadmin = false`,
    [authUserId, email],
  );

  await client.query(
    `INSERT INTO workspaces (id, name, owner_id, vertical)
     VALUES ($1, $2, $3, 'isp')`,
    [workspaceId, `Codex UI QA Workspace ${RUN_LABEL}`, authUserId],
  );

  await client.query('UPDATE users SET last_active_workspace_id = $1 WHERE id = $2', [workspaceId, authUserId]);

  const roleRes = await client.query(
    `INSERT INTO roles (workspace_id, name, description, is_default)
     VALUES ($1, 'Owner', 'Synthetic owner role for Codex UI QA', true)
     RETURNING id`,
    [workspaceId],
  );

  await client.query(
    `INSERT INTO user_workspace_roles (user_id, workspace_id, role_id)
     VALUES ($1, $2, $3)`,
    [authUserId, workspaceId, roleRes.rows[0].id],
  );

  await client.query(
    `INSERT INTO autopilot_configs (
        id, workspace_id, user_id, name, ai_model, knowledge_base, knowledge_base_documents,
        is_primary, is_active, is_private, default_fallback_reply, enabled_tool_names,
        flow_graph, knowledge_collections, tool_mode
     ) VALUES (
        $1, $2, $3, 'Codex UI Switch Agent', 'googleai/gemini-2.5-flash-lite',
        'Base sintetica para QA visual do switch node.', '[]'::jsonb,
        true, true, false, 'Vou encaminhar seu atendimento para um humano.', '[]'::jsonb,
        $4::jsonb, '[]'::jsonb, 'on_demand'
     )`,
    [configId, workspaceId, authUserId, JSON.stringify(flowGraph)],
  );

  await client.query(
    `INSERT INTO system_agents (
        id, workspace_id, name, token, is_active, created_by_id, type,
        hide_from_chatlist, autopilot_config_id
     ) VALUES (
        $1, $2, 'Codex UI Switch Agent', $3, true, $4, 'autopilot',
        true, $5
     )`,
    [systemAgentId, workspaceId, `codex-ui-token-${RUN_LABEL}`, authUserId, configId],
  );
}

async function cleanupDatabase(client: PoolClient) {
  if (!authUserId) return;

  await client.query('UPDATE users SET last_active_workspace_id = NULL WHERE id = $1', [authUserId]);

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
  await client.query('DELETE FROM users WHERE id = $1', [authUserId]);
}

async function expectVisible(page: Page, selector: string, label: string) {
  const locator = page.locator(selector).first();
  await locator.waitFor({ state: 'visible', timeout: 60000 });

  return {
    label,
    visible: await locator.isVisible(),
  };
}

function isCriticalRequestFailure(entry: string) {
  if (entry.includes('net::ERR_ABORTED')) {
    return false;
  }

  return ![
    '/api/build-id',
    '/api/users/online-status',
    '/api/users/online/',
    '/_next/webpack-hmr',
  ].some((fragment) => entry.includes(fragment));
}

async function runUiQa() {
  const res = await fetch(`${BASE_URL}/login`);
  if (!res.ok) {
    throw new Error(`Dev server did not respond with OK on /login: ${res.status}`);
  }

  await fs.mkdir(path.join(process.cwd(), 'tmp'), { recursive: true });

  let browser: Browser | null = null;
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const failedRequests: string[] = [];

  try {
    browser = await chromium.launch({ headless: true, ...resolveChromiumLaunchOptions() });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1100 },
      baseURL: BASE_URL,
    });
    const page = await context.newPage();

    page.on('console', (message) => {
      if (message.type() === 'error') {
        consoleErrors.push(message.text());
      }
    });
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('requestfailed', (request) => {
      const url = request.url();
      if (!url.includes('/_next/webpack-hmr') && !url.startsWith('wss://')) {
        failedRequests.push(`${request.method()} ${url} :: ${request.failure()?.errorText || 'unknown'}`);
      }
    });

    await page.goto('/login', { waitUntil: 'domcontentloaded' });
    await page.locator('input[name="email"]').fill(email);
    await page.locator('input[name="password"]').fill(password);
    await page.getByRole('button', { name: /Entrar/i }).click();
    await page.waitForURL(/\/inbox(?:\?|$)/, { timeout: 60000 });

    const userResponse = await page.request.get('/api/user');
    const userJson = await userResponse.json();
    const apiUserLoaded = userResponse.ok() && userJson?.activeWorkspaceId === workspaceId;

    await page.goto('/settings/workspace', { waitUntil: 'domcontentloaded' });
    const workspaceHeading = await expectVisible(page, 'h1:has-text("Workspace")', 'workspace heading');
    await page.getByRole('tab', { name: /IA operacional/i }).click();
    const resourceMapperPanel = await expectVisible(
      page,
      'text=Aliases do Resource Mapper',
      'resource mapper aliases panel',
    );
    const workspaceScreenshot = path.join(process.cwd(), 'tmp', 'qa-auth-workspace.png');
    await page.screenshot({ path: workspaceScreenshot, fullPage: true });

    await page.goto(`/autopilot/${configId}`, { waitUntil: 'domcontentloaded' });
    const autopilotAgentName = await expectVisible(page, 'text=Codex UI Switch Agent', 'autopilot agent name');
    const switchRouteText = await expectVisible(page, 'text=Classificar problema Wi-Fi', 'switch node title');
    const autopilotScreenshot = path.join(process.cwd(), 'tmp', 'qa-auth-autopilot.png');
    await page.screenshot({ path: autopilotScreenshot, fullPage: true });

    const checks = {
      apiUserLoaded,
      workspaceHeading: workspaceHeading.visible,
      resourceMapperPanel: resourceMapperPanel.visible,
      autopilotAgentName: autopilotAgentName.visible,
      switchNodeVisible: switchRouteText.visible,
      noPageErrors: pageErrors.length === 0,
      noFailedCriticalRequests: failedRequests
        .filter((entry) => entry.includes(BASE_URL))
        .filter(isCriticalRequestFailure).length === 0,
    };

    const passed = Object.values(checks).every(Boolean);

    return {
      passed,
      runLabel: RUN_LABEL,
      baseUrl: BASE_URL,
      workspaceId,
      configId,
      checks,
      screenshots: {
        workspace: workspaceScreenshot,
        autopilot: autopilotScreenshot,
      },
      diagnostics: {
        consoleErrors: consoleErrors.slice(0, 10),
        pageErrors,
        failedRequests: failedRequests.slice(0, 10),
      },
    };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

async function main() {
  const client = await pool.connect();
  let result: Awaited<ReturnType<typeof runUiQa>> | null = null;

  try {
    console.log('[UI_QA] Creating synthetic auth user');
    await seedAuthUser();

    console.log('[UI_QA] Seeding synthetic workspace and autopilot agent');
    await seedDatabase(client);

    console.log('[UI_QA] Running authenticated Playwright checks');
    result = await runUiQa();

    console.log(JSON.stringify(result, null, 2));

    if (!result.passed) {
      process.exitCode = 1;
    }
  } finally {
    if (!KEEP_DATA) {
      console.log('[UI_QA] Cleaning synthetic data');
      try {
        await cleanupDatabase(client);
      } finally {
        await deleteAuthUser();
      }
    } else {
      console.log('[UI_QA] UI_QA_KEEP_DATA=true; synthetic data preserved for inspection.');
    }

    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error('[UI_QA] Failed:', error);
  process.exit(1);
});
