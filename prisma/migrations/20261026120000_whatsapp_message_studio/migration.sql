CREATE TABLE IF NOT EXISTS public.whatsapp_message_library (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  instance_id uuid REFERENCES public.evolution_api_instances(id) ON DELETE SET NULL,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 100),
  draft jsonb NOT NULL CHECK (jsonb_typeof(draft) = 'object'),
  revision integer NOT NULL DEFAULT 1,
  provider_name text,
  published_fingerprint text,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS whatsapp_message_library_workspace_updated
  ON public.whatsapp_message_library(workspace_id, updated_at DESC);
ALTER TABLE public.whatsapp_message_library ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.whatsapp_message_library FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.whatsapp_studio_sends (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  instance_id uuid NOT NULL REFERENCES public.evolution_api_instances(id) ON DELETE CASCADE,
  fingerprint text NOT NULL,
  status text NOT NULL CHECK(status IN ('pending', 'sent', 'failed', 'unknown')),
  provider_message_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS whatsapp_studio_sends_workspace_created
  ON public.whatsapp_studio_sends(workspace_id, created_at DESC);
ALTER TABLE public.whatsapp_studio_sends ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.whatsapp_studio_sends FROM anon, authenticated;
