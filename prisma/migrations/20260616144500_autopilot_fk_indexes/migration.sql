CREATE INDEX IF NOT EXISTS idx_agent_decision_ledger_message_id_fk
  ON public.agent_decision_ledger(message_id);

CREATE INDEX IF NOT EXISTS idx_agent_decision_ledger_system_agent_id_fk
  ON public.agent_decision_ledger(system_agent_id);

CREATE INDEX IF NOT EXISTS idx_agent_decision_ledger_autopilot_config_id_fk
  ON public.agent_decision_ledger(autopilot_config_id);

CREATE INDEX IF NOT EXISTS idx_resource_mapping_ledger_message_id_fk
  ON public.resource_mapping_ledger(message_id);

CREATE INDEX IF NOT EXISTS idx_agent_procedure_sessions_agent_id_fk
  ON public.agent_procedure_sessions(agent_id);

CREATE INDEX IF NOT EXISTS idx_agent_causal_patterns_agent_id_fk
  ON public.agent_causal_patterns(agent_id);

CREATE INDEX IF NOT EXISTS idx_agent_score_history_agent_id_fk
  ON public.agent_score_history(agent_id);

CREATE INDEX IF NOT EXISTS idx_agent_score_history_evidence_pattern_id_fk
  ON public.agent_score_history(evidence_pattern_id);
