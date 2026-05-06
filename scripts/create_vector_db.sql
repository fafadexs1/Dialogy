-- Habilitar a extensão pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- Criar tabela de chunks de conhecimento
CREATE TABLE IF NOT EXISTS knowledge_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL,
    workspace_id UUID NOT NULL,
    content TEXT NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    embedding vector(1536), -- Usando 1536 dimensões (Padrão para modelos OpenAI como text-embedding-3-small)
    created_at TIMESTAMPTZ DEFAULT clock_timestamp()
);

-- Indexação recomendada pela documentação do pgvector para buscas rápidas (HNSW)
-- Usamos vector_cosine_ops para medir a similaridade usando Cosine Distance
CREATE INDEX IF NOT EXISTS knowledge_chunks_embedding_idx ON knowledge_chunks USING hnsw (embedding vector_cosine_ops);

-- Indexar o workspace_id para acelerar filtros de segurança por cliente (Row Level Security ou filtro manual)
CREATE INDEX IF NOT EXISTS knowledge_chunks_workspace_id_idx ON knowledge_chunks(workspace_id);
