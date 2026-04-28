DROP INDEX IF EXISTS public.uq_autopilot_configs_workspace_user;

CREATE INDEX IF NOT EXISTS idx_autopilot_configs_workspace_user
  ON public.autopilot_configs(workspace_id, user_id);
