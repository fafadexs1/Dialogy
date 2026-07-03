CREATE TABLE IF NOT EXISTS public.workflow_definitions (
  workflow_id text NOT NULL,
  workflow_version text NOT NULL,
  workspace_id uuid,
  name text NOT NULL,
  status text NOT NULL,
  definition jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT workflow_definitions_pkey
    PRIMARY KEY (workflow_id, workflow_version),
  CONSTRAINT workflow_definitions_status_check
    CHECK (status IN ('draft', 'published', 'archived')),
  CONSTRAINT workflow_definitions_workspace_id_fkey
    FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_workflow_definitions_workspace_status
  ON public.workflow_definitions(workspace_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.workflow_executions (
  id text PRIMARY KEY,
  workflow_id text NOT NULL,
  workflow_version text NOT NULL,
  workspace_id uuid,
  session_id text,
  conversation_id text,
  status text NOT NULL DEFAULT 'queued',
  current_node_id text,
  previous_node_id text,
  pending_node_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  variables jsonb NOT NULL DEFAULT '{}'::jsonb,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  node_results jsonb NOT NULL DEFAULT '{}'::jsonb,
  execution_path jsonb NOT NULL DEFAULT '[]'::jsonb,
  waiting_reason text,
  resume_token text,
  failure jsonb,
  counters jsonb NOT NULL DEFAULT '{}'::jsonb,
  version integer NOT NULL DEFAULT 0,
  locked_by text,
  lock_expires_at timestamptz,
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  finished_at timestamptz,
  CONSTRAINT workflow_executions_definition_fkey
    FOREIGN KEY (workflow_id, workflow_version)
    REFERENCES public.workflow_definitions(workflow_id, workflow_version)
    ON DELETE RESTRICT,
  CONSTRAINT workflow_executions_workspace_id_fkey
    FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE,
  CONSTRAINT workflow_executions_status_check
    CHECK (status IN ('queued', 'running', 'waiting', 'completed', 'failed', 'cancelled')),
  CONSTRAINT workflow_executions_pending_nodes_check
    CHECK (jsonb_typeof(pending_node_ids) = 'array'),
  CONSTRAINT workflow_executions_version_check
    CHECK (version >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_workflow_executions_resume_token
  ON public.workflow_executions(resume_token)
  WHERE resume_token IS NOT NULL AND status = 'waiting';

CREATE INDEX IF NOT EXISTS idx_workflow_executions_workspace_status
  ON public.workflow_executions(workspace_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_workflow_executions_runnable
  ON public.workflow_executions(status, lock_expires_at, updated_at)
  WHERE status IN ('queued', 'running');

CREATE INDEX IF NOT EXISTS idx_workflow_executions_conversation
  ON public.workflow_executions(conversation_id, started_at DESC)
  WHERE conversation_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.workflow_node_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id text NOT NULL,
  node_id text NOT NULL,
  node_type text NOT NULL,
  sequence integer NOT NULL,
  attempt integer NOT NULL DEFAULT 1,
  status text NOT NULL,
  input jsonb,
  output jsonb,
  state_before jsonb,
  state_patch jsonb,
  state_after jsonb,
  error jsonb,
  metrics jsonb,
  selected_output text,
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  finished_at timestamptz,
  CONSTRAINT workflow_node_runs_execution_id_fkey
    FOREIGN KEY (execution_id) REFERENCES public.workflow_executions(id) ON DELETE CASCADE,
  CONSTRAINT workflow_node_runs_status_check
    CHECK (status IN ('queued', 'running', 'success', 'route', 'waiting', 'retry', 'skipped', 'completed', 'error', 'cancelled')),
  CONSTRAINT workflow_node_runs_sequence_attempt_key
    UNIQUE (execution_id, sequence, attempt)
);

CREATE INDEX IF NOT EXISTS idx_workflow_node_runs_execution_sequence
  ON public.workflow_node_runs(execution_id, sequence, attempt);

CREATE INDEX IF NOT EXISTS idx_workflow_node_runs_node_status
  ON public.workflow_node_runs(node_id, status, started_at DESC);

CREATE TABLE IF NOT EXISTS public.workflow_tool_calls (
  id text PRIMARY KEY,
  execution_id text NOT NULL,
  node_run_id uuid,
  node_id text NOT NULL,
  tool_name text NOT NULL,
  purpose_summary text,
  arguments jsonb NOT NULL DEFAULT '{}'::jsonb,
  output jsonb,
  error jsonb,
  status text NOT NULL,
  attempt integer NOT NULL DEFAULT 1,
  idempotency_key text,
  started_at timestamptz,
  finished_at timestamptz,
  duration_ms integer,
  CONSTRAINT workflow_tool_calls_execution_id_fkey
    FOREIGN KEY (execution_id) REFERENCES public.workflow_executions(id) ON DELETE CASCADE,
  CONSTRAINT workflow_tool_calls_node_run_id_fkey
    FOREIGN KEY (node_run_id) REFERENCES public.workflow_node_runs(id) ON DELETE SET NULL,
  CONSTRAINT workflow_tool_calls_status_check
    CHECK (status IN ('requested', 'running', 'success', 'error', 'rejected')),
  CONSTRAINT workflow_tool_calls_duration_check
    CHECK (duration_ms IS NULL OR duration_ms >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_workflow_tool_calls_idempotency
  ON public.workflow_tool_calls(execution_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL AND status = 'success';

CREATE INDEX IF NOT EXISTS idx_workflow_tool_calls_execution_started
  ON public.workflow_tool_calls(execution_id, started_at);

CREATE TABLE IF NOT EXISTS public.workflow_events (
  id text PRIMARY KEY,
  execution_id text NOT NULL,
  workflow_id text NOT NULL,
  sequence bigint NOT NULL,
  event_type text NOT NULL,
  node_id text,
  tool_name text,
  safe_summary text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT workflow_events_execution_id_fkey
    FOREIGN KEY (execution_id) REFERENCES public.workflow_executions(id) ON DELETE CASCADE,
  CONSTRAINT workflow_events_execution_sequence_key
    UNIQUE (execution_id, sequence)
);

CREATE INDEX IF NOT EXISTS idx_workflow_events_execution_created
  ON public.workflow_events(execution_id, sequence);

CREATE INDEX IF NOT EXISTS idx_workflow_events_workflow_type
  ON public.workflow_events(workflow_id, event_type, created_at DESC);

CREATE TABLE IF NOT EXISTS public.workflow_model_capabilities (
  provider text NOT NULL,
  model text NOT NULL,
  tool_calling text NOT NULL,
  structured_output boolean NOT NULL DEFAULT false,
  streaming boolean NOT NULL DEFAULT false,
  recommended_max_tools integer NOT NULL DEFAULT 0,
  recommended_context_size integer NOT NULL,
  evaluation_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_evaluated_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT workflow_model_capabilities_pkey PRIMARY KEY (provider, model),
  CONSTRAINT workflow_model_capabilities_tool_calling_check
    CHECK (tool_calling IN ('unsupported', 'weak', 'supported', 'excellent')),
  CONSTRAINT workflow_model_capabilities_limits_check
    CHECK (recommended_max_tools >= 0 AND recommended_context_size > 0)
);

CREATE INDEX IF NOT EXISTS idx_workflow_model_capabilities_evaluated
  ON public.workflow_model_capabilities(provider, last_evaluated_at DESC);
