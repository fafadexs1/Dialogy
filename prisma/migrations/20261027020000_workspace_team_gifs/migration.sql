CREATE TABLE public.workspace_team_gifs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  url text NOT NULL CHECK (char_length(url) <= 2048),
  sound text NOT NULL DEFAULT 'none' CHECK (sound IN ('none','pum','applause','party','coffee')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id,url)
);
CREATE INDEX workspace_team_gifs_workspace_created_idx ON public.workspace_team_gifs(workspace_id,created_at DESC);
ALTER TABLE public.workspace_team_gifs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workspace_team_gifs FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.workspace_team_gifs TO service_role;
