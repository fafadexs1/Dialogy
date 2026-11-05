-- A reset marks when cached operational results must cease to be reused.
CREATE TABLE IF NOT EXISTS public.studio_tool_memory_resets (
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  scope_key text NOT NULL,
  cleared_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  generation uuid NOT NULL DEFAULT gen_random_uuid(),
  PRIMARY KEY(workspace_id, scope_key)
);
ALTER TABLE public.studio_tool_memory_resets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.studio_tool_memory ADD COLUMN IF NOT EXISTS source_reset text;
CREATE INDEX IF NOT EXISTS studio_tool_memory_generation_history_idx
  ON public.studio_tool_memory (workspace_id, contact_id, agent_id, source_reset, tool_key, observed_at DESC, observation_id DESC);
REVOKE ALL ON public.studio_tool_memory_resets FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.studio_tool_memory_resets TO service_role;
