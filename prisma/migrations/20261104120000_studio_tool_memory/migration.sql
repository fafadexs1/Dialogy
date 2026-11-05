-- Encrypted tool observations are scoped to one contact, agent, release and connection identity.
CREATE TABLE IF NOT EXISTS public.studio_tool_memory (
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES public.autopilot_configs(id) ON DELETE CASCADE,
  release_id uuid NOT NULL,
  tool_key text NOT NULL CHECK (tool_key ~ '^[a-f0-9]{64}$'),
  observation_id text NOT NULL CHECK (observation_id ~ '^[a-f0-9]{64}$'),
  encrypted text NOT NULL CHECK (octet_length(encrypted) BETWEEN 1 AND 65536),
  observed_at timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, contact_id, agent_id, release_id, tool_key, observation_id)
);
CREATE INDEX IF NOT EXISTS studio_tool_memory_recent ON public.studio_tool_memory (workspace_id, contact_id, agent_id, release_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS studio_tool_memory_expiry ON public.studio_tool_memory (observed_at);
ALTER TABLE public.studio_tool_memory ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.studio_tool_memory FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.studio_tool_memory TO service_role;
