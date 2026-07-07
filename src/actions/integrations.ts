'use server';

import { revalidatePath, revalidateTag } from 'next/cache';

import { db } from '@/lib/db';
import {
  AI_CREDENTIAL_PROVIDERS,
  getAiCredentialProviderLabel,
  getDefaultAiCredentialModel,
  isAiCredentialProvider,
  normalizeAiCredentialModel,
  type AiCredentialProvider,
} from '@/lib/ai-provider-credentials';
import { ensureWorkspaceIntegrationsTable } from '@/lib/workspace-integrations';
import {
  listWorkspaceConfiguredAiModels,
  loadWorkspaceAiCredentialRecords,
  type ConfiguredWorkspaceAiModel,
} from '@/services/ai/workspace-ai-credentials';
import {
  testAiProviderConnection,
  type AiProviderConnectionProvider,
  type AiProviderHealthResult,
} from '@/services/ai/provider-health';
import {
  getDefaultDeepSeekEnvKey,
  getDefaultGeminiEnvKey,
  getDefaultOpenAiEnvKey,
} from '@/services/ai/provider-keys';
import { getCurrentUser } from './user';

export type IntegrationConfig<T = any> = {
  provider: string;
  config: T;
  is_active: boolean;
  updated_at: string;
};

export async function saveIntegrationConfig(
  workspaceId: string,
  provider: string,
  config: any,
  isActive: boolean = true
): Promise<{ success: boolean; error?: string }> {
  const user = await getCurrentUser();

  if (!user) {
    return { success: false, error: 'Usuario nao autenticado.' };
  }

  if (user.activeWorkspaceId !== workspaceId) {
    return { success: false, error: 'Acesso negado ao workspace.' };
  }

  try {
    await ensureWorkspaceIntegrationsTable();

    await db.query(
      `
        INSERT INTO workspace_integrations (workspace_id, provider, config, is_active, updated_at)
        VALUES ($1, $2, $3, $4, NOW())
        ON CONFLICT (workspace_id, provider)
        DO UPDATE SET
          config = $3,
          is_active = $4,
          updated_at = NOW()
      `,
      [workspaceId, provider, JSON.stringify(config), isActive]
    );

    revalidatePath('/integrations');
    return { success: true };
  } catch (error) {
    console.error('[SAVE_INTEGRATION] Error:', error);
    return { success: false, error: 'Falha ao salvar configuracao da integracao.' };
  }
}

export async function getIntegrationConfig(
  workspaceId: string,
  provider: string
): Promise<{ config: any | null; isActive: boolean }> {
  const user = await getCurrentUser();
  if (!user) {
    return { config: null, isActive: false };
  }

  try {
    await ensureWorkspaceIntegrationsTable();

    const res = await db.query(
      `
        SELECT config, is_active
        FROM workspace_integrations
        WHERE workspace_id = $1
          AND provider = $2
      `,
      [workspaceId, provider]
    );

    if (res.rows.length === 0) {
      return { config: null, isActive: false };
    }

    return {
      config: res.rows[0].config,
      isActive: res.rows[0].is_active,
    };
  } catch (error) {
    console.error('[GET_INTEGRATION_CONFIG] Error:', error);
    return { config: null, isActive: false };
  }
}

export type AiProviderConnectionTestResult = AiProviderHealthResult & {
  keySource: 'current-form' | 'workspace' | 'environment' | 'missing';
  error?: string;
};

export type AiProviderCredentialSummary = {
  provider: AiCredentialProvider;
  providerLabel: string;
  model: string;
  isActive: boolean;
  hasApiKey: boolean;
  updatedAt: string | null;
};

function cleanConfigValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isAiProvider(value: unknown): value is AiProviderConnectionProvider {
  return isAiCredentialProvider(value);
}

function defaultModelForProvider(provider: AiProviderConnectionProvider): string {
  return getDefaultAiCredentialModel(provider);
}

function envKeyForProvider(provider: AiProviderConnectionProvider): string {
  if (provider === 'gemini') return getDefaultGeminiEnvKey();
  if (provider === 'deepseek') return getDefaultDeepSeekEnvKey();
  return getDefaultOpenAiEnvKey();
}

async function loadStoredAiProviderConfig(
  workspaceId: string,
  provider: AiProviderConnectionProvider,
): Promise<{ apiKey: string; aiModel: string }> {
  await ensureWorkspaceIntegrationsTable();
  const res = await db.query(
    `
      SELECT config
      FROM workspace_integrations
      WHERE workspace_id = $1
        AND provider = $2
        AND is_active = true
      ORDER BY updated_at DESC
      LIMIT 1
    `,
    [workspaceId, provider],
  );

  const config = res.rows[0]?.config || {};
  return {
    apiKey: cleanConfigValue(config.apiKey),
    aiModel: cleanConfigValue(config.aiModel),
  };
}

export async function listAiProviderCredentialsAction(
  workspaceId: string,
): Promise<{ credentials: AiProviderCredentialSummary[]; error?: string }> {
  const user = await getCurrentUser();
  if (!user) {
    return { credentials: [], error: 'Usuario nao autenticado.' };
  }
  if (user.activeWorkspaceId !== workspaceId) {
    return { credentials: [], error: 'Acesso negado ao workspace.' };
  }

  try {
    const records = await loadWorkspaceAiCredentialRecords(workspaceId);
    return {
      credentials: records
        .filter((record) => record.apiKey || record.aiModel)
        .map((record) => ({
          provider: record.provider,
          providerLabel: getAiCredentialProviderLabel(record.provider),
          model: record.aiModel,
          isActive: record.isActive,
          hasApiKey: record.apiKey.length > 0,
          updatedAt: record.updatedAt,
        })),
    };
  } catch (error) {
    console.error('[LIST_AI_PROVIDER_CREDENTIALS] Error:', error);
    return { credentials: [], error: 'Falha ao carregar modelos de IA.' };
  }
}

export async function getWorkspaceConfiguredAiModelsAction(
  workspaceId: string,
): Promise<{ models: ConfiguredWorkspaceAiModel[]; error?: string }> {
  const user = await getCurrentUser();
  if (!user) {
    return { models: [], error: 'Usuario nao autenticado.' };
  }
  if (user.activeWorkspaceId !== workspaceId) {
    return { models: [], error: 'Acesso negado ao workspace.' };
  }

  try {
    return { models: await listWorkspaceConfiguredAiModels(workspaceId) };
  } catch (error) {
    console.error('[GET_WORKSPACE_CONFIGURED_AI_MODELS] Error:', error);
    return { models: [], error: 'Falha ao carregar modelos configurados.' };
  }
}

export async function saveAiProviderCredentialAction(input: {
  workspaceId: string;
  provider: AiCredentialProvider;
  apiKey?: string;
  model?: string;
  isActive?: boolean;
}): Promise<{ success: boolean; error?: string }> {
  const user = await getCurrentUser();

  if (!user) {
    return { success: false, error: 'Usuario nao autenticado.' };
  }
  if (user.activeWorkspaceId !== input.workspaceId) {
    return { success: false, error: 'Acesso negado ao workspace.' };
  }
  if (!isAiCredentialProvider(input.provider)) {
    return { success: false, error: 'Provedor de IA invalido.' };
  }

  const model = normalizeAiCredentialModel(input.provider, input.model);
  if (!model) {
    return { success: false, error: 'Modelo de IA invalido para este provedor.' };
  }

  try {
    await ensureWorkspaceIntegrationsTable();
    const existing = (await loadWorkspaceAiCredentialRecords(input.workspaceId))
      .find((record) => record.provider === input.provider);
    const apiKey = cleanConfigValue(input.apiKey) || existing?.apiKey || '';
    if (!apiKey) {
      return { success: false, error: 'Informe a chave de API deste modelo.' };
    }

    await db.query(
      `
        INSERT INTO workspace_integrations (workspace_id, provider, config, is_active, updated_at)
        VALUES ($1, $2, $3, $4, NOW())
        ON CONFLICT (workspace_id, provider)
        DO UPDATE SET
          config = $3,
          is_active = $4,
          updated_at = NOW()
      `,
      [
        input.workspaceId,
        input.provider,
        JSON.stringify({ apiKey, aiModel: model }),
        input.isActive !== false,
      ],
    );

    revalidatePath('/integrations');
    revalidatePath('/integrations/ai');
    revalidatePath('/autopilot');
    return { success: true };
  } catch (error) {
    console.error('[SAVE_AI_PROVIDER_CREDENTIAL] Error:', error);
    return { success: false, error: 'Falha ao salvar modelo de IA.' };
  }
}

export async function removeAiProviderCredentialAction(input: {
  workspaceId: string;
  provider: AiCredentialProvider;
}): Promise<{ success: boolean; error?: string }> {
  const user = await getCurrentUser();

  if (!user) {
    return { success: false, error: 'Usuario nao autenticado.' };
  }
  if (user.activeWorkspaceId !== input.workspaceId) {
    return { success: false, error: 'Acesso negado ao workspace.' };
  }
  if (!isAiCredentialProvider(input.provider)) {
    return { success: false, error: 'Provedor de IA invalido.' };
  }

  try {
    await ensureWorkspaceIntegrationsTable();
    await db.query(
      `
        DELETE FROM workspace_integrations
        WHERE workspace_id = $1
          AND provider = $2
      `,
      [input.workspaceId, input.provider],
    );

    revalidatePath('/integrations');
    revalidatePath('/integrations/ai');
    revalidatePath('/autopilot');
    return { success: true };
  } catch (error) {
    console.error('[REMOVE_AI_PROVIDER_CREDENTIAL] Error:', error);
    return { success: false, error: 'Falha ao remover modelo de IA.' };
  }
}

export async function testAiProviderConnectionAction(input: {
  workspaceId: string;
  provider: AiProviderConnectionProvider;
  apiKey?: string;
  model?: string;
}): Promise<AiProviderConnectionTestResult> {
  const user = await getCurrentUser();

  if (!user) {
    return {
      ok: false,
      provider: isAiProvider(input.provider) ? input.provider : 'gemini',
      model: input.model || '',
      runtimeProvider: 'other',
      durationMs: 0,
      checkedAt: new Date().toISOString(),
      message: 'Usuario nao autenticado.',
      keySource: 'missing',
      error: 'Usuario nao autenticado.',
    };
  }

  if (user.activeWorkspaceId !== input.workspaceId) {
    return {
      ok: false,
      provider: isAiProvider(input.provider) ? input.provider : 'gemini',
      model: input.model || '',
      runtimeProvider: 'other',
      durationMs: 0,
      checkedAt: new Date().toISOString(),
      message: 'Acesso negado ao workspace.',
      keySource: 'missing',
      error: 'Acesso negado ao workspace.',
    };
  }

  if (!isAiProvider(input.provider)) {
    return {
      ok: false,
      provider: 'gemini',
      model: input.model || '',
      runtimeProvider: 'other',
      durationMs: 0,
      checkedAt: new Date().toISOString(),
      message: 'Provedor de IA invalido.',
      keySource: 'missing',
      error: 'Provedor de IA invalido.',
    };
  }

  const storedConfig = await loadStoredAiProviderConfig(input.workspaceId, input.provider);
  const formKey = cleanConfigValue(input.apiKey);
  const workspaceKey = storedConfig.apiKey;
  const environmentKey = envKeyForProvider(input.provider);
  const apiKey = formKey || workspaceKey || environmentKey;
  const keySource = formKey
    ? 'current-form'
    : workspaceKey
      ? 'workspace'
      : environmentKey
        ? 'environment'
        : 'missing';
  const model = cleanConfigValue(input.model) || storedConfig.aiModel || defaultModelForProvider(input.provider);

  const result = await testAiProviderConnection({
    provider: input.provider,
    apiKey,
    model,
    timeoutMs: 12000,
  });

  return {
    ...result,
    keySource,
  };
}

export async function getIntegrations(): Promise<{ integrations: any[]; error?: string }> {
  const user = await getCurrentUser();
  if (!user?.activeWorkspaceId) {
    return { integrations: [] };
  }

  const workspaceId = user.activeWorkspaceId;

  try {
    await ensureWorkspaceIntegrationsTable();

    const statusesRes = await db.query(
      `
        SELECT provider, is_active
        FROM workspace_integrations
        WHERE workspace_id = $1
      `,
      [workspaceId]
    );

    const activeProviders = new Set(
      statusesRes.rows.filter((row) => row.is_active).map((row) => row.provider)
    );

    const { checkLimit } = await import('@/lib/billing-logic');

    const [evoCountRes, telegramCountRes] = await Promise.all([
      db.query(
        `
          SELECT COUNT(*) as count
          FROM evolution_api_instances
          WHERE workspace_id = $1
        `,
        [workspaceId]
      ),
      db.query(
        `
          SELECT COUNT(*) as count
          FROM telegram_bot_instances
          WHERE workspace_id = $1
        `,
        [workspaceId]
      ),
    ]);
    const evoCurrentCount = parseInt(evoCountRes.rows[0].count, 10);
    const whatsappCurrentCount = evoCurrentCount;
    const telegramCurrentCount = parseInt(telegramCountRes.rows[0].count, 10);
    const evoLimitCheck = await checkLimit(workspaceId, 'whatsapp', evoCurrentCount);

    const activeAiProviderCount = AI_CREDENTIAL_PROVIDERS
      .filter((provider) => activeProviders.has(provider))
      .length;

    const availableIntegrations = [
      {
        id: 'ai-models',
        name: 'Modelos de IA',
        description: 'Gerencie Gemini, OpenAI/Codex e DeepSeek em uma unica integracao.',
        icon_url: '/integration-fallback.svg',
        tag: activeAiProviderCount > 0 ? `${activeAiProviderCount} ativo(s)` : 'IA',
        tag_type: 'primary',
        href: '/integrations/ai',
        status: 'active',
        provider: 'ai-models',
        is_active: activeAiProviderCount > 0,
      },
      {
        id: 'evolution-api',
        name: 'Evolution API',
        description: 'Conecte WhatsApp com QR Code ou Cloud API pela Evolution API.',
        icon_url: '/icons/whatsapp.svg',
        tag: 'WhatsApp',
        tag_type: 'primary',
        href: '/integrations/evolution-api',
        status: 'active',
        provider: 'evolution-api',
        is_active: activeProviders.has('evolution-api') || whatsappCurrentCount > 0,
        limitStatus: {
          reached: !evoLimitCheck.allowed,
          current: evoCurrentCount,
          max: evoLimitCheck.limit,
          plan: evoLimitCheck.plan,
        },
      },
      {
        id: 'telegram',
        name: 'Telegram Bot',
        description: 'Conecte bots do Telegram com webhook automatico e inbox dedicado.',
        icon_url: '/icons/telegram.svg',
        tag: 'Telegram',
        tag_type: 'primary',
        href: '/integrations/telegram',
        status: 'active',
        provider: 'telegram',
        is_active: activeProviders.has('telegram') || telegramCurrentCount > 0,
      },
      {
        id: 'meta-messenger',
        name: 'Meta Messenger',
        description: 'Gerencie mensagens do Facebook Messenger.',
        icon_url: '/icons/messenger.svg',
        tag: 'Messenger',
        tag_type: 'primary',
        href: '/integrations/meta-messenger',
        status: 'active',
        provider: 'meta-messenger',
        is_active: activeProviders.has('meta-messenger'),
      },
      {
        id: 'meta-instagram',
        name: 'Instagram Direct',
        description: 'Responda DMs do Instagram diretamente.',
        icon_url: '/icons/instagram.svg',
        tag: 'Instagram',
        tag_type: 'primary',
        href: '/integrations/meta-instagram',
        status: 'active',
        provider: 'meta-instagram',
        is_active: activeProviders.has('meta-instagram'),
      },
      {
        id: 'mercadolivre',
        name: 'Mercado Livre',
        description: 'Responda perguntas e gerencie vendas do Mercado Livre.',
        icon_url: '/icons/mercadolivre.png',
        tag: 'Marketplace',
        tag_type: 'secondary',
        href: '/integrations/mercadolivre',
        status: 'active',
        provider: 'mercadolivre',
        is_active: activeProviders.has('mercadolivre'),
      },
      {
        id: 'nexusflow',
        name: 'NexusFlow',
        description: 'Automacao de fluxos e chatbots avancados.',
        icon_url: '/icons/nexusflow.svg',
        tag: 'Automacao',
        tag_type: 'secondary',
        href: '/integrations/nexusflow',
        status: 'active',
        provider: 'nexusflow',
        is_active: activeProviders.has('nexusflow'),
      },
      {
        id: 'sgp',
        name: 'SGP',
        description: 'Plugin de integracao com o sistema SGP.',
        icon_url: 'https://raichu-uploads.s3.amazonaws.com/logo_tsmx_G0fUrW.png',
        tag: 'Plugin',
        tag_type: 'beta',
        href: '/integrations/sgp',
        status: 'active',
        provider: 'sgp',
        is_active: activeProviders.has('sgp'),
      },
      {
        id: 'mcp',
        name: 'MCP',
        description: 'Conecte servidores Model Context Protocol e exponha tools para agentes de IA.',
        icon_url: '/icons/gemini.svg',
        tag: 'IA Tools',
        tag_type: 'beta',
        href: '/integrations/mcp',
        status: 'active',
        provider: 'mcp',
        is_active: activeProviders.has('mcp'),
      },
      {
        id: 'gads',
        name: 'GADS',
        description: 'Rastreie campanhas do Google Ads ate a conversa real no WhatsApp.',
        icon_url: '/icons/google-ads.svg',
        tag: 'Ads',
        tag_type: 'primary',
        href: '/integrations/gads',
        status: 'active',
        provider: 'gads',
        is_active: activeProviders.has('gads'),
      },
      {
        id: 'delivery-hub',
        name: 'Delivery Hub',
        description: 'Monte uma vitrine com varios negocios, cardapios e link publico compartilhavel.',
        icon_url: '/icons/delivery-hub.svg',
        tag: activeProviders.has('delivery-hub') ? 'Publicado' : 'Catalogo',
        tag_type: activeProviders.has('delivery-hub') ? 'primary' : 'secondary',
        href: '/integrations/delivery-hub',
        status: 'active',
        provider: 'delivery-hub',
        is_active: activeProviders.has('delivery-hub'),
      },
    ];

    return { integrations: availableIntegrations };
  } catch (error) {
    console.error('[GET_INTEGRATIONS_ACTION]', error);
    return { integrations: [], error: 'Falha ao carregar integracoes.' };
  }
}

export async function updateIntegration(data: any): Promise<{ success: boolean; error?: string }> {
  console.log('[UPDATE_INTEGRATION] Stub called with:', data);
  revalidateTag('integration-catalog', 'default');
  return { success: true };
}
