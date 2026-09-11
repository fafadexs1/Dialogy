-- Supports scoped recovery of prior operations before dispatching another effect.
-- Deploy with the normal controlled migration window: non-concurrent index creation
-- takes a write-blocking lock while the index is built.
CREATE INDEX IF NOT EXISTS agent_studio_sessions_scope_history
  ON public.agent_studio_sessions (workspace_id, agent_id, chat_id, started_at DESC, id DESC);

-- Default jsonb_ops supports the top-level key/array-member existence operator (?).
CREATE INDEX IF NOT EXISTS agent_studio_sessions_operation_requests
  ON public.agent_studio_sessions USING GIN ((summary->'operationRequestIds'));
