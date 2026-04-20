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
import { getSystemSettings } from '@/actions/system-settings';
import { revalidatePath, revalidateTag } from 'next/cache';

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

  const settings = await getSystemSettings([SYSTEM_AI_MODEL_CATALOG_KEY]);
  return {
    models: parseAiModelCatalog(settings[SYSTEM_AI_MODEL_CATALOG_KEY]),
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
