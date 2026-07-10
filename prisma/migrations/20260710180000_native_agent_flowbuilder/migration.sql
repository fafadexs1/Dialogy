ALTER TABLE public.autopilot_configs
  ADD COLUMN IF NOT EXISTS workflow_builder_mode text NOT NULL DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS active_workflow_id text,
  ADD COLUMN IF NOT EXISTS active_workflow_version text;

ALTER TABLE public.autopilot_configs
  ALTER COLUMN name SET DEFAULT 'Automação de IA';

ALTER TABLE public.autopilot_configs
  DROP CONSTRAINT IF EXISTS autopilot_configs_workflow_builder_mode_check;

ALTER TABLE public.autopilot_configs
  ADD CONSTRAINT autopilot_configs_workflow_builder_mode_check
  CHECK (workflow_builder_mode IN ('legacy', 'native_v2'));

ALTER TABLE public.autopilot_configs
  DROP CONSTRAINT IF EXISTS autopilot_configs_active_workflow_pointer_check;

ALTER TABLE public.autopilot_configs
  ADD CONSTRAINT autopilot_configs_active_workflow_pointer_check
  CHECK (
    (active_workflow_id IS NULL AND active_workflow_version IS NULL)
    OR (active_workflow_id IS NOT NULL AND active_workflow_version IS NOT NULL)
  );

ALTER TABLE public.autopilot_configs
  DROP CONSTRAINT IF EXISTS autopilot_configs_active_workflow_fkey;

ALTER TABLE public.autopilot_configs
  ADD CONSTRAINT autopilot_configs_active_workflow_fkey
  FOREIGN KEY (active_workflow_id, active_workflow_version)
  REFERENCES public.workflow_definitions(workflow_id, workflow_version)
  ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_autopilot_configs_active_workflow
  ON public.autopilot_configs(active_workflow_id, active_workflow_version)
  WHERE active_workflow_id IS NOT NULL;
