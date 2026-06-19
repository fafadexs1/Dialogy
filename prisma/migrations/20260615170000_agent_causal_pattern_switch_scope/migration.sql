ALTER TABLE public.agent_causal_patterns
  ADD COLUMN IF NOT EXISTS switch_node_id text,
  ADD COLUMN IF NOT EXISTS switch_route_id text;

CREATE INDEX IF NOT EXISTS idx_agent_causal_patterns_switch_scope
  ON public.agent_causal_patterns(workspace_id, switch_node_id, switch_route_id, status, created_at DESC)
  WHERE switch_node_id IS NOT NULL;
