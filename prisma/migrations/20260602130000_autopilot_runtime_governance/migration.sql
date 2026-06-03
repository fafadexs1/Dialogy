CREATE EXTENSION IF NOT EXISTS "pgcrypto";

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS conversion_counter_mode text NOT NULL DEFAULT 'won_deals',
  ADD COLUMN IF NOT EXISTS conversion_custom_field_id uuid,
  ADD COLUMN IF NOT EXISTS conversion_custom_field_value text,
  ADD COLUMN IF NOT EXISTS custom_limits jsonb;

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS converted_at timestamptz;

CREATE TABLE IF NOT EXISTS public.workspace_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  provider text NOT NULL,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE(workspace_id, provider)
);
CREATE INDEX IF NOT EXISTS idx_workspace_integrations_provider_active
  ON public.workspace_integrations(provider, is_active);
CREATE INDEX IF NOT EXISTS idx_workspace_integrations_provider_slug
  ON public.workspace_integrations(provider, ((config ->> 'slug')));

CREATE TABLE IF NOT EXISTS public.delivery_hub_vitrines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'Vitrine Delivery',
  subtitle text NOT NULL DEFAULT '',
  slug text NOT NULL DEFAULT '',
  is_published boolean NOT NULL DEFAULT false,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_delivery_hub_vitrines_slug
  ON public.delivery_hub_vitrines(slug) WHERE slug <> '';
CREATE INDEX IF NOT EXISTS idx_delivery_hub_vitrines_workspace
  ON public.delivery_hub_vitrines(workspace_id);
CREATE INDEX IF NOT EXISTS idx_delivery_hub_vitrines_published
  ON public.delivery_hub_vitrines(is_published, slug) WHERE is_published = true;

CREATE TABLE IF NOT EXISTS public.seo_pages (
  id text PRIMARY KEY,
  pathname text UNIQUE NOT NULL,
  title text,
  description text,
  canonical text,
  robots text NOT NULL DEFAULT 'index, follow',
  og_image text,
  og_type text NOT NULL DEFAULT 'website',
  json_ld text,
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);
CREATE INDEX IF NOT EXISTS idx_seo_pages_pathname ON public.seo_pages(pathname);

ALTER TABLE public.autopilot_configs
  ADD COLUMN IF NOT EXISTS enabled_tool_names jsonb,
  ADD COLUMN IF NOT EXISTS transcription_model text,
  ADD COLUMN IF NOT EXISTS flow_graph jsonb,
  ADD COLUMN IF NOT EXISTS knowledge_collections jsonb,
  ADD COLUMN IF NOT EXISTS tool_mode text NOT NULL DEFAULT 'on_demand'
    CHECK (tool_mode IN ('deny', 'on_demand', 'required'));

CREATE TABLE IF NOT EXISTS public.autopilot_config_drafts (
  config_id uuid PRIMARY KEY REFERENCES public.autopilot_configs(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);
CREATE INDEX IF NOT EXISTS idx_autopilot_config_drafts_workspace
  ON public.autopilot_config_drafts(workspace_id);
CREATE INDEX IF NOT EXISTS idx_autopilot_config_drafts_user
  ON public.autopilot_config_drafts(user_id);

CREATE TABLE IF NOT EXISTS public.autopilot_config_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id uuid NOT NULL REFERENCES public.autopilot_configs(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  version_number integer NOT NULL,
  label text,
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  UNIQUE (config_id, version_number)
);
CREATE INDEX IF NOT EXISTS idx_autopilot_config_versions_config_created
  ON public.autopilot_config_versions(config_id, version_number DESC);
CREATE INDEX IF NOT EXISTS idx_autopilot_config_versions_workspace
  ON public.autopilot_config_versions(workspace_id);
CREATE INDEX IF NOT EXISTS idx_autopilot_config_versions_user
  ON public.autopilot_config_versions(user_id);

CREATE TABLE IF NOT EXISTS public.autopilot_conversation_states (
  chat_id uuid PRIMARY KEY REFERENCES public.chats(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  autopilot_config_id uuid REFERENCES public.autopilot_configs(id) ON DELETE SET NULL,
  active_node_id text,
  pending_confirmation jsonb,
  last_action jsonb,
  repetition_count integer NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_autopilot_conversation_states_workspace_updated
  ON public.autopilot_conversation_states(workspace_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_autopilot_conversation_states_config
  ON public.autopilot_conversation_states(autopilot_config_id);

CREATE TABLE IF NOT EXISTS public.procedure_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  chat_id uuid NOT NULL,
  system_agent_id uuid,
  procedure_id text NOT NULL,
  procedure_name text NOT NULL,
  current_step_id text NOT NULL,
  status text NOT NULL DEFAULT 'running',
  collected_slots jsonb DEFAULT '{}'::jsonb,
  tool_results jsonb DEFAULT '{}'::jsonb,
  decisions jsonb DEFAULT '{}'::jsonb,
  retry_count jsonb DEFAULT '{}'::jsonb,
  step_history jsonb DEFAULT '[]'::jsonb,
  started_at timestamptz DEFAULT NOW(),
  updated_at timestamptz DEFAULT NOW(),
  completed_at timestamptz,
  created_at timestamptz DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_procedure_executions_chat
  ON public.procedure_executions(chat_id, status);
CREATE INDEX IF NOT EXISTS idx_procedure_executions_workspace
  ON public.procedure_executions(workspace_id, status);

CREATE TABLE IF NOT EXISTS public.rag_retrieval_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  autopilot_config_id uuid,
  query text NOT NULL,
  intent text,
  strategy text,
  knowledge_coverage text,
  selected jsonb NOT NULL DEFAULT '[]'::jsonb,
  discarded jsonb NOT NULL DEFAULT '[]'::jsonb,
  diagnostics jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);
CREATE INDEX IF NOT EXISTS idx_rag_retrieval_logs_workspace_created
  ON public.rag_retrieval_logs(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rag_retrieval_logs_config_created
  ON public.rag_retrieval_logs(autopilot_config_id, created_at DESC);

ALTER FUNCTION public.broadcast_chat_changes() SET search_path = public, pg_temp;
ALTER FUNCTION public.broadcast_contact_changes() SET search_path = public, pg_temp;
ALTER FUNCTION public.broadcast_message_changes() SET search_path = public, pg_temp;
ALTER FUNCTION public.generate_protocol_if_missing() SET search_path = public, pg_temp;
ALTER FUNCTION public.set_updated_at() SET search_path = public, pg_temp;
ALTER FUNCTION public.topic_chat_id(text) SET search_path = public, pg_temp;
ALTER FUNCTION public.topic_workspace_id(text) SET search_path = public, pg_temp;
ALTER FUNCTION public.update_chat_last_activity() SET search_path = public, pg_temp;
ALTER FUNCTION public.update_chat_metadata() SET search_path = public, pg_temp;
ALTER FUNCTION public.update_chat_timestamp() SET search_path = public, pg_temp;
ALTER FUNCTION public.update_contact_phone_digits() SET search_path = public, pg_temp;
