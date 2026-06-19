ALTER TABLE public.agent_causal_patterns
  ADD COLUMN IF NOT EXISTS reviewed_by_user_id uuid,
  ADD COLUMN IF NOT EXISTS review_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'agent_causal_patterns_reviewed_by_user_id_fkey'
  ) THEN
    ALTER TABLE public.agent_causal_patterns
      ADD CONSTRAINT agent_causal_patterns_reviewed_by_user_id_fkey
      FOREIGN KEY (reviewed_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;
  END IF;
END $$;
