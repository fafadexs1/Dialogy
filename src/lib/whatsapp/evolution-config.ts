import 'server-only';

import { db } from '@/lib/db';
import type { EvolutionApiConfig } from '@/lib/types';

export async function getEvolutionApiConfig(
  instanceName: string
): Promise<Omit<EvolutionApiConfig, 'id' | 'workspace_id'> | null> {
  if (!instanceName) return null;
  const instanceRes = await db.query(
    `SELECT c.api_url, c.api_key
     FROM evolution_api_instances i
     JOIN whatsapp_clusters c ON i.cluster_id = c.id
     WHERE i.instance_name = $1`,
    [instanceName]
  );
  if (instanceRes.rowCount === 0) {
    return null;
  }
  return instanceRes.rows[0];
}
