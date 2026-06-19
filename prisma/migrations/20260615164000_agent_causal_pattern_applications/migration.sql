CREATE TABLE IF NOT EXISTS public.agent_causal_pattern_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  config_id uuid NOT NULL REFERENCES public.autopilot_configs(id) ON DELETE CASCADE,
  pattern_id uuid NOT NULL REFERENCES public.agent_causal_patterns(id) ON DELETE CASCADE,
  applied_by_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  application_type text NOT NULL,
  status text NOT NULL DEFAULT 'drafted',
  before_snapshot_hash text NOT NULL,
  after_snapshot_hash text NOT NULL,
  patch_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT agent_causal_pattern_applications_type_check
    CHECK (application_type IN ('draft_knowledge_policy', 'draft_switch_graph_patch')),
  CONSTRAINT agent_causal_pattern_applications_status_check
    CHECK (status IN ('drafted', 'published', 'reverted', 'conflicted')),
  CONSTRAINT agent_causal_pattern_applications_config_pattern_key
    UNIQUE (config_id, pattern_id)
);

CREATE INDEX IF NOT EXISTS idx_agent_causal_pattern_applications_workspace
  ON public.agent_causal_pattern_applications(workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_causal_pattern_applications_config
  ON public.agent_causal_pattern_applications(config_id, created_at DESC);
