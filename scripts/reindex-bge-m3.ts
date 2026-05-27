import type { KnowledgeBaseDocument } from '../src/lib/types';

let db: typeof import('../src/lib/db')['db'];
let DOCUMENT_EMBEDDING_DIMENSIONS: number;
let DOCUMENT_EMBEDDING_MODEL: string;
let generateDocumentPassageEmbedding: typeof import('../src/lib/embeddings')['generateDocumentPassageEmbedding'];
let VectorStore: typeof import('../src/lib/vector-store')['VectorStore'];
let isUnsafeAsCustomerFacingKnowledge: typeof import('../src/services/rag/document-safety')['isUnsafeAsCustomerFacingKnowledge'];
let ingestKnowledgeBaseDocument: typeof import('../src/services/rag/document-ingestion')['ingestKnowledgeBaseDocument'];

async function reindexDocuments() {
  const { rows } = await db.query(
    `SELECT id, workspace_id, knowledge_base_documents
     FROM autopilot_configs
     WHERE knowledge_base_documents IS NOT NULL`,
  );
  let documents = 0;

  for (const config of rows) {
    const knowledge = (Array.isArray(config.knowledge_base_documents) ? config.knowledge_base_documents : []) as KnowledgeBaseDocument[];
    for (const document of knowledge) {
      if (!document.content?.trim() || isUnsafeAsCustomerFacingKnowledge(document)) continue;
      await ingestKnowledgeBaseDocument({
        workspaceId: config.workspace_id,
        autopilotConfigId: config.id,
        documentId: document.id,
        documentName: document.name,
        content: document.content,
        document,
      });
      documents += 1;
    }
  }

  return documents;
}

async function reindexCaseMemories() {
  const { rows } = await db.query(
    `SELECT *
     FROM chat_case_memories
     WHERE searchable_content IS NOT NULL AND searchable_content <> ''`,
  );

  for (const memory of rows) {
    const vector = await generateDocumentPassageEmbedding(memory.searchable_content);
    await VectorStore.upsertCaseMemory({
      chatId: memory.chat_id,
      workspaceId: memory.workspace_id,
      contactId: memory.contact_id,
      autopilotConfigId: memory.autopilot_config_id,
      summary: memory.summary,
      problem: memory.problem,
      resolution: memory.resolution,
      outcome: memory.outcome,
      closeReasonTagId: memory.close_reason_tag_id,
      closeReasonLabel: memory.close_reason_label,
      keywords: memory.keywords,
      searchableContent: memory.searchable_content,
      vector,
      metadata: {
        ...(memory.metadata || {}),
        embeddingModel: DOCUMENT_EMBEDDING_MODEL,
        embeddingDimensions: DOCUMENT_EMBEDDING_DIMENSIONS,
        embeddingStatus: 'indexed',
        indexedAt: new Date().toISOString(),
      },
    });
  }

  return rows.length;
}

async function main() {
  if (process.env.NODE_ENV !== 'production') {
    await import('dotenv/config');
  }
  ({ db } = await import('../src/lib/db'));
  ({
    DOCUMENT_EMBEDDING_DIMENSIONS,
    DOCUMENT_EMBEDDING_MODEL,
    generateDocumentPassageEmbedding,
  } = await import('../src/lib/embeddings'));
  ({ VectorStore } = await import('../src/lib/vector-store'));
  ({ isUnsafeAsCustomerFacingKnowledge } = await import('../src/services/rag/document-safety'));
  ({ ingestKnowledgeBaseDocument } = await import('../src/services/rag/document-ingestion'));

  if (DOCUMENT_EMBEDDING_MODEL !== 'bge-m3' || DOCUMENT_EMBEDDING_DIMENSIONS !== 1024) {
    throw new Error('Reindexacao BGE-M3 requer o perfil documental BGE-M3 de 1024 dimensoes.');
  }

  const documents = await reindexDocuments();
  const caseMemories = await reindexCaseMemories();
  console.log(`BGE-M3 reindex completed: ${documents} documents and ${caseMemories} case memories.`);
}

void main()
  .catch((error) => {
    console.error('BGE-M3 reindex failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (db) await db.end();
  });
