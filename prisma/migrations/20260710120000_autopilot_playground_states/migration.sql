CREATE TABLE IF NOT EXISTS public.autopilot_playground_states (
  session_id uuid NOT NULL,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  autopilot_config_id uuid REFERENCES public.autopilot_configs(id) ON DELETE CASCADE,
  active_node_id text,
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY (session_id, workspace_id)
);

CREATE INDEX IF NOT EXISTS idx_autopilot_playground_states_workspace_updated
  ON public.autopilot_playground_states(workspace_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_autopilot_playground_states_config
  ON public.autopilot_playground_states(autopilot_config_id);
