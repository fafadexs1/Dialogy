ALTER TABLE IF EXISTS public.teams
  ADD COLUMN IF NOT EXISTS agent_routing_config jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_teams_agent_routing_config_gin
  ON public.teams USING gin (agent_routing_config);
