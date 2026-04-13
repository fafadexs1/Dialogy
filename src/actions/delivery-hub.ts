'use server';

import { revalidatePath } from 'next/cache';

import { db } from '@/lib/db';
import {
  DELIVERY_HUB_PROVIDER,
  buildDeliveryHubPublicPath,
  createEmptyDeliveryHubConfig,
  normalizeDeliveryHubConfig,
  normalizeDeliveryHubSlug,
  type DeliveryHubConfig,
} from '@/lib/delivery-hub';
import { createClient } from '@/lib/supabase/server';
import { ensureWorkspaceIntegrationsTable } from '@/lib/workspace-integrations';

type DeliveryHubConfigResponse = {
  success: boolean;
  config: DeliveryHubConfig;
  error?: string;
};

async function getAuthenticatedUserId(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user?.id || null;
}

async function hasWorkspaceAccess(userId: string, workspaceId: string): Promise<boolean> {
  const result = await db.query(
    `
      SELECT 1
      FROM user_workspace_roles
      WHERE user_id = $1
        AND workspace_id = $2
      LIMIT 1
    `,
    [userId, workspaceId]
  );

  return (result.rowCount || 0) > 0;
}

export async function getDeliveryHubConfig(workspaceId: string): Promise<DeliveryHubConfigResponse> {
  const emptyConfig = createEmptyDeliveryHubConfig();
  const userId = await getAuthenticatedUserId();

  if (!userId) {
    return { success: false, config: emptyConfig, error: 'Usuario nao autenticado.' };
  }

  if (!workspaceId) {
    return { success: false, config: emptyConfig, error: 'Workspace nao informado.' };
  }

  if (!(await hasWorkspaceAccess(userId, workspaceId))) {
    return { success: false, config: emptyConfig, error: 'Acesso nao autorizado ao workspace.' };
  }

  await ensureWorkspaceIntegrationsTable();

  const result = await db.query(
    `
      SELECT config, is_active
      FROM workspace_integrations
      WHERE workspace_id = $1
        AND provider = $2
      LIMIT 1
    `,
    [workspaceId, DELIVERY_HUB_PROVIDER]
  );

  if ((result.rowCount || 0) === 0) {
    return { success: true, config: emptyConfig };
  }

  return {
    success: true,
    config: normalizeDeliveryHubConfig({
      ...result.rows[0].config,
      isPublished: result.rows[0].is_active,
    }),
  };
}

export async function saveDeliveryHubConfig(
  workspaceId: string,
  input: unknown
): Promise<DeliveryHubConfigResponse> {
  const emptyConfig = createEmptyDeliveryHubConfig();
  const userId = await getAuthenticatedUserId();

  if (!userId) {
    return { success: false, config: emptyConfig, error: 'Usuario nao autenticado.' };
  }

  if (!workspaceId) {
    return { success: false, config: emptyConfig, error: 'Workspace nao informado.' };
  }

  if (!(await hasWorkspaceAccess(userId, workspaceId))) {
    return { success: false, config: emptyConfig, error: 'Acesso nao autorizado ao workspace.' };
  }

  await ensureWorkspaceIntegrationsTable();

  const normalizedConfig = normalizeDeliveryHubConfig(input);
  const slug = normalizeDeliveryHubSlug(normalizedConfig.slug);

  if (normalizedConfig.isPublished && slug.length < 3) {
    return {
      success: false,
      config: normalizedConfig,
      error: 'Defina um slug publico com pelo menos 3 caracteres para publicar a vitrine.',
    };
  }

  const existingResult = await db.query(
    `
      SELECT config
      FROM workspace_integrations
      WHERE workspace_id = $1
        AND provider = $2
      LIMIT 1
    `,
    [workspaceId, DELIVERY_HUB_PROVIDER]
  );

  const previousSlug = normalizeDeliveryHubSlug(existingResult.rows[0]?.config?.slug || '');

  if (slug) {
    const slugConflictResult = await db.query(
      `
        SELECT workspace_id
        FROM workspace_integrations
        WHERE provider = $1
          AND workspace_id <> $2
          AND COALESCE(config ->> 'slug', '') = $3
        LIMIT 1
      `,
      [DELIVERY_HUB_PROVIDER, workspaceId, slug]
    );

    if ((slugConflictResult.rowCount || 0) > 0) {
      return {
        success: false,
        config: normalizedConfig,
        error: 'Esse slug publico ja esta em uso. Escolha outro identificador.',
      };
    }
  }

  const nextConfig = {
    ...normalizedConfig,
    slug,
  };

  await db.query(
    `
      INSERT INTO workspace_integrations (workspace_id, provider, config, is_active, updated_at)
      VALUES ($1, $2, $3::jsonb, $4, NOW())
      ON CONFLICT (workspace_id, provider)
      DO UPDATE SET
        config = EXCLUDED.config,
        is_active = EXCLUDED.is_active,
        updated_at = NOW()
    `,
    [workspaceId, DELIVERY_HUB_PROVIDER, JSON.stringify(nextConfig), nextConfig.isPublished]
  );

  revalidatePath('/integrations');
  revalidatePath('/integrations/delivery-hub');

  if (previousSlug) {
    revalidatePath(buildDeliveryHubPublicPath(previousSlug));
  }

  if (slug) {
    revalidatePath(buildDeliveryHubPublicPath(slug));
  }

  return { success: true, config: nextConfig };
}

export async function getPublicDeliveryHubBySlug(
  slug: string
): Promise<{ success: boolean; config?: DeliveryHubConfig; workspaceId?: string; error?: string }> {
  const normalizedSlug = normalizeDeliveryHubSlug(slug);

  if (normalizedSlug.length < 3) {
    return { success: false, error: 'Slug invalido.' };
  }

  await ensureWorkspaceIntegrationsTable();

  const result = await db.query(
    `
      SELECT workspace_id, config, is_active
      FROM workspace_integrations
      WHERE provider = $1
        AND is_active = TRUE
        AND COALESCE(config ->> 'slug', '') = $2
      LIMIT 1
    `,
    [DELIVERY_HUB_PROVIDER, normalizedSlug]
  );

  if ((result.rowCount || 0) === 0) {
    return { success: false, error: 'Vitrine nao encontrada.' };
  }

  return {
    success: true,
    workspaceId: result.rows[0].workspace_id,
    config: normalizeDeliveryHubConfig({
      ...result.rows[0].config,
      isPublished: result.rows[0].is_active,
    }),
  };
}
