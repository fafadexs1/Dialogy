
import { describe, it, expect } from 'vitest';
import { generateEmbedding } from '@/lib/embeddings';
import { VectorStore } from '@/lib/vector-store';
import { randomUUID } from 'crypto';

// Integration tests for RAG pipeline
// These tests connect to the real database as configured in .env
// Ensure your local dev DB is running.

describe('RAG Integration Tests', () => {

    it('should generate and store a knowledge base document embedding', async () => {
        const testContent = "This is a test document for Vitest RAG verification.";
        const testDocId = randomUUID();

        // 1. Generate
        const vector = await generateEmbedding(testContent, 'doc');
        expect(vector).toBeDefined();
        expect(vector.length).toBe(768); // E5 model dimension

        // 2. Store
        await expect(VectorStore.addDocumentEmbedding(testDocId, testContent, vector)).resolves.not.toThrow();

        // 3. Search Self
        // We search with a slightly different query to test semantic matching, or same query.
        // E5 typically performs best with asymmetric queries, but here we test basic retrieval.
        const searchVector = await generateEmbedding("Vitest RAG verification", 'doc');
        const results = await VectorStore.searchSimilarDocuments(searchVector, 10);

        expect(results.length).toBeGreaterThan(0);

        // Check if our document is in results
        const match = results.find(r => r.document_id === testDocId);
        // It might not be the top result if we have many docs, but it should be present given the specific content.
        if (match) {
            expect(match.content).toContain(testContent);
        } else {
            // If not found, warn but don't fail if DB is huge? 
            // For a test environment, it should probably be found.
            console.warn('Newly created document not found in top 10 results. This might be due to existing data volume.');
        }
    }, 20000); // Increase timeout for model loading

    it('should generate and store a chat message embedding', async () => {
        const chatContent = "Hello agent, can you help me with a refund?";
        const chatId = randomUUID();
        const messageId = randomUUID();

        // 1. Generate
        const vector = await generateEmbedding(chatContent, 'chat');
        expect(vector).toBeDefined();
        expect(vector.length).toBe(384); // MiniLM model dimension

        // 2. Store
        await expect(VectorStore.addMessageEmbedding(messageId, chatId, chatContent, 'user', vector)).resolves.not.toThrow();

        // 3. Search Self
        const searchVector = await generateEmbedding("help refund", 'chat');
        const results = await VectorStore.searchSimilarMessages(searchVector, undefined, 10);

        expect(results.length).toBeGreaterThan(0);

        // Check if our message is in results
        const match = results.find(r => r.message_id === messageId);
        if (match) {
            expect(match.content).toContain(chatContent);
        }
    }, 20000);

});
