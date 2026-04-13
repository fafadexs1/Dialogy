'use server';

import { revalidatePath } from 'next/cache';

import { db } from '@/lib/db';
import {
  buildDeliveryHubPublicPath,
  normalizeDeliveryHubConfig,
  normalizeDeliveryHubSlug,
  type DeliveryHubBusiness,
  type DeliveryHubVitrine,
} from '@/lib/delivery-hub';
import { ensureDeliveryHubVitrinesTable, migrateExistingDeliveryHub } from '@/lib/delivery-hub-vitrines';
import { createClient } from '@/lib/supabase/server';

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

function rowToVitrine(row: Record<string, unknown>): DeliveryHubVitrine {
  const config = (row.config && typeof row.config === 'object') ? row.config as Record<string, unknown> : {};
  const normalized = normalizeDeliveryHubConfig({
    ...config,
    title: row.title,
    subtitle: row.subtitle,
    slug: row.slug,
    isPublished: row.is_published,
  });

  return {
    id: String(row.id || ''),
    workspaceId: String(row.workspace_id || ''),
    title: normalized.title,
    subtitle: normalized.subtitle,
    slug: normalized.slug,
    isPublished: normalized.isPublished,
    businesses: normalized.businesses,
    createdAt: row.created_at ? String(row.created_at) : new Date().toISOString(),
    updatedAt: row.updated_at ? String(row.updated_at) : new Date().toISOString(),
  };
}

export type VitrineListResponse = {
  success: boolean;
  vitrines: DeliveryHubVitrine[];
  error?: string;
};

export type VitrineResponse = {
  success: boolean;
  vitrine?: DeliveryHubVitrine;
  error?: string;
};

export async function listVitrines(workspaceId: string): Promise<VitrineListResponse> {
  const userId = await getAuthenticatedUserId();
  if (!userId) {
    return { success: false, vitrines: [], error: 'Usuario nao autenticado.' };
  }

  if (!workspaceId) {
    return { success: false, vitrines: [], error: 'Workspace nao informado.' };
  }

  if (!(await hasWorkspaceAccess(userId, workspaceId))) {
    return { success: false, vitrines: [], error: 'Acesso nao autorizado.' };
  }

  await ensureDeliveryHubVitrinesTable();
  await migrateExistingDeliveryHub(workspaceId);

  const result = await db.query(
    `
      SELECT id, workspace_id, title, subtitle, slug, is_published, config, created_at, updated_at
      FROM delivery_hub_vitrines
      WHERE workspace_id = $1
      ORDER BY created_at DESC
    `,
    [workspaceId]
  );

  return {
    success: true,
    vitrines: result.rows.map(rowToVitrine),
  };
}

export async function getVitrine(vitrineId: string): Promise<VitrineResponse> {
  const userId = await getAuthenticatedUserId();
  if (!userId) {
    return { success: false, error: 'Usuario nao autenticado.' };
  }

  await ensureDeliveryHubVitrinesTable();

  const result = await db.query(
    `
      SELECT v.id, v.workspace_id, v.title, v.subtitle, v.slug, v.is_published, v.config, v.created_at, v.updated_at
      FROM delivery_hub_vitrines v
      INNER JOIN user_workspace_roles uwr ON uwr.workspace_id = v.workspace_id AND uwr.user_id = $2
      WHERE v.id = $1
      LIMIT 1
    `,
    [vitrineId, userId]
  );

  if ((result.rowCount || 0) === 0) {
    return { success: false, error: 'Vitrine nao encontrada ou acesso negado.' };
  }

  return { success: true, vitrine: rowToVitrine(result.rows[0]) };
}

export async function createVitrine(workspaceId: string): Promise<VitrineResponse> {
  const userId = await getAuthenticatedUserId();
  if (!userId) {
    return { success: false, error: 'Usuario nao autenticado.' };
  }

  if (!workspaceId) {
    return { success: false, error: 'Workspace nao informado.' };
  }

  if (!(await hasWorkspaceAccess(userId, workspaceId))) {
    return { success: false, error: 'Acesso nao autorizado.' };
  }

  await ensureDeliveryHubVitrinesTable();

  const result = await db.query(
    `
      INSERT INTO delivery_hub_vitrines (workspace_id, title, subtitle, slug, is_published, config)
      VALUES ($1, 'Nova Vitrine', 'Escolha um negocio e faca seu pedido.', '', FALSE, '{"businesses":[]}'::jsonb)
      RETURNING id, workspace_id, title, subtitle, slug, is_published, config, created_at, updated_at
    `,
    [workspaceId]
  );

  revalidatePath('/integrations/delivery-hub');

  return { success: true, vitrine: rowToVitrine(result.rows[0]) };
}

export async function saveVitrine(vitrineId: string, input: unknown): Promise<VitrineResponse> {
  const userId = await getAuthenticatedUserId();
  if (!userId) {
    return { success: false, error: 'Usuario nao autenticado.' };
  }

  await ensureDeliveryHubVitrinesTable();

  const accessResult = await db.query(
    `
      SELECT v.id, v.slug as old_slug, v.workspace_id
      FROM delivery_hub_vitrines v
      INNER JOIN user_workspace_roles uwr ON uwr.workspace_id = v.workspace_id AND uwr.user_id = $2
      WHERE v.id = $1
      LIMIT 1
    `,
    [vitrineId, userId]
  );

  if ((accessResult.rowCount || 0) === 0) {
    return { success: false, error: 'Vitrine nao encontrada ou acesso negado.' };
  }

  const previousSlug = normalizeDeliveryHubSlug(accessResult.rows[0].old_slug || '');
  const source = (input && typeof input === 'object') ? input as Record<string, unknown> : {};
  const normalized = normalizeDeliveryHubConfig(source);
  const slug = normalizeDeliveryHubSlug(normalized.slug);

  if (normalized.isPublished && slug.length < 3) {
    return {
      success: false,
      error: 'Defina um slug com pelo menos 3 caracteres para publicar.',
    };
  }

  if (slug) {
    const slugConflict = await db.query(
      `
        SELECT id FROM delivery_hub_vitrines
        WHERE slug = $1 AND id <> $2
        LIMIT 1
      `,
      [slug, vitrineId]
    );

    if ((slugConflict.rowCount || 0) > 0) {
      return { success: false, error: 'Esse slug ja esta em uso. Escolha outro.' };
    }
  }

  const businesses: DeliveryHubBusiness[] = normalized.businesses;

  const result = await db.query(
    `
      UPDATE delivery_hub_vitrines
      SET title = $2,
          subtitle = $3,
          slug = $4,
          is_published = $5,
          config = $6::jsonb,
          updated_at = NOW()
      WHERE id = $1
      RETURNING id, workspace_id, title, subtitle, slug, is_published, config, created_at, updated_at
    `,
    [
      vitrineId,
      normalized.title,
      normalized.subtitle,
      slug,
      normalized.isPublished,
      JSON.stringify({ businesses }),
    ]
  );

  revalidatePath('/integrations/delivery-hub');
  if (previousSlug) {
    revalidatePath(buildDeliveryHubPublicPath(previousSlug));
  }
  if (slug) {
    revalidatePath(buildDeliveryHubPublicPath(slug));
  }

  return { success: true, vitrine: rowToVitrine(result.rows[0]) };
}

export async function deleteVitrine(vitrineId: string): Promise<{ success: boolean; error?: string }> {
  const userId = await getAuthenticatedUserId();
  if (!userId) {
    return { success: false, error: 'Usuario nao autenticado.' };
  }

  await ensureDeliveryHubVitrinesTable();

  const accessResult = await db.query(
    `
      SELECT v.slug, v.workspace_id
      FROM delivery_hub_vitrines v
      INNER JOIN user_workspace_roles uwr ON uwr.workspace_id = v.workspace_id AND uwr.user_id = $2
      WHERE v.id = $1
      LIMIT 1
    `,
    [vitrineId, userId]
  );

  if ((accessResult.rowCount || 0) === 0) {
    return { success: false, error: 'Vitrine nao encontrada ou acesso negado.' };
  }

  const slug = accessResult.rows[0].slug;

  await db.query('DELETE FROM delivery_hub_vitrines WHERE id = $1', [vitrineId]);

  revalidatePath('/integrations/delivery-hub');
  if (slug) {
    revalidatePath(buildDeliveryHubPublicPath(slug));
  }

  return { success: true };
}

export async function getPublicVitrineBySlug(
  slug: string
): Promise<{ success: boolean; vitrine?: DeliveryHubVitrine; error?: string }> {
  const normalizedSlug = normalizeDeliveryHubSlug(slug);

  if (normalizedSlug.length < 3) {
    return { success: false, error: 'Slug invalido.' };
  }

  await ensureDeliveryHubVitrinesTable();

  const result = await db.query(
    `
      SELECT id, workspace_id, title, subtitle, slug, is_published, config, created_at, updated_at
      FROM delivery_hub_vitrines
      WHERE slug = $1 AND is_published = TRUE
      LIMIT 1
    `,
    [normalizedSlug]
  );

  if ((result.rowCount || 0) === 0) {
    return { success: false, error: 'Vitrine nao encontrada.' };
  }

  return { success: true, vitrine: rowToVitrine(result.rows[0]) };
}
