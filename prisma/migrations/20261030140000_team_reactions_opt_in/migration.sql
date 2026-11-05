-- Existing and new accounts must explicitly opt in to receiving team surprises.
ALTER TABLE public.user_team_reaction_preferences
  ADD COLUMN IF NOT EXISTS enabled boolean NOT NULL DEFAULT false;
ALTER TABLE public.user_team_reaction_preferences ALTER COLUMN muted SET DEFAULT true;
