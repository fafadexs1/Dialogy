-- Execution history belongs to the authoring test, never to production releases.
CREATE TABLE public.agent_studio_live_session_history (
  live_test_id uuid NOT NULL REFERENCES public.agent_studio_live_tests(id) ON DELETE CASCADE,
  session_id uuid NOT NULL,
  encrypted_state text NOT NULL CHECK (octet_length(encrypted_state) BETWEEN 1 AND 786432),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (live_test_id, session_id)
);
ALTER TABLE public.agent_studio_live_session_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agent_studio_live_session_history FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_studio_live_session_history TO service_role;
