ALTER TABLE IF EXISTS public.autopilot_configs
  ADD COLUMN IF NOT EXISTS escalation_policy text,
  ADD COLUMN IF NOT EXISTS closing_policy text;

ALTER TABLE IF EXISTS public.autopilot_usage_logs
  ADD COLUMN IF NOT EXISTS chat_id uuid,
  ADD COLUMN IF NOT EXISTS system_agent_id uuid,
  ADD COLUMN IF NOT EXISTS input_message text,
  ADD COLUMN IF NOT EXISTS output_message text,
  ADD COLUMN IF NOT EXISTS status text,
  ADD COLUMN IF NOT EXISTS metadata jsonb;

CREATE INDEX IF NOT EXISTS idx_autopilot_usage_chat
  ON public.autopilot_usage_logs(chat_id)
  WHERE chat_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_autopilot_usage_system_agent
  ON public.autopilot_usage_logs(system_agent_id)
  WHERE system_agent_id IS NOT NULL;
