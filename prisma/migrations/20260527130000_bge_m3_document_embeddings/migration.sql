DROP INDEX IF EXISTS public.embeddings_documents_vector_idx;
DROP INDEX IF EXISTS public.chat_case_memories_vector_idx;

-- Existing dense vectors were generated with multilingual-e5-base (768d) and
-- cannot be compared to BGE-M3 dense vectors (1024d).
DELETE FROM public.embeddings_documents;

UPDATE public.chat_case_memories
SET
  vector = NULL,
  metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('embeddingStatus', 'pending_bge_m3_reindex')
WHERE vector IS NOT NULL;

ALTER TABLE public.embeddings_documents
  ALTER COLUMN vector TYPE extensions.vector(1024)
  USING NULL::extensions.vector(1024);

ALTER TABLE public.chat_case_memories
  ALTER COLUMN vector TYPE extensions.vector(1024)
  USING NULL::extensions.vector(1024);

CREATE INDEX IF NOT EXISTS embeddings_documents_vector_idx
  ON public.embeddings_documents
  USING hnsw (vector extensions.vector_cosine_ops);

CREATE INDEX IF NOT EXISTS chat_case_memories_vector_idx
  ON public.chat_case_memories
  USING hnsw (vector extensions.vector_cosine_ops);
