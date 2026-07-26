-- Extraido de producao em 2026-07-26T00:51:42.333Z
-- Somente as tabelas que o reconciliador de presenca toca.
-- Regerar: node scratchpad/extrair-ddl.js

CREATE TABLE IF NOT EXISTS public.user_workspace_presence (
  user_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  is_online boolean DEFAULT false NOT NULL,
  online_since timestamptz,
  last_seen timestamptz DEFAULT now() NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb,
  recent_activity_at timestamptz,
  last_event_at timestamptz DEFAULT now(),
  last_event_source text DEFAULT 'migration'::text,
  PRIMARY KEY (user_id, workspace_id)
);

CREATE TABLE IF NOT EXISTS public.presence_sessions (
  user_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  session_id text NOT NULL,
  last_seen timestamptz DEFAULT now() NOT NULL,
  last_event_at timestamptz DEFAULT now() NOT NULL,
  last_event_source text DEFAULT 'unknown'::text NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  PRIMARY KEY (user_id, workspace_id, session_id)
);
