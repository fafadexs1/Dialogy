CREATE TABLE IF NOT EXISTS public.team_agent_distribution_state (
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  accepting_assignments boolean NOT NULL DEFAULT true,
  capacity integer NOT NULL DEFAULT 6 CHECK (capacity > 0),
  max_portfolio integer NOT NULL DEFAULT 25 CHECK (max_portfolio > 0),
  fairness_score numeric(14, 6) NOT NULL DEFAULT 0,
  fairness_window date NOT NULL DEFAULT current_date,
  last_assigned_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, team_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_team_agent_distribution_selection
  ON public.team_agent_distribution_state (
    workspace_id,
    team_id,
    accepting_assignments,
    fairness_score,
    last_assigned_at
  );

CREATE TABLE IF NOT EXISTS public.chat_assignment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  chat_id uuid NOT NULL REFERENCES public.chats(id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  selected_agent_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  source text NOT NULL,
  effective_load_before numeric(10, 4) NOT NULL,
  portfolio_count_before integer NOT NULL,
  capacity integer NOT NULL,
  fairness_score_before numeric(14, 6) NOT NULL,
  fairness_score_after numeric(14, 6) NOT NULL,
  candidate_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  decision_reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_assignment_events_workspace_created
  ON public.chat_assignment_events (workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_chat_assignment_events_agent_created
  ON public.chat_assignment_events (workspace_id, selected_agent_id, created_at DESC);
