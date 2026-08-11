CREATE TABLE IF NOT EXISTS public.autopilot_inactivity_schedules (
  chat_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  autopilot_config_id uuid NOT NULL,
  system_agent_id uuid NOT NULL,
  timeout_seconds integer NOT NULL,
  anchor_at timestamptz NOT NULL,
  due_at timestamptz NOT NULL,
  source_message_id uuid,
  orchestrator_run_id uuid,
  locked_until timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT autopilot_inactivity_schedules_timeout_check CHECK (timeout_seconds > 0),
  CONSTRAINT autopilot_inactivity_schedules_chat_id_fkey
    FOREIGN KEY (chat_id) REFERENCES public.chats(id) ON DELETE CASCADE,
  CONSTRAINT autopilot_inactivity_schedules_workspace_id_fkey
    FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE,
  CONSTRAINT autopilot_inactivity_schedules_config_id_fkey
    FOREIGN KEY (autopilot_config_id) REFERENCES public.autopilot_configs(id) ON DELETE CASCADE,
  CONSTRAINT autopilot_inactivity_schedules_system_agent_id_fkey
    FOREIGN KEY (system_agent_id) REFERENCES public.system_agents(id) ON DELETE CASCADE,
  CONSTRAINT autopilot_inactivity_schedules_source_message_id_fkey
    FOREIGN KEY (source_message_id) REFERENCES public.messages(id) ON DELETE SET NULL,
  CONSTRAINT autopilot_inactivity_schedules_orchestrator_run_id_fkey
    FOREIGN KEY (orchestrator_run_id) REFERENCES public.orchestrator_runs(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_autopilot_inactivity_schedules_due
  ON public.autopilot_inactivity_schedules(due_at, locked_until);
