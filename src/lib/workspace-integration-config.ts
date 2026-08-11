import 'server-only';

import { db } from '@/lib/db';
import { ensureWorkspaceIntegrationsTable } from '@/lib/workspace-integrations';

export async function loadIntegrationConfig(
  workspaceId: string,
  provider: string,
): Promise<{ config: any | null; isActive: boolean }> {
  await ensureWorkspaceIntegrationsTable();
  const result = await db.query(
    `SELECT config, is_active
       FROM workspace_integrations
      WHERE workspace_id = $1
        AND provider = $2
      LIMIT 1`,
    [workspaceId, provider],
  );

  if ((result.rowCount ?? 0) === 0) {
    return { config: null, isActive: false };
  }

  return {
    config: result.rows[0].config,
    isActive: result.rows[0].is_active,
  };
}
