ALTER TABLE IF EXISTS public.autopilot_configs
  ADD COLUMN IF NOT EXISTS flow_graph jsonb;
