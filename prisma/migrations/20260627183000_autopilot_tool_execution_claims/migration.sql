CREATE TABLE IF NOT EXISTS public.autopilot_tool_execution_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  chat_id uuid NOT NULL,
  source_message_id uuid NOT NULL,
  orchestrator_run_id uuid,
  operation_fingerprint text NOT NULL,
  tool_name text NOT NULL,
  idempotent boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'claimed',
  owner_token uuid NOT NULL,
  action jsonb NOT NULL DEFAULT '{}'::jsonb,
  result jsonb,
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  CONSTRAINT autopilot_tool_execution_claims_status_check
    CHECK (status IN ('claimed', 'success', 'error', 'rejected', 'uncertain')),
  CONSTRAINT autopilot_tool_execution_claims_workspace_id_fkey
    FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE,
  CONSTRAINT autopilot_tool_execution_claims_chat_id_fkey
    FOREIGN KEY (chat_id) REFERENCES public.chats(id) ON DELETE CASCADE,
  CONSTRAINT autopilot_tool_execution_claims_source_message_id_fkey
    FOREIGN KEY (source_message_id) REFERENCES public.messages(id) ON DELETE CASCADE,
  CONSTRAINT autopilot_tool_execution_claims_orchestrator_run_id_fkey
    FOREIGN KEY (orchestrator_run_id) REFERENCES public.orchestrator_runs(id) ON DELETE SET NULL,
  CONSTRAINT autopilot_tool_execution_claims_source_operation_key
    UNIQUE (source_message_id, operation_fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_autopilot_tool_execution_claims_chat_updated
  ON public.autopilot_tool_execution_claims(chat_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_autopilot_tool_execution_claims_workspace_status
  ON public.autopilot_tool_execution_claims(workspace_id, status, updated_at DESC);
