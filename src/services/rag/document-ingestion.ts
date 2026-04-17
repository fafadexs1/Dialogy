import { defaultSplitter } from '@/lib/text-splitter';
import { generateDocumentPassageEmbedding } from '@/lib/embeddings';
import { VectorStore } from '@/lib/vector-store';

type IngestKnowledgeBaseDocumentInput = {
    workspaceId: string;
    autopilotConfigId?: string | null;
    documentId: string;
    documentName: string;
    content: string;
};

export async function ingestKnowledgeBaseDocument(input: IngestKnowledgeBaseDocumentInput) {
    console.log(`[RAG] Processing document ${input.documentId} (${input.documentName})`);

    const chunks = await defaultSplitter.splitText(input.content);
    await VectorStore.deleteDocumentEmbeddings(input.documentId);

    for (const chunk of chunks) {
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
                chunkLength: chunk.length,
                sourceType: 'knowledge_base_document',
            },
        });
    }

    console.log(`[RAG] Document ${input.documentId} embedded with ${chunks.length} chunks.`);
}
