-- Public website chat widgets. Conversation data continues to live in contacts/chats/messages.
CREATE TABLE IF NOT EXISTS public.webchat_widgets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  public_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT 'Chat do site',
  title TEXT NOT NULL DEFAULT 'Olá! Como podemos ajudar?',
  welcome_message TEXT NOT NULL DEFAULT 'Envie uma mensagem e nossa equipe responderá em instantes.',
  primary_color TEXT NOT NULL DEFAULT '#2563eb',
  position TEXT NOT NULL DEFAULT 'right' CHECK (position IN ('left', 'right')),
  allowed_domains TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  require_name BOOLEAN NOT NULL DEFAULT TRUE,
  require_email BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  autopilot_config_id UUID REFERENCES public.autopilot_configs(id) ON DELETE SET NULL,
  team_id UUID REFERENCES public.teams(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webchat_widgets_workspace
  ON public.webchat_widgets(workspace_id, is_active);

CREATE TABLE IF NOT EXISTS public.webchat_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  widget_id UUID NOT NULL REFERENCES public.webchat_widgets(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  chat_id UUID REFERENCES public.chats(id) ON DELETE SET NULL,
  visitor_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  visitor_name TEXT,
  visitor_email TEXT,
  visitor_phone TEXT,
  origin TEXT,
  current_url TEXT,
  referrer TEXT,
  utm_data JSONB NOT NULL DEFAULT '{}'::JSONB,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webchat_sessions_widget_visitor
  ON public.webchat_sessions(widget_id, visitor_id, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_webchat_sessions_chat
  ON public.webchat_sessions(chat_id) WHERE chat_id IS NOT NULL;

ALTER TABLE public.webchat_widgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webchat_sessions ENABLE ROW LEVEL SECURITY;
