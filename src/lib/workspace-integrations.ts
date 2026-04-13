import 'server-only';

import { db } from '@/lib/db';

let workspaceIntegrationsSchemaEnsured = false;

export async function ensureWorkspaceIntegrationsTable(): Promise<void> {
  if (workspaceIntegrationsSchemaEnsured) {
    return;
  }

  await db.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');
  await db.query(`
    CREATE TABLE IF NOT EXISTS public.workspace_integrations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      config JSONB NOT NULL DEFAULT '{}'::jsonb,
      is_active BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(workspace_id, provider)
    )
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_workspace_integrations_provider_active
    ON public.workspace_integrations(provider, is_active)
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_workspace_integrations_provider_slug
    ON public.workspace_integrations(provider, ((config ->> 'slug')))
  `);

  workspaceIntegrationsSchemaEnsured = true;
}
