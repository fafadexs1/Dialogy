import { DOCUMENT_EMBEDDING_DIMENSIONS, DOCUMENT_EMBEDDING_MODEL, generateDocumentPassageEmbedding } from '@/lib/embeddings';
import type { KnowledgeBaseDocument } from '@/lib/types';
import { VectorStore } from '@/lib/vector-store';
import { createHash } from 'crypto';
import { isUnsafeAsCustomerFacingKnowledge } from './document-safety';
import { buildKnowledgeChunkMetadata, splitKnowledgeDocument } from './knowledge-document';

type IngestKnowledgeBaseDocumentInput = {
    workspaceId: string;
    autopilotConfigId?: string | null;
    documentId: string;
    documentName: string;
    content: string;
    document?: KnowledgeBaseDocument;
};

export async function ingestKnowledgeBaseDocument(input: IngestKnowledgeBaseDocumentInput) {
    console.log(`[RAG] Processing document ${input.documentId}.`);
    const document: KnowledgeBaseDocument = input.document
        ? { ...input.document, id: input.documentId, name: input.documentName, content: input.content }
        : { id: input.documentId, name: input.documentName, content: input.content };

    if (isUnsafeAsCustomerFacingKnowledge(document)) {
        await VectorStore.deleteDocumentEmbeddings(input.documentId);
        console.warn(`[RAG] Skipping unsafe conversation artifact ${input.documentId}.`);
        return {
            status: 'skipped_unsafe' as const,
            chunks: 0,
        };
    }

    const documentMetadata = buildKnowledgeChunkMetadata(document);
    const metadataHash = createHash('sha256').update(JSON.stringify(documentMetadata)).digest('hex');
    const contentHash = createHash('sha256').update(`${input.content}\n${metadataHash}`).digest('hex');
    const existingStats = await VectorStore.getDocumentEmbeddingStats({
        workspaceId: input.workspaceId,
        autopilotConfigId: input.autopilotConfigId ?? null,
        documentIds: [input.documentId],
    }).catch(() => []);
    const existing = existingStats[0];
    const existingHashes = Array.isArray(existing?.content_hashes) ? existing.content_hashes : [];
    if (
        existing &&
        Number(existing.chunks || 0) > 0 &&
        Number(existing.wrong_dims || 0) === 0 &&
        existingHashes.length === 1 &&
        existingHashes[0] === contentHash
    ) {
        console.log(`[RAG] Document ${input.documentId} unchanged; skipping embedding regeneration.`);
        return {
            status: 'skipped_unchanged' as const,
            chunks: Number(existing.chunks || 0),
            contentHash,
        };
    }

    const chunks = await splitKnowledgeDocument(document);
    await VectorStore.deleteDocumentEmbeddings(input.documentId);

    let embeddedChunks = 0;
    for (let index = 0; index < chunks.length; index++) {
        const chunk = chunks[index];
        const vector = await generateDocumentPassageEmbedding(chunk);
        if (vector.length === 0) {
            continue;
        }

        await VectorStore.addDocumentEmbedding({
            documentId: input.documentId,
            workspaceId: input.workspaceId,
            autopilotConfigId: input.autopilotConfigId ?? null,
            documentName: input.documentName,
            content: chunk,
            vector,
            metadata: {
                contentHash,
                metadataHash,
                chunkIndex: index,
                chunkCount: chunks.length,
                chunkLength: chunk.length,
                sourceType: 'knowledge_base_document',
                embeddingModel: DOCUMENT_EMBEDDING_MODEL,
                embeddingDimensions: DOCUMENT_EMBEDDING_DIMENSIONS,
                indexingStatus: 'indexed',
                indexedAt: new Date().toISOString(),
                ...documentMetadata,
            },
        });
        embeddedChunks += 1;
    }

    console.log(`[RAG] Document ${input.documentId} embedded with ${embeddedChunks}/${chunks.length} chunks.`);
    return {
        status: 'indexed' as const,
        chunks: embeddedChunks,
        contentHash,
    };
}
