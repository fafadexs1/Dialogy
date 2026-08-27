-- Procedure Studio turns runtime procedure definitions into an authoring
-- surface with optimistic drafts, immutable publications and safe simulation.
ALTER TABLE public.agent_procedure_definitions
  ADD COLUMN IF NOT EXISTS autopilot_config_id uuid,
  ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS priority integer NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS draft_json jsonb,
  ADD COLUMN IF NOT EXISTS draft_revision integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS published_revision integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS published_version integer,
  ADD COLUMN IF NOT EXISTS validation_json jsonb,
  ADD COLUMN IF NOT EXISTS simulation_json jsonb,
  ADD COLUMN IF NOT EXISTS last_tested_at timestamptz,
  ADD COLUMN IF NOT EXISTS published_at timestamptz,
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS updated_by uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'agent_procedure_definitions_autopilot_config_id_fkey'
  ) THEN
    ALTER TABLE public.agent_procedure_definitions
      ADD CONSTRAINT agent_procedure_definitions_autopilot_config_id_fkey
      FOREIGN KEY (autopilot_config_id)
      REFERENCES public.autopilot_configs(id)
      ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'agent_procedure_definitions_created_by_fkey'
  ) THEN
    ALTER TABLE public.agent_procedure_definitions
      ADD CONSTRAINT agent_procedure_definitions_created_by_fkey
      FOREIGN KEY (created_by)
      REFERENCES public.users(id)
      ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'agent_procedure_definitions_updated_by_fkey'
  ) THEN
    ALTER TABLE public.agent_procedure_definitions
      ADD CONSTRAINT agent_procedure_definitions_updated_by_fkey
      FOREIGN KEY (updated_by)
      REFERENCES public.users(id)
      ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'agent_procedure_definitions_priority_check'
  ) THEN
    ALTER TABLE public.agent_procedure_definitions
      ADD CONSTRAINT agent_procedure_definitions_priority_check
      CHECK (priority BETWEEN 0 AND 1000);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'agent_procedure_definitions_revisions_check'
  ) THEN
    ALTER TABLE public.agent_procedure_definitions
      ADD CONSTRAINT agent_procedure_definitions_revisions_check
      CHECK (
        draft_revision >= 0
        AND published_revision >= 0
        AND published_revision <= draft_revision
        AND (published_version IS NULL OR published_version > 0)
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'agent_procedure_definitions_studio_shape_check'
      AND conrelid = 'public.agent_procedure_definitions'::regclass
  ) THEN
    ALTER TABLE public.agent_procedure_definitions
      ADD CONSTRAINT agent_procedure_definitions_studio_shape_check
      CHECK (
        source <> 'procedure_studio'
        OR (
          status IN ('draft', 'active', 'archived')
          AND autopilot_config_id IS NOT NULL
          AND draft_json IS NOT NULL
          AND jsonb_typeof(draft_json) = 'object'
        )
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_agent_procedure_definitions_config_status
  ON public.agent_procedure_definitions(
    workspace_id,
    autopilot_config_id,
    status,
    priority DESC,
    updated_at DESC
  )
  WHERE autopilot_config_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.agent_procedure_versions (
  workspace_id uuid NOT NULL,
  procedure_id text NOT NULL,
  version integer NOT NULL,
  autopilot_config_id uuid NOT NULL,
  snapshot_json jsonb NOT NULL,
  definition_json jsonb NOT NULL,
  validation_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  simulation_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  published_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT agent_procedure_versions_pkey
    PRIMARY KEY (workspace_id, procedure_id, version),
  CONSTRAINT agent_procedure_versions_definition_fkey
    FOREIGN KEY (workspace_id, procedure_id)
    REFERENCES public.agent_procedure_definitions(workspace_id, id)
    ON DELETE CASCADE,
  CONSTRAINT agent_procedure_versions_autopilot_config_id_fkey
    FOREIGN KEY (autopilot_config_id)
    REFERENCES public.autopilot_configs(id)
    ON DELETE CASCADE,
  CONSTRAINT agent_procedure_versions_created_by_fkey
    FOREIGN KEY (created_by)
    REFERENCES public.users(id)
    ON DELETE SET NULL,
  CONSTRAINT agent_procedure_versions_version_check
    CHECK (version > 0),
  CONSTRAINT agent_procedure_versions_snapshot_check
    CHECK (jsonb_typeof(snapshot_json) = 'object'),
  CONSTRAINT agent_procedure_versions_definition_json_check
    CHECK (jsonb_typeof(definition_json) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_agent_procedure_versions_config_published
  ON public.agent_procedure_versions(
    workspace_id,
    autopilot_config_id,
    published_at DESC
  );

-- A published snapshot can be read or removed with its tenant, but never edited
-- in place. Restores always copy it into a new draft revision.
CREATE OR REPLACE FUNCTION public.prevent_agent_procedure_version_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'Published procedure versions are immutable';
END;
$$;

DROP TRIGGER IF EXISTS agent_procedure_versions_prevent_update
  ON public.agent_procedure_versions;
CREATE TRIGGER agent_procedure_versions_prevent_update
  BEFORE UPDATE ON public.agent_procedure_versions
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_agent_procedure_version_update();

-- Defense in depth if these public-schema tables are exposed through the Data API.
ALTER TABLE public.agent_procedure_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_procedure_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_procedure_definitions_manage ON public.agent_procedure_definitions;
CREATE POLICY agent_procedure_definitions_manage
  ON public.agent_procedure_definitions
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.workspaces w
      LEFT JOIN public.users u
        ON u.id = (SELECT auth.uid())
      LEFT JOIN public.user_workspace_roles uwr
        ON uwr.workspace_id = w.id
       AND uwr.user_id = (SELECT auth.uid())
      LEFT JOIN public.role_permissions rp
        ON rp.role_id = uwr.role_id
       AND rp.permission_id = 'automations:manage'
      WHERE w.id = agent_procedure_definitions.workspace_id
        AND (
          w.owner_id = (SELECT auth.uid())
          OR COALESCE(u.is_superadmin, false)
          OR rp.permission_id IS NOT NULL
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.workspaces w
      LEFT JOIN public.users u
        ON u.id = (SELECT auth.uid())
      LEFT JOIN public.user_workspace_roles uwr
        ON uwr.workspace_id = w.id
       AND uwr.user_id = (SELECT auth.uid())
      LEFT JOIN public.role_permissions rp
        ON rp.role_id = uwr.role_id
       AND rp.permission_id = 'automations:manage'
      WHERE w.id = agent_procedure_definitions.workspace_id
        AND (
          w.owner_id = (SELECT auth.uid())
          OR COALESCE(u.is_superadmin, false)
          OR rp.permission_id IS NOT NULL
        )
    )
  );

DROP POLICY IF EXISTS agent_procedure_versions_manage ON public.agent_procedure_versions;
DROP POLICY IF EXISTS agent_procedure_versions_read ON public.agent_procedure_versions;
CREATE POLICY agent_procedure_versions_read
  ON public.agent_procedure_versions
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.workspaces w
      LEFT JOIN public.users u
        ON u.id = (SELECT auth.uid())
      LEFT JOIN public.user_workspace_roles uwr
        ON uwr.workspace_id = w.id
       AND uwr.user_id = (SELECT auth.uid())
      LEFT JOIN public.role_permissions rp
        ON rp.role_id = uwr.role_id
       AND rp.permission_id = 'automations:manage'
      WHERE w.id = agent_procedure_versions.workspace_id
        AND (
          w.owner_id = (SELECT auth.uid())
          OR COALESCE(u.is_superadmin, false)
          OR rp.permission_id IS NOT NULL
        )
    )
  );

DROP POLICY IF EXISTS agent_procedure_versions_publish ON public.agent_procedure_versions;
CREATE POLICY agent_procedure_versions_publish
  ON public.agent_procedure_versions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.workspaces w
      LEFT JOIN public.users u
        ON u.id = (SELECT auth.uid())
      LEFT JOIN public.user_workspace_roles uwr
        ON uwr.workspace_id = w.id
       AND uwr.user_id = (SELECT auth.uid())
      LEFT JOIN public.role_permissions rp
        ON rp.role_id = uwr.role_id
       AND rp.permission_id = 'automations:manage'
      WHERE w.id = agent_procedure_versions.workspace_id
        AND (
          w.owner_id = (SELECT auth.uid())
          OR COALESCE(u.is_superadmin, false)
          OR rp.permission_id IS NOT NULL
        )
    )
  );
