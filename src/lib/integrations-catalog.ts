import 'server-only';

import { unstable_cache } from 'next/cache';
import { db } from '@/lib/db';
import type { Integration } from '@/lib/types';
import { availableIntegrations } from '@/lib/integrations';

const loadCatalog = unstable_cache(
  async (): Promise<Integration[]> => {
    const res = await db.query(
      `SELECT id, name, description, icon_url, tag, tag_type, href, status
       FROM app_integrations
       ORDER BY name`
    );

    if ((res.rowCount ?? 0) === 0) {
      return availableIntegrations;
    }

    return res.rows as Integration[];
  },
  ['integration-catalog'],
  { tags: ['integration-catalog'], revalidate: false }
);

export async function getIntegrationsCatalog(): Promise<Integration[]> {
  return loadCatalog();
}
