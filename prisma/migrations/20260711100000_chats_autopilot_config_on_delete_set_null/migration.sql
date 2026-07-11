-- Keep conversation history when an autopilot configuration is removed.
-- A chat may retain its history, but can no longer point at a deleted config.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'chats'
      AND column_name = 'autopilot_config_id'
  ) THEN
    ALTER TABLE public.chats
      DROP CONSTRAINT IF EXISTS chats_autopilot_config_id_fkey;

    ALTER TABLE public.chats
      ADD CONSTRAINT chats_autopilot_config_id_fkey
      FOREIGN KEY (autopilot_config_id)
      REFERENCES public.autopilot_configs(id)
      ON DELETE SET NULL
      ON UPDATE CASCADE;
  END IF;
END$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'chats'
      AND column_name = 'autopilot_config_id'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_chats_autopilot_config_id
      ON public.chats(autopilot_config_id)
      WHERE autopilot_config_id IS NOT NULL;
  END IF;
END$$;
