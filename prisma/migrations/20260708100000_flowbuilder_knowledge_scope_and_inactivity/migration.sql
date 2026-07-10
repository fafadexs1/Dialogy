ALTER TABLE IF EXISTS public.autopilot_configs
  ADD COLUMN IF NOT EXISTS inactivity_timeout_seconds integer;

ALTER TABLE IF EXISTS public.rag_retrieval_logs
  ADD COLUMN IF NOT EXISTS chat_id uuid,
  ADD COLUMN IF NOT EXISTS orchestrator_run_id uuid;

CREATE INDEX IF NOT EXISTS idx_rag_retrieval_logs_chat_created
  ON public.rag_retrieval_logs(chat_id, created_at DESC)
  WHERE chat_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_rag_retrieval_logs_run
  ON public.rag_retrieval_logs(orchestrator_run_id)
  WHERE orchestrator_run_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'rag_retrieval_logs_chat_id_fkey'
      AND conrelid = 'public.rag_retrieval_logs'::regclass
  ) THEN
    ALTER TABLE public.rag_retrieval_logs
      ADD CONSTRAINT rag_retrieval_logs_chat_id_fkey
      FOREIGN KEY (chat_id) REFERENCES public.chats(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'rag_retrieval_logs_orchestrator_run_id_fkey'
      AND conrelid = 'public.rag_retrieval_logs'::regclass
  ) THEN
    ALTER TABLE public.rag_retrieval_logs
      ADD CONSTRAINT rag_retrieval_logs_orchestrator_run_id_fkey
      FOREIGN KEY (orchestrator_run_id) REFERENCES public.orchestrator_runs(id) ON DELETE SET NULL;
  END IF;
END $$;
