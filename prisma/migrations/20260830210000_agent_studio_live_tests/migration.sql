-- Live authoring tests own a real webchat, but never trust browser-supplied runtime state.
CREATE TABLE public.agent_studio_live_tests (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES public.autopilot_configs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  chat_id uuid NOT NULL UNIQUE REFERENCES public.chats(id) ON DELETE CASCADE,
  release jsonb NOT NULL CHECK (jsonb_typeof(release) = 'object'),
  encrypted_state text NOT NULL,
  flow_input jsonb NOT NULL DEFAULT '{}'::jsonb,
  revision integer NOT NULL DEFAULT 0,
  lease_token uuid,
  lease_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL DEFAULT (clock_timestamp() + interval '24 hours')
);
CREATE INDEX agent_studio_live_tests_owner ON public.agent_studio_live_tests (workspace_id, agent_id, user_id, created_at DESC);
ALTER TABLE public.agent_studio_live_tests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agent_studio_live_tests FROM anon, authenticated;
GRANT ALL ON public.agent_studio_live_tests TO service_role;
