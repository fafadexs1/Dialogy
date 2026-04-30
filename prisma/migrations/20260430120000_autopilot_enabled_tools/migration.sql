ALTER TABLE IF EXISTS public.autopilot_configs
  ADD COLUMN IF NOT EXISTS enabled_tool_names jsonb;

