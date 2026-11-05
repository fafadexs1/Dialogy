-- Customer choices outlive temporary execution sessions. Payloads are encrypted by the server.
-- This journal is deliberately independent of session-history cleanup and release deletion.
CREATE TABLE public.agent_studio_memory_events (
  sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  chat_id uuid NOT NULL REFERENCES public.chats(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES public.autopilot_configs(id) ON DELETE CASCADE,
  event_id text NOT NULL CHECK (event_id ~ '^[a-f0-9]{64}$'),
  entity_key text NOT NULL CHECK (entity_key ~ '^[a-f0-9]{64}$'),
  encrypted text NOT NULL CHECK (octet_length(encrypted) BETWEEN 1 AND 98304),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (workspace_id, chat_id, agent_id, event_id)
);
CREATE INDEX agent_studio_memory_current
  ON public.agent_studio_memory_events (workspace_id, chat_id, agent_id, entity_key, sequence DESC);
CREATE INDEX agent_studio_memory_history
  ON public.agent_studio_memory_events (workspace_id, chat_id, agent_id, sequence DESC);
CREATE INDEX agent_studio_memory_chat ON public.agent_studio_memory_events (chat_id);
CREATE INDEX agent_studio_memory_agent ON public.agent_studio_memory_events (agent_id);
ALTER TABLE public.agent_studio_memory_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agent_studio_memory_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.agent_studio_memory_events_sequence_seq FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.agent_studio_memory_events TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.agent_studio_memory_events_sequence_seq TO service_role;
