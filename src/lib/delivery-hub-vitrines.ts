import 'server-only';

import { db } from '@/lib/db';

export async function ensureDeliveryHubVitrinesTable(): Promise<void> {
  // Applied by Prisma migration before runtime.
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
