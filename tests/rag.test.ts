import { describe, it, expect } from 'vitest';
import { randomUUID } from 'crypto';
import { generateDocumentPassageEmbedding, generateDocumentQueryEmbedding } from '@/lib/embeddings';
import { VectorStore } from '@/lib/vector-store';

describe('RAG Integration Tests', () => {
    it('should generate and store a knowledge base document embedding scoped by workspace', async () => {
        const workspaceId = randomUUID();
        const testContent = 'Politica de reembolso: validar comprovante, aprovar solicitacao e orientar prazo.';
        const testDocId = randomUUID();

        const vector = await generateDocumentPassageEmbedding(testContent);
        expect(vector).toBeDefined();
        expect(vector.length).toBe(768);

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
    }, 20000);

    it('should upsert and retrieve a resolved case memory scoped by workspace', async () => {
        const workspaceId = randomUUID();
        const chatId = randomUUID();
        const searchableContent = [
            'Resumo: cliente pediu segunda via de boleto.',
            'Problema: cliente nao encontrou o boleto.',
            'Resolucao: reenviar boleto e confirmar vencimento.',
            'Resultado: boleto reenviado com sucesso.',
        ].join('\n');

        const vector = await generateDocumentPassageEmbedding(searchableContent);
        expect(vector).toBeDefined();
        expect(vector.length).toBe(768);

        await expect(VectorStore.upsertCaseMemory({
            chatId,
            workspaceId,
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
    }, 20000);
});
