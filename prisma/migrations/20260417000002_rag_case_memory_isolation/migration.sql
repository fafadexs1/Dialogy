CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

ALTER TABLE IF EXISTS public.embeddings_documents
  ADD COLUMN IF NOT EXISTS workspace_id UUID,
  ADD COLUMN IF NOT EXISTS autopilot_config_id UUID,
  ADD COLUMN IF NOT EXISTS document_name TEXT,
  ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'knowledge_base_document',
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'embeddings_documents'
  ) THEN
    UPDATE public.embeddings_documents ed
    SET
      workspace_id = ac.workspace_id,
      autopilot_config_id = ac.id,
      document_name = COALESCE(doc.value->>'name', ed.document_name),
      metadata = COALESCE(ed.metadata, '{}'::jsonb) ||
        jsonb_build_object(
          'uploaded_at', doc.value->>'uploaded_at',
          'tokens', doc.value->'tokens'
        )
    FROM public.autopilot_configs ac
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(ac.knowledge_base_documents, '[]'::jsonb)) AS doc(value)
    WHERE ed.document_id IS NOT NULL
      AND (doc.value->>'id')::text = ed.document_id::text
      AND (ed.workspace_id IS NULL OR ed.autopilot_config_id IS NULL OR ed.document_name IS NULL);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_embeddings_documents_workspace_id
  ON public.embeddings_documents(workspace_id);

CREATE INDEX IF NOT EXISTS idx_embeddings_documents_workspace_config
  ON public.embeddings_documents(workspace_id, autopilot_config_id);

CREATE TABLE IF NOT EXISTS public.chat_case_memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id UUID NOT NULL,
  workspace_id UUID NOT NULL,
  contact_id UUID,
  autopilot_config_id UUID,
  searchable_content TEXT NOT NULL,
  summary TEXT NOT NULL,
  problem TEXT,
  resolution TEXT,
  outcome TEXT,
  close_reason_tag_id UUID,
  close_reason_label TEXT,
  keywords TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  vector extensions.vector(768),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chat_case_memories_chat_id_key UNIQUE (chat_id)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chat_case_memories_chat_id_fkey'
  ) THEN
    ALTER TABLE public.chat_case_memories
      ADD CONSTRAINT chat_case_memories_chat_id_fkey
      FOREIGN KEY (chat_id) REFERENCES public.chats(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chat_case_memories_workspace_id_fkey'
  ) THEN
    ALTER TABLE public.chat_case_memories
      ADD CONSTRAINT chat_case_memories_workspace_id_fkey
      FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chat_case_memories_contact_id_fkey'
  ) THEN
    ALTER TABLE public.chat_case_memories
      ADD CONSTRAINT chat_case_memories_contact_id_fkey
      FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chat_case_memories_autopilot_config_id_fkey'
  ) THEN
    ALTER TABLE public.chat_case_memories
      ADD CONSTRAINT chat_case_memories_autopilot_config_id_fkey
      FOREIGN KEY (autopilot_config_id) REFERENCES public.autopilot_configs(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chat_case_memories_close_reason_tag_id_fkey'
  ) THEN
    ALTER TABLE public.chat_case_memories
      ADD CONSTRAINT chat_case_memories_close_reason_tag_id_fkey
      FOREIGN KEY (close_reason_tag_id) REFERENCES public.tags(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_chat_case_memories_workspace_id
  ON public.chat_case_memories(workspace_id);

CREATE INDEX IF NOT EXISTS idx_chat_case_memories_workspace_config
  ON public.chat_case_memories(workspace_id, autopilot_config_id);

CREATE INDEX IF NOT EXISTS idx_chat_case_memories_contact_id
  ON public.chat_case_memories(contact_id);

CREATE INDEX IF NOT EXISTS chat_case_memories_vector_idx
  ON public.chat_case_memories
  USING hnsw (vector extensions.vector_cosine_ops);
