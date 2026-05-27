ALTER TABLE IF EXISTS public.autopilot_configs
  ADD COLUMN IF NOT EXISTS knowledge_collections jsonb;
