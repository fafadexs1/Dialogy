import 'server-only';

import { db } from '@/lib/db';

let vitrinesSchemaEnsured = false;

export async function ensureDeliveryHubVitrinesTable(): Promise<void> {
  if (vitrinesSchemaEnsured) {
    return;
  }

  await db.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');
  await db.query(`
    CREATE TABLE IF NOT EXISTS public.delivery_hub_vitrines (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
      title TEXT NOT NULL DEFAULT 'Vitrine Delivery',
      subtitle TEXT NOT NULL DEFAULT '',
      slug TEXT NOT NULL DEFAULT '',
      is_published BOOLEAN NOT NULL DEFAULT FALSE,
      config JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_delivery_hub_vitrines_slug
    ON public.delivery_hub_vitrines(slug) WHERE slug <> ''
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_delivery_hub_vitrines_workspace
    ON public.delivery_hub_vitrines(workspace_id)
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_delivery_hub_vitrines_published
    ON public.delivery_hub_vitrines(is_published, slug) WHERE is_published = TRUE
  `);

  vitrinesSchemaEnsured = true;
}

export async function migrateExistingDeliveryHub(workspaceId: string): Promise<void> {
  const existing = await db.query(
    `
      SELECT config, is_active
      FROM workspace_integrations
      WHERE workspace_id = $1 AND provider = 'delivery-hub'
      LIMIT 1
    `,
    [workspaceId]
  );

  if ((existing.rowCount || 0) === 0) {
    return;
  }

  const row = existing.rows[0];
  const config = row.config || {};
  const slug = (config.slug || '').trim();

  if (!slug) {
    return;
  }

  const alreadyMigrated = await db.query(
    `
      SELECT 1 FROM delivery_hub_vitrines
      WHERE workspace_id = $1 AND slug = $2
      LIMIT 1
    `,
    [workspaceId, slug]
  );

  if ((alreadyMigrated.rowCount || 0) > 0) {
    return;
  }

  const businesses = Array.isArray(config.businesses) ? config.businesses : [];

  await db.query(
    `
      INSERT INTO delivery_hub_vitrines (workspace_id, title, subtitle, slug, is_published, config)
      VALUES ($1, $2, $3, $4, $5, $6::jsonb)
    `,
    [
      workspaceId,
      config.title || 'Vitrine Delivery',
      config.subtitle || '',
      slug,
      row.is_active || false,
      JSON.stringify({ businesses }),
    ]
  );
}
