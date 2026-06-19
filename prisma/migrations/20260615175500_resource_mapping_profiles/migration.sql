CREATE TABLE IF NOT EXISTS public.resource_mapping_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  resource text NOT NULL,
  field_aliases_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  mapping_preferences_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT resource_mapping_profiles_workspace_resource_key
    UNIQUE (workspace_id, resource)
);

CREATE INDEX IF NOT EXISTS idx_resource_mapping_profiles_workspace
  ON public.resource_mapping_profiles(workspace_id, resource);
