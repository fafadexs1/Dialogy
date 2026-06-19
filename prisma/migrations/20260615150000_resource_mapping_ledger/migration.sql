CREATE TABLE IF NOT EXISTS public.resource_mapping_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  chat_id uuid,
  message_id uuid,
  orchestrator_run_id uuid,
  procedure_session_id uuid,
  resource text NOT NULL,
  operation text NOT NULL,
  status text NOT NULL,
  confidence numeric,
  mapped_fields_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  rejected_fields_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  payload_hash text,
  policy_result_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT resource_mapping_ledger_workspace_id_fkey
    FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE,
  CONSTRAINT resource_mapping_ledger_chat_id_fkey
    FOREIGN KEY (chat_id) REFERENCES public.chats(id) ON DELETE SET NULL,
  CONSTRAINT resource_mapping_ledger_message_id_fkey
    FOREIGN KEY (message_id) REFERENCES public.messages(id) ON DELETE SET NULL,
  CONSTRAINT resource_mapping_ledger_orchestrator_run_id_fkey
    FOREIGN KEY (orchestrator_run_id) REFERENCES public.orchestrator_runs(id) ON DELETE SET NULL,
  CONSTRAINT resource_mapping_ledger_procedure_session_id_fkey
    FOREIGN KEY (procedure_session_id) REFERENCES public.procedure_executions(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_resource_mapping_ledger_workspace_created
  ON public.resource_mapping_ledger(workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_resource_mapping_ledger_chat_created
  ON public.resource_mapping_ledger(chat_id, created_at DESC)
  WHERE chat_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_resource_mapping_ledger_resource
  ON public.resource_mapping_ledger(workspace_id, resource, operation, created_at DESC);
