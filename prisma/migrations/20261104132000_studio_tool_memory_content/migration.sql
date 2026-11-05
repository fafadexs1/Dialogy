-- Bounded, individually encrypted pages for full redacted API observations.
CREATE TABLE IF NOT EXISTS public.studio_tool_memory_content (
  workspace_id uuid NOT NULL,
  contact_id uuid NOT NULL,
  agent_id uuid NOT NULL,
  release_id uuid NOT NULL,
  tool_key text NOT NULL,
  observation_id text NOT NULL,
  page integer NOT NULL CHECK (page >= 0 AND page < 5000),
  encrypted text NOT NULL CHECK (octet_length(encrypted) BETWEEN 1 AND 65536),
  PRIMARY KEY (workspace_id, contact_id, agent_id, release_id, tool_key, observation_id, page),
  FOREIGN KEY (workspace_id, contact_id, agent_id, release_id, tool_key, observation_id)
    REFERENCES public.studio_tool_memory (workspace_id, contact_id, agent_id, release_id, tool_key, observation_id) ON DELETE CASCADE
);
ALTER TABLE public.studio_tool_memory_content ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.studio_tool_memory_content FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.studio_tool_memory_content TO service_role;
