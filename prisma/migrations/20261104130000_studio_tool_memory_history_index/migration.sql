CREATE INDEX IF NOT EXISTS studio_tool_memory_tool_history ON public.studio_tool_memory (workspace_id, contact_id, agent_id, tool_key, observed_at DESC);
