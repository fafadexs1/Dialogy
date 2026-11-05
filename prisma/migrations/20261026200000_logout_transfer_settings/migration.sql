CREATE TABLE IF NOT EXISTS public.logout_transfer_settings (
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  destination text NOT NULL DEFAULT 'queue' CHECK (destination IN ('queue','agent','team')),
  destination_id uuid,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(workspace_id,user_id),
  CHECK ((destination='queue' AND destination_id IS NULL) OR (destination IN ('agent','team') AND destination_id IS NOT NULL))
);
ALTER TABLE public.logout_transfer_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.logout_transfer_settings FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.logout_transfer_settings TO service_role;
