CREATE TABLE IF NOT EXISTS public.agent_inactivity_settings (
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  timeout_minutes integer NOT NULL DEFAULT 0 CHECK (timeout_minutes BETWEEN 0 AND 43200),
  message text NOT NULL DEFAULT '' CHECK (length(message) <= 4096),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (workspace_id, user_id)
);
CREATE TABLE IF NOT EXISTS public.agent_inactivity_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  chat_id uuid NOT NULL REFERENCES public.chats(id) ON DELETE CASCADE,
  anchor_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('sending','sent','closed','cancelled','failed')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (chat_id,user_id,anchor_at)
);
CREATE INDEX IF NOT EXISTS agent_inactivity_enabled_idx ON public.agent_inactivity_settings (workspace_id,user_id) WHERE timeout_minutes > 0;
CREATE TABLE IF NOT EXISTS public.whatsapp_reference_rates (
  category text PRIMARY KEY CHECK (category IN ('MARKETING','UTILITY','SERVICE','AUTHENTICATION','AUTHENTICATION_INTERNATIONAL','MARKETING_LITE')),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  rate numeric(16,8) NOT NULL CHECK (rate >= 0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL
);
ALTER TABLE public.agent_inactivity_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_inactivity_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_reference_rates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agent_inactivity_settings, public.agent_inactivity_attempts, public.whatsapp_reference_rates FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.agent_inactivity_settings, public.agent_inactivity_attempts, public.whatsapp_reference_rates TO service_role;
