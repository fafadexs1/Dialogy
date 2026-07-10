-- Final cutover: legacy graphs remain preserved as historical data, but no
-- configuration can be switched back to the retired editor/runtime contract.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.autopilot_configs
    WHERE workflow_builder_mode <> 'native_v2'
       OR active_workflow_id IS NULL
       OR active_workflow_version IS NULL
  ) THEN
    RAISE EXCEPTION 'Native-only cutover blocked: every config must have an active published V2 workflow';
  END IF;
END $$;

ALTER TABLE public.autopilot_configs
  ALTER COLUMN workflow_builder_mode SET DEFAULT 'native_v2';

ALTER TABLE public.autopilot_configs
  DROP CONSTRAINT IF EXISTS autopilot_configs_native_builder_only;

ALTER TABLE public.autopilot_configs
  ADD CONSTRAINT autopilot_configs_native_builder_only
  CHECK (workflow_builder_mode = 'native_v2') NOT VALID;

ALTER TABLE public.autopilot_configs
  VALIDATE CONSTRAINT autopilot_configs_native_builder_only;

