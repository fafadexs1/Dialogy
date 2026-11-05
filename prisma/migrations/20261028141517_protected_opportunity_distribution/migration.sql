-- Additive migration: run before deploying the new application version.
CREATE TABLE public.opportunity_distribution_state (
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  phase text NOT NULL CHECK (phase IN ('active','shadow')),
  turn_date date NOT NULL,
  balance double precision NOT NULL DEFAULT 0 CHECK (balance BETWEEN -1 AND 1),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (workspace_id,team_id,user_id,phase)
);
CREATE TABLE public.chat_transfer_operations (
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL,
  operation_id text NOT NULL CHECK (length(operation_id) BETWEEN 1 AND 200),
  request_hash text NOT NULL,
  chat_id uuid NOT NULL REFERENCES public.chats(id) ON DELETE CASCADE,
  outcome text NOT NULL CHECK (outcome IN ('assigned','no_op')),
  agent_id uuid NOT NULL REFERENCES public.users(id),
  agent_name text NOT NULL,
  team_id uuid REFERENCES public.teams(id) ON DELETE SET NULL,
  event_id uuid,
  preconditions jsonb NOT NULL DEFAULT '{}'::jsonb,
  replay_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (workspace_id,actor_id,operation_id)
);
CREATE INDEX chat_transfer_operations_chat ON public.chat_transfer_operations(workspace_id,chat_id,created_at DESC);
ALTER TABLE public.chat_assignment_events ADD COLUMN policy_version text NOT NULL DEFAULT 'legacy';
ALTER TABLE public.chat_assignment_events ADD COLUMN decision_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.opportunity_distribution_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_transfer_operations ENABLE ROW LEVEL SECURITY;
-- Server database role only. No browser policies or public grants.
REVOKE ALL ON public.opportunity_distribution_state FROM PUBLIC;
REVOKE ALL ON public.chat_transfer_operations FROM PUBLIC;
DO $$ DECLARE browser_role text; BEGIN
  FOREACH browser_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=browser_role) THEN
      EXECUTE format('REVOKE ALL ON public.opportunity_distribution_state, public.chat_transfer_operations FROM %I',browser_role);
    END IF;
  END LOOP;
END $$;
CREATE INDEX IF NOT EXISTS chat_distribution_human_reply ON public.messages(workspace_id,chat_id,sender_user_id,created_at DESC)
  WHERE from_me = TRUE AND type <> 'system';
