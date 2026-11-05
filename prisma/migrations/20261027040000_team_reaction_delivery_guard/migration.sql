CREATE TABLE public.team_reaction_delivery_guard (
  user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  reaction_id uuid NOT NULL,
  expires_at timestamptz NOT NULL
);
ALTER TABLE public.team_reaction_delivery_guard ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.team_reaction_delivery_guard FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.team_reaction_delivery_guard TO service_role;
