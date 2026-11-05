CREATE TABLE IF NOT EXISTS public.user_team_reaction_preferences (
 user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
 muted boolean NOT NULL DEFAULT false,
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.user_team_reaction_preferences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_team_reaction_preferences FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.user_team_reaction_preferences TO service_role;
