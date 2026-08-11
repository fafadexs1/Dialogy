'use server';

import { db } from '@/lib/db';
import { createClient } from '@/lib/supabase/server';
import {
  AiModelCatalogEntry,
  DEFAULT_AI_MODEL_CATALOG,
  parseAiModelCatalog,
  serializeAiModelCatalog,
  SYSTEM_AI_MODEL_CATALOG_KEY,
} from '@/lib/ai-models';
import {
  parseAiDecisionModelConfig,
  serializeAiDecisionModelConfig,
  SYSTEM_AI_DECISION_MODELS_KEY,
  type AiDecisionModelConfig,
} from '@/lib/ai-decision-models';
import { getGlobalAiDecisionModelConfig } from '@/services/ai/decision-model-config';
import { getSystemSettings } from '@/lib/system-settings';
import { revalidatePath, revalidateTag } from 'next/cache';
import {
  LM_STUDIO_CONFIG_KEY,
  normalizeLmStudioConfig,
  parseLmStudioConfig,
  type LmStudioConfig,
} from '@/services/ai/lm-studio';

async function requireAuthenticatedUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

async function isSuperAdmin(userId: string): Promise<boolean> {
  const result = await db.query('SELECT is_superadmin FROM users WHERE id = $1', [userId]);
  return result.rows[0]?.is_superadmin === true;
}

export async function getAiModelCatalogAction(): Promise<{
  models: AiModelCatalogEntry[];
  error?: string;
}> {
  const user = await requireAuthenticatedUser();
  if (!user) {
    return { models: DEFAULT_AI_MODEL_CATALOG, error: 'Usuario nao autenticado.' };
  }

  const result = await db.query(
    'SELECT value FROM public.system_settings WHERE key = $1 LIMIT 1',
    [SYSTEM_AI_MODEL_CATALOG_KEY]
  );
  return {
    models: parseAiModelCatalog(result.rows[0]?.value || null),
  };
}

export async function saveAiModelCatalogAction(models: AiModelCatalogEntry[]): Promise<{
  success: boolean;
  error?: string;
}> {
  const user = await requireAuthenticatedUser();
  if (!user || !(await isSuperAdmin(user.id))) {
    return { success: false, error: 'Acesso nao autorizado.' };
  }

  try {
    await db.query(
      `
        INSERT INTO system_settings (key, value)
        VALUES ($1, $2)
        ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()
      `,
      [SYSTEM_AI_MODEL_CATALOG_KEY, serializeAiModelCatalog(models)]
    );

    revalidateTag('system-settings', 'default');
    revalidatePath('/superadmin/ai-models');
    revalidatePath('/autopilot');
    return { success: true };
  } catch (error) {
    console.error('[SAVE_AI_MODEL_CATALOG] Error:', error);
    return { success: false, error: 'Falha ao salvar catalogo de modelos.' };
  }
}

export async function getAiDecisionModelConfigAction(): Promise<{
  config: AiDecisionModelConfig;
  error?: string;
}> {
  const user = await requireAuthenticatedUser();
  if (!user || !(await isSuperAdmin(user.id))) {
    return { config: parseAiDecisionModelConfig(null), error: 'Acesso nao autorizado.' };
  }

  return { config: await getGlobalAiDecisionModelConfig() };
}

export async function saveAiDecisionModelConfigAction(config: AiDecisionModelConfig): Promise<{
  success: boolean;
  error?: string;
}> {
  const user = await requireAuthenticatedUser();
  if (!user || !(await isSuperAdmin(user.id))) {
    return { success: false, error: 'Acesso nao autorizado.' };
  }

  try {
    await db.query(
      `
        INSERT INTO system_settings (key, value)
        VALUES ($1, $2)
        ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()
      `,
      [SYSTEM_AI_DECISION_MODELS_KEY, serializeAiDecisionModelConfig(config)]
    );

    revalidateTag('system-settings', 'default');
    revalidatePath('/superadmin/ai-models');
    return { success: true };
  } catch (error) {
    console.error('[SAVE_AI_DECISION_MODELS] Error:', error);
    return { success: false, error: 'Falha ao salvar modelos de decisao.' };
  }
}

export async function getLmStudioConfigAction(): Promise<{
  config: LmStudioConfig;
  error?: string;
}> {
  const user = await requireAuthenticatedUser();
  if (!user || !(await isSuperAdmin(user.id))) {
    return { config: normalizeLmStudioConfig(), error: 'Acesso nao autorizado.' };
  }

  const settings = await getSystemSettings([LM_STUDIO_CONFIG_KEY]);
  return { config: parseLmStudioConfig(settings[LM_STUDIO_CONFIG_KEY]) };
}

export async function saveLmStudioConfigAction(config: LmStudioConfig): Promise<{
  success: boolean;
  error?: string;
}> {
  const user = await requireAuthenticatedUser();
  if (!user || !(await isSuperAdmin(user.id))) {
    return { success: false, error: 'Acesso nao autorizado.' };
  }

  const normalized = normalizeLmStudioConfig(config);
  if (normalized.baseUrl && !/^https?:\/\//i.test(normalized.baseUrl)) {
    return { success: false, error: 'Informe um endpoint HTTP ou HTTPS valido.' };
  }

  try {
    await db.query(
      `
        INSERT INTO system_settings (key, value)
        VALUES ($1, $2)
        ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()
      `,
      [LM_STUDIO_CONFIG_KEY, JSON.stringify(normalized)]
    );

    revalidateTag('system-settings', 'default');
    revalidatePath('/superadmin/ai-models');
    return { success: true };
  } catch (error) {
    console.error('[SAVE_LM_STUDIO_CONFIG] Error:', error);
    return { success: false, error: 'Falha ao salvar configuracao do LM Studio.' };
  }
}

function formatLmStudioModelLabel(modelId: string): string {
  return modelId
    .split('/')
    .pop()
    ?.replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    || modelId;
}

export async function syncLmStudioModelsAction(): Promise<{
  success: boolean;
  models?: AiModelCatalogEntry[];
  discoveredCount?: number;
  error?: string;
}> {
  const user = await requireAuthenticatedUser();
  if (!user || !(await isSuperAdmin(user.id))) {
    return { success: false, error: 'Acesso nao autorizado.' };
  }

  const settingsResult = await db.query(
    'SELECT key, value FROM public.system_settings WHERE key = ANY($1)',
    [[LM_STUDIO_CONFIG_KEY, SYSTEM_AI_MODEL_CATALOG_KEY]]
  );
  const settings = Object.fromEntries(settingsResult.rows.map((row) => [row.key, row.value]));
  const config = parseLmStudioConfig(settings[LM_STUDIO_CONFIG_KEY]);
  if (!config.baseUrl) {
    return { success: false, error: 'Configure e salve o endpoint do LM Studio primeiro.' };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(`${config.baseUrl}/models`, {
      headers: config.apiToken ? { Authorization: `Bearer ${config.apiToken}` } : {},
      signal: controller.signal,
    });
    if (!response.ok) {
      return { success: false, error: `LM Studio respondeu HTTP ${response.status}.` };
    }

    const body = await response.json() as { data?: Array<{ id?: unknown }> };
    const discoveredModels = (Array.isArray(body.data) ? body.data : [])
      .map((entry) => typeof entry?.id === 'string' ? entry.id.trim() : '')
      .filter(Boolean)
      .filter((id) => !/embedding/i.test(id))
      .map((id): AiModelCatalogEntry => ({
        id: `lmstudio/${id}`,
        label: formatLmStudioModelLabel(id),
        provider: 'lmstudio',
        description: 'Modelo local descoberto automaticamente no LM Studio.',
        enabled: true,
      }));

    if (discoveredModels.length === 0) {
      return { success: false, error: 'Nenhum modelo de chat foi encontrado no LM Studio.' };
    }

    const catalog = parseAiModelCatalog(settings[SYSTEM_AI_MODEL_CATALOG_KEY]);
    const existingIds = new Set(catalog.map((entry) => entry.id));
    const merged = [
      ...catalog,
      ...discoveredModels.filter((entry) => !existingIds.has(entry.id)),
    ];

    await db.query(
      `
        INSERT INTO system_settings (key, value)
        VALUES ($1, $2)
        ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()
      `,
      [SYSTEM_AI_MODEL_CATALOG_KEY, serializeAiModelCatalog(merged)]
    );

    revalidateTag('system-settings', 'default');
    revalidatePath('/superadmin/ai-models');
    revalidatePath('/autopilot');
    return { success: true, models: merged, discoveredCount: discoveredModels.length };
  } catch (error) {
    console.error('[SYNC_LM_STUDIO_MODELS] Error:', error);
    return { success: false, error: 'Nao foi possivel consultar os modelos do LM Studio.' };
  } finally {
    clearTimeout(timeout);
  }
}
