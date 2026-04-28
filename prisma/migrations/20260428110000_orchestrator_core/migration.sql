CREATE TABLE IF NOT EXISTS public.orchestrator_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  chat_id uuid,
  source_message_id uuid,
  system_agent_id uuid,
  autopilot_config_id uuid,
  status text NOT NULL DEFAULT 'running',
  intent text,
  confidence_level text,
  confidence_score numeric,
  budget jsonb NOT NULL DEFAULT '{}'::jsonb,
  timings jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT orchestrator_runs_workspace_id_fkey
    FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE,
  CONSTRAINT orchestrator_runs_chat_id_fkey
    FOREIGN KEY (chat_id) REFERENCES public.chats(id) ON DELETE SET NULL,
  CONSTRAINT orchestrator_runs_source_message_id_fkey
    FOREIGN KEY (source_message_id) REFERENCES public.messages(id) ON DELETE SET NULL,
  CONSTRAINT orchestrator_runs_system_agent_id_fkey
    FOREIGN KEY (system_agent_id) REFERENCES public.system_agents(id) ON DELETE SET NULL,
  CONSTRAINT orchestrator_runs_autopilot_config_id_fkey
    FOREIGN KEY (autopilot_config_id) REFERENCES public.autopilot_configs(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public.orchestrator_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  chat_id uuid,
  parent_event_id uuid,
  kind text NOT NULL,
  status text,
  duration_ms integer,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT orchestrator_events_run_id_fkey
    FOREIGN KEY (run_id) REFERENCES public.orchestrator_runs(id) ON DELETE CASCADE,
  CONSTRAINT orchestrator_events_workspace_id_fkey
    FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE,
  CONSTRAINT orchestrator_events_chat_id_fkey
    FOREIGN KEY (chat_id) REFERENCES public.chats(id) ON DELETE SET NULL,
  CONSTRAINT orchestrator_events_parent_event_id_fkey
    FOREIGN KEY (parent_event_id) REFERENCES public.orchestrator_events(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public.agent_tools_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_name text NOT NULL,
  version text NOT NULL DEFAULT '2026-04-28',
  description text,
  class text NOT NULL,
  risk_level text NOT NULL DEFAULT 'low',
  idempotent boolean NOT NULL DEFAULT true,
  timeout_ms integer NOT NULL DEFAULT 5000,
  max_attempts integer NOT NULL DEFAULT 1,
  input_schema jsonb NOT NULL DEFAULT '{}'::jsonb,
  output_schema jsonb NOT NULL DEFAULT '{}'::jsonb,
  policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT agent_tools_catalog_tool_name_version_key UNIQUE (tool_name, version)
);

CREATE TABLE IF NOT EXISTS public.orchestrator_tool_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid,
  workspace_id uuid NOT NULL,
  chat_id uuid,
  system_agent_id uuid,
  autopilot_config_id uuid,
  tool_name text NOT NULL,
  tool_version text,
  class text,
  risk_level text,
  status text NOT NULL,
  input jsonb,
  output jsonb,
  error text,
  duration_ms integer,
  requires_human_approval boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT orchestrator_tool_calls_run_id_fkey
    FOREIGN KEY (run_id) REFERENCES public.orchestrator_runs(id) ON DELETE SET NULL,
  CONSTRAINT orchestrator_tool_calls_workspace_id_fkey
    FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE,
  CONSTRAINT orchestrator_tool_calls_chat_id_fkey
    FOREIGN KEY (chat_id) REFERENCES public.chats(id) ON DELETE SET NULL,
  CONSTRAINT orchestrator_tool_calls_system_agent_id_fkey
    FOREIGN KEY (system_agent_id) REFERENCES public.system_agents(id) ON DELETE SET NULL,
  CONSTRAINT orchestrator_tool_calls_autopilot_config_id_fkey
    FOREIGN KEY (autopilot_config_id) REFERENCES public.autopilot_configs(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_orchestrator_runs_workspace_created
  ON public.orchestrator_runs(workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_orchestrator_runs_chat_created
  ON public.orchestrator_runs(chat_id, created_at DESC)
  WHERE chat_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orchestrator_events_run_created
  ON public.orchestrator_events(run_id, created_at);

CREATE INDEX IF NOT EXISTS idx_orchestrator_events_workspace_kind
  ON public.orchestrator_events(workspace_id, kind, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_orchestrator_tool_calls_workspace_created
  ON public.orchestrator_tool_calls(workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_orchestrator_tool_calls_run
  ON public.orchestrator_tool_calls(run_id)
  WHERE run_id IS NOT NULL;

INSERT INTO public.agent_tools_catalog (
  tool_name,
  version,
  description,
  class,
  risk_level,
  idempotent,
  timeout_ms,
  max_attempts,
  input_schema,
  output_schema,
  policy
) VALUES
(
  'transfer_chat',
  '2026-04-28',
  'Transfere o atendimento para um agente humano ou equipe do workspace.',
  'handoff',
  'medium',
  true,
  8000,
  1,
  '{"type":"object","additionalProperties":false,"properties":{"type":{"const":"transfer_chat"},"reason":{"type":["string","null"]},"payload":{"type":["object","null"],"properties":{"teamId":{"type":["string","null"]},"teamName":{"type":["string","null"]},"agentId":{"type":["string","null"]}}}},"required":["type"]}'::jsonb,
  '{"type":"object","properties":{"transferred":{"type":"boolean"},"target":{"type":"object"}}}'::jsonb,
  '{"requires_human_review":false,"allowed_when_autopilot_active":true}'::jsonb
),
(
  'add_internal_note',
  '2026-04-28',
  'Adiciona nota interna ao atendimento para preservar contexto operacional.',
  'write_idempotent',
  'low',
  true,
  3000,
  1,
  '{"type":"object","additionalProperties":false,"properties":{"type":{"const":"add_internal_note"},"reason":{"type":["string","null"]},"payload":{"type":["object","null"],"properties":{"content":{"type":["string","null"]}}}},"required":["type"]}'::jsonb,
  '{"type":"object","properties":{"messageId":{"type":"string"}}}'::jsonb,
  '{"requires_human_review":false,"allowed_when_autopilot_active":true}'::jsonb
)
ON CONFLICT (tool_name, version) DO UPDATE
SET
  description = EXCLUDED.description,
  class = EXCLUDED.class,
  risk_level = EXCLUDED.risk_level,
  idempotent = EXCLUDED.idempotent,
  timeout_ms = EXCLUDED.timeout_ms,
  max_attempts = EXCLUDED.max_attempts,
  input_schema = EXCLUDED.input_schema,
  output_schema = EXCLUDED.output_schema,
  policy = EXCLUDED.policy,
  is_active = true,
  updated_at = timezone('utc', now());
