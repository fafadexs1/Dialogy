ALTER TABLE public.agent_score_history
  ADD COLUMN IF NOT EXISTS autopilot_config_id uuid,
  ADD COLUMN IF NOT EXISTS reason text,
  ADD COLUMN IF NOT EXISTS created_by_user_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'agent_score_history_autopilot_config_id_fkey'
      AND conrelid = 'public.agent_score_history'::regclass
  ) THEN
    ALTER TABLE public.agent_score_history
      ADD CONSTRAINT agent_score_history_autopilot_config_id_fkey
      FOREIGN KEY (autopilot_config_id)
      REFERENCES public.autopilot_configs(id)
      ON DELETE CASCADE
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'agent_score_history_created_by_user_id_fkey'
      AND conrelid = 'public.agent_score_history'::regclass
  ) THEN
    ALTER TABLE public.agent_score_history
      ADD CONSTRAINT agent_score_history_created_by_user_id_fkey
      FOREIGN KEY (created_by_user_id)
      REFERENCES public.users(id)
      ON DELETE SET NULL
      NOT VALID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_agent_score_history_config
  ON public.agent_score_history(autopilot_config_id, applied_at DESC)
  WHERE autopilot_config_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_agent_score_history_created_by_user_id_fk
  ON public.agent_score_history(created_by_user_id)
  WHERE created_by_user_id IS NOT NULL;
