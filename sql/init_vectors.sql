-- Enable pgvector extension in the 'extensions' schema
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

-- Create table for Document Embeddings (Knowledge Base) -> Uses E5 (768 dimensions)
CREATE TABLE IF NOT EXISTS embeddings_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content TEXT NOT NULL,
  vector extensions.vector(768), -- multilingual-e5-base
  document_id UUID, -- Reference to your knowledge base documents table
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create table for Message Embeddings (Chat History) -> Uses MiniLM (384 dimensions)
CREATE TABLE IF NOT EXISTS embeddings_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content TEXT NOT NULL,
  vector extensions.vector(384), -- all-MiniLM-L6-v2
  message_id UUID, -- Reference to your messages table
  chat_id UUID, -- For filtering by conversation
  role TEXT, -- 'user', 'agent', 'system'
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create HNSW indexes for fast similarity search
-- Adjust 'm' and 'ef_construction' based on recall/speed needs. Defaults are usually fine.
CREATE INDEX IF NOT EXISTS embeddings_documents_vector_idx ON embeddings_documents USING hnsw (vector extensions.vector_cosine_ops);
CREATE INDEX IF NOT EXISTS embeddings_messages_vector_idx ON embeddings_messages USING hnsw (vector extensions.vector_cosine_ops);

-- Add indexes on foreign keys and filter columns for speed
CREATE INDEX IF NOT EXISTS idx_embeddings_documents_doc_id ON embeddings_documents(document_id);
CREATE INDEX IF NOT EXISTS idx_embeddings_messages_chat_id ON embeddings_messages(chat_id);
CREATE INDEX IF NOT EXISTS idx_embeddings_messages_role ON embeddings_messages(role);
