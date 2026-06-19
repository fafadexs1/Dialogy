CREATE TABLE IF NOT EXISTS public.agent_procedure_definitions (
  workspace_id uuid NOT NULL,
  id text NOT NULL,
  agent_id uuid,
  name text NOT NULL,
  goal text,
  definition_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  version integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'active',
  source text NOT NULL DEFAULT 'compiled_document',
  document_id text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT agent_procedure_definitions_workspace_id_fkey
    FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE,
  CONSTRAINT agent_procedure_definitions_agent_id_fkey
    FOREIGN KEY (agent_id) REFERENCES public.system_agents(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_procedure_definitions_workspace_status
  ON public.agent_procedure_definitions(workspace_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_procedure_definitions_agent
  ON public.agent_procedure_definitions(agent_id, status, updated_at DESC)
  WHERE agent_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.agent_procedure_sessions (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  chat_id uuid,
  agent_id uuid,
  procedure_id text NOT NULL,
  procedure_execution_id uuid UNIQUE,
  current_step_id text NOT NULL,
  slots_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  confirmations_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  tool_results_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'running',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT agent_procedure_sessions_workspace_id_fkey
    FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE,
  CONSTRAINT agent_procedure_sessions_chat_id_fkey
    FOREIGN KEY (chat_id) REFERENCES public.chats(id) ON DELETE SET NULL,
  CONSTRAINT agent_procedure_sessions_agent_id_fkey
    FOREIGN KEY (agent_id) REFERENCES public.system_agents(id) ON DELETE SET NULL,
  CONSTRAINT agent_procedure_sessions_procedure_execution_id_fkey
    FOREIGN KEY (procedure_execution_id) REFERENCES public.procedure_executions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_agent_procedure_sessions_workspace_status
  ON public.agent_procedure_sessions(workspace_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_procedure_sessions_chat_status
  ON public.agent_procedure_sessions(chat_id, status, updated_at DESC)
  WHERE chat_id IS NOT NULL;

ALTER TABLE public.agent_decision_ledger
  ADD COLUMN IF NOT EXISTS procedure_session_id uuid;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'agent_decision_ledger'
      AND column_name = 'procedure_execution_id'
  ) THEN
    EXECUTE $sql$
      UPDATE public.agent_decision_ledger ledger
      SET procedure_session_id = ledger.procedure_execution_id
      WHERE ledger.procedure_session_id IS NULL
        AND ledger.procedure_execution_id IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM public.agent_procedure_sessions session
          WHERE session.id = ledger.procedure_execution_id
        )
    $sql$;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_agent_decision_ledger_procedure_session
  ON public.agent_decision_ledger(procedure_session_id)
  WHERE procedure_session_id IS NOT NULL;

ALTER TABLE public.resource_mapping_ledger
  ADD COLUMN IF NOT EXISTS procedure_session_id uuid;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'resource_mapping_ledger'
      AND column_name = 'procedure_execution_id'
  ) THEN
    EXECUTE $sql$
      UPDATE public.resource_mapping_ledger ledger
      SET procedure_session_id = ledger.procedure_execution_id
      WHERE ledger.procedure_session_id IS NULL
        AND ledger.procedure_execution_id IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM public.agent_procedure_sessions session
          WHERE session.id = ledger.procedure_execution_id
        )
    $sql$;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_resource_mapping_ledger_procedure_session
  ON public.resource_mapping_ledger(procedure_session_id)
  WHERE procedure_session_id IS NOT NULL;
