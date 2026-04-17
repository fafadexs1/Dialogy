CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS embeddings_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content TEXT NOT NULL,
  vector extensions.vector(768),
  document_id UUID,
  workspace_id UUID,
  autopilot_config_id UUID,
  document_name TEXT,
  source_type TEXT NOT NULL DEFAULT 'knowledge_base_document',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE IF EXISTS embeddings_documents
  ADD COLUMN IF NOT EXISTS workspace_id UUID,
  ADD COLUMN IF NOT EXISTS autopilot_config_id UUID,
  ADD COLUMN IF NOT EXISTS document_name TEXT,
  ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'knowledge_base_document',
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS embeddings_documents_vector_idx
  ON embeddings_documents USING hnsw (vector extensions.vector_cosine_ops);

CREATE INDEX IF NOT EXISTS idx_embeddings_documents_doc_id
  ON embeddings_documents(document_id);

CREATE INDEX IF NOT EXISTS idx_embeddings_documents_workspace_id
  ON embeddings_documents(workspace_id);

CREATE INDEX IF NOT EXISTS idx_embeddings_documents_workspace_config
  ON embeddings_documents(workspace_id, autopilot_config_id);

CREATE TABLE IF NOT EXISTS chat_case_memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id UUID NOT NULL UNIQUE,
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
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS chat_case_memories_vector_idx
  ON chat_case_memories USING hnsw (vector extensions.vector_cosine_ops);

CREATE INDEX IF NOT EXISTS idx_chat_case_memories_workspace_id
  ON chat_case_memories(workspace_id);

CREATE INDEX IF NOT EXISTS idx_chat_case_memories_workspace_config
  ON chat_case_memories(workspace_id, autopilot_config_id);

CREATE INDEX IF NOT EXISTS idx_chat_case_memories_contact_id
  ON chat_case_memories(contact_id);

CREATE TABLE IF NOT EXISTS embeddings_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content TEXT NOT NULL,
  vector extensions.vector(384),
  message_id UUID,
  chat_id UUID,
  role TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS embeddings_messages_vector_idx
  ON embeddings_messages USING hnsw (vector extensions.vector_cosine_ops);

CREATE INDEX IF NOT EXISTS idx_embeddings_messages_chat_id
  ON embeddings_messages(chat_id);

CREATE INDEX IF NOT EXISTS idx_embeddings_messages_role
  ON embeddings_messages(role);
