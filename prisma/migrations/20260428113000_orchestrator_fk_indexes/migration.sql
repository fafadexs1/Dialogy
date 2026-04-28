CREATE INDEX IF NOT EXISTS idx_orchestrator_runs_source_message_id
  ON public.orchestrator_runs(source_message_id)
  WHERE source_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orchestrator_runs_system_agent_id
  ON public.orchestrator_runs(system_agent_id)
  WHERE system_agent_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orchestrator_runs_autopilot_config_id
  ON public.orchestrator_runs(autopilot_config_id)
  WHERE autopilot_config_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orchestrator_events_chat_id
  ON public.orchestrator_events(chat_id)
  WHERE chat_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orchestrator_events_parent_event_id
  ON public.orchestrator_events(parent_event_id)
  WHERE parent_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orchestrator_tool_calls_chat_id
  ON public.orchestrator_tool_calls(chat_id)
  WHERE chat_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orchestrator_tool_calls_system_agent_id
  ON public.orchestrator_tool_calls(system_agent_id)
  WHERE system_agent_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orchestrator_tool_calls_autopilot_config_id
  ON public.orchestrator_tool_calls(autopilot_config_id)
  WHERE autopilot_config_id IS NOT NULL;
