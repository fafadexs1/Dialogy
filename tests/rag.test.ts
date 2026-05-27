import { describe, it, expect } from 'vitest';
import { randomUUID } from 'crypto';
import { DOCUMENT_EMBEDDING_DIMENSIONS, generateDocumentPassageEmbedding, generateDocumentQueryEmbedding } from '@/lib/embeddings';
import { VectorStore } from '@/lib/vector-store';
import { db } from '@/lib/db';

async function createCaseMemoryFixture(workspaceId: string, chatId: string) {
    const userId = randomUUID();
    const contactId = randomUUID();

    await db.query(
        `INSERT INTO users (id, full_name, email)
         VALUES ($1, $2, $3)
         ON CONFLICT (id) DO NOTHING`,
        [userId, 'RAG Test User', `rag-${userId}@example.test`]
    );

    await db.query(
        `INSERT INTO workspaces (id, name, owner_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (id) DO NOTHING`,
        [workspaceId, 'RAG Test Workspace', userId]
    );

    await db.query(
        `INSERT INTO contacts (id, workspace_id, name)
         VALUES ($1, $2, $3)
         ON CONFLICT (id) DO NOTHING`,
        [contactId, workspaceId, 'RAG Test Contact']
    );

    await db.query(
        `INSERT INTO chats (id, workspace_id, contact_id, status)
         VALUES ($1, $2, $3, 'encerrados')
         ON CONFLICT (id) DO NOTHING`,
        [chatId, workspaceId, contactId]
    );

    return { contactId };
}

describe('RAG Integration Tests', () => {
    it('should generate and store a knowledge base document embedding scoped by workspace', async () => {
        const workspaceId = randomUUID();
        const testContent = 'Politica de reembolso: validar comprovante, aprovar solicitacao e orientar prazo.';
        const testDocId = randomUUID();

        const vector = await generateDocumentPassageEmbedding(testContent);
        expect(vector).toBeDefined();
        expect(vector.length).toBe(DOCUMENT_EMBEDDING_DIMENSIONS);

        await expect(VectorStore.addDocumentEmbedding({
            documentId: testDocId,
            workspaceId,
            documentName: 'Politica de reembolso',
            content: testContent,
            vector,
        })).resolves.not.toThrow();

        const searchVector = await generateDocumentQueryEmbedding('como funciona o reembolso');
        const results = await VectorStore.searchSimilarDocuments({
            vector: searchVector,
            workspaceId,
            limit: 10,
            minSimilarity: 0,
        });

        expect(results.length).toBeGreaterThan(0);
        const match = results.find((r) => r.document_id === testDocId);
        if (match) {
            expect(match.content).toContain(testContent);
        }
    }, 120000);

    it('should upsert and retrieve a resolved case memory scoped by workspace', async () => {
        const workspaceId = randomUUID();
        const chatId = randomUUID();
        const { contactId } = await createCaseMemoryFixture(workspaceId, chatId);
        const searchableContent = [
            'Resumo: cliente pediu segunda via de boleto.',
            'Problema: cliente nao encontrou o boleto.',
            'Resolucao: reenviar boleto e confirmar vencimento.',
            'Resultado: boleto reenviado com sucesso.',
        ].join('\n');

        const vector = await generateDocumentPassageEmbedding(searchableContent);
        expect(vector).toBeDefined();
        expect(vector.length).toBe(DOCUMENT_EMBEDDING_DIMENSIONS);

        await expect(VectorStore.upsertCaseMemory({
            chatId,
            workspaceId,
            contactId,
            summary: 'Segunda via de boleto enviada',
            problem: 'Cliente nao encontrou o boleto',
            resolution: 'Reenviar boleto e confirmar vencimento',
            outcome: 'Boleto reenviado com sucesso',
            keywords: ['boleto', 'segunda via'],
            searchableContent,
            vector,
        })).resolves.not.toThrow();

        const searchVector = await generateDocumentQueryEmbedding('preciso da segunda via do boleto');
        const results = await VectorStore.searchSimilarCaseMemories({
            vector: searchVector,
            workspaceId,
            limit: 10,
            minSimilarity: 0,
        });

        expect(results.length).toBeGreaterThan(0);
        const match = results.find((r) => r.chat_id === chatId);
        if (match) {
            expect(match.summary).toContain('boleto');
        }
    }, 120000);
});
