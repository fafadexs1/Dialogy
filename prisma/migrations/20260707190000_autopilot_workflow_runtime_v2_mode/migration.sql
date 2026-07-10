ALTER TABLE IF EXISTS public.autopilot_configs
  ADD COLUMN IF NOT EXISTS workflow_runtime_v2_mode text NOT NULL DEFAULT 'off';

ALTER TABLE IF EXISTS public.autopilot_configs
  DROP CONSTRAINT IF EXISTS autopilot_configs_workflow_runtime_v2_mode_check;

ALTER TABLE IF EXISTS public.autopilot_configs
  ADD CONSTRAINT autopilot_configs_workflow_runtime_v2_mode_check
  CHECK (workflow_runtime_v2_mode IN ('off', 'shadow', 'primary'));
