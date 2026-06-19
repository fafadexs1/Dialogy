CREATE TABLE IF NOT EXISTS public.agent_score_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  agent_id uuid REFERENCES public.system_agents(id) ON DELETE SET NULL,
  autopilot_config_id uuid REFERENCES public.autopilot_configs(id) ON DELETE CASCADE,
  weights_json jsonb NOT NULL,
  source text NOT NULL DEFAULT 'suggestion',
  evidence_pattern_id uuid REFERENCES public.agent_causal_patterns(id) ON DELETE SET NULL,
  reason text,
  created_by_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  applied_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT agent_score_history_source_check
    CHECK (source IN ('manual', 'auto_tune', 'suggestion'))
);

CREATE INDEX IF NOT EXISTS idx_agent_score_history_workspace
  ON public.agent_score_history(workspace_id, applied_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_score_history_config
  ON public.agent_score_history(autopilot_config_id, applied_at DESC)
  WHERE autopilot_config_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_agent_score_history_pattern
  ON public.agent_score_history(evidence_pattern_id)
  WHERE evidence_pattern_id IS NOT NULL;
