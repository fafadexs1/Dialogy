CREATE TABLE IF NOT EXISTS public.agent_decision_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  chat_id uuid,
  message_id uuid,
  orchestrator_run_id uuid,
  system_agent_id uuid,
  autopilot_config_id uuid,
  procedure_session_id uuid,
  decision_type text NOT NULL,
  goal text,
  procedure_id text,
  step_id text,
  selected_tool text,
  selected_tools_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  blocked_tools_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  missing_slots_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  policy_result_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  resource_mappings_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  response_instruction text,
  confidence numeric,
  latency_ms integer,
  outcome_json jsonb,
  outcome_recorded_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT agent_decision_ledger_workspace_id_fkey
    FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE,
  CONSTRAINT agent_decision_ledger_chat_id_fkey
    FOREIGN KEY (chat_id) REFERENCES public.chats(id) ON DELETE SET NULL,
  CONSTRAINT agent_decision_ledger_message_id_fkey
    FOREIGN KEY (message_id) REFERENCES public.messages(id) ON DELETE SET NULL,
  CONSTRAINT agent_decision_ledger_orchestrator_run_id_fkey
    FOREIGN KEY (orchestrator_run_id) REFERENCES public.orchestrator_runs(id) ON DELETE SET NULL,
  CONSTRAINT agent_decision_ledger_system_agent_id_fkey
    FOREIGN KEY (system_agent_id) REFERENCES public.system_agents(id) ON DELETE SET NULL,
  CONSTRAINT agent_decision_ledger_autopilot_config_id_fkey
    FOREIGN KEY (autopilot_config_id) REFERENCES public.autopilot_configs(id) ON DELETE SET NULL,
  CONSTRAINT agent_decision_ledger_procedure_session_id_fkey
    FOREIGN KEY (procedure_session_id) REFERENCES public.procedure_executions(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_decision_ledger_workspace_created
  ON public.agent_decision_ledger(workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_decision_ledger_chat_created
  ON public.agent_decision_ledger(chat_id, created_at DESC)
  WHERE chat_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_agent_decision_ledger_run
  ON public.agent_decision_ledger(orchestrator_run_id)
  WHERE orchestrator_run_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_agent_decision_ledger_config_stage
  ON public.agent_decision_ledger(autopilot_config_id, created_at DESC)
  WHERE autopilot_config_id IS NOT NULL;
