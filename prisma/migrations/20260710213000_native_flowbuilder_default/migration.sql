-- Cutover phase 1: every newly created automation starts on the native builder.
-- Existing rows are intentionally not rewritten: they must first receive a validated
-- native WorkflowDefinition and active immutable publication through the migration UI.
ALTER TABLE public.autopilot_configs
  ALTER COLUMN workflow_builder_mode SET DEFAULT 'native_v2';

-- Gives operations a catalog-backed readiness check before removing legacy runtime
-- compatibility in a future, separately approved migration.
CREATE OR REPLACE VIEW public.autopilot_native_cutover_readiness AS
SELECT
  workspace_id,
  count(*) FILTER (WHERE workflow_builder_mode = 'legacy')::bigint AS legacy_configs,
  count(*) FILTER (
    WHERE workflow_builder_mode = 'native_v2'
      AND (active_workflow_id IS NULL OR active_workflow_version IS NULL)
  )::bigint AS native_without_active_publication,
  count(*) FILTER (
    WHERE workflow_builder_mode = 'native_v2'
      AND active_workflow_id IS NOT NULL
      AND active_workflow_version IS NOT NULL
  )::bigint AS native_ready
FROM public.autopilot_configs
GROUP BY workspace_id;

COMMENT ON VIEW public.autopilot_native_cutover_readiness IS
  'Cutover is safe only when legacy_configs=0 and native_without_active_publication=0 for every workspace.';
