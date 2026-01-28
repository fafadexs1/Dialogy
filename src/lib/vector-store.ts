import { db } from './db';

interface DocumentEmbeddingMatch {
    id: string;
    content: string;
    similarity: number;
    document_id: string;
}

interface MessageEmbeddingMatch {
    id: string;
    content: string;
    similarity: number;
    message_id: string;
    chat_id: string;
    role: string;
    created_at: string;
}

export const VectorStore = {
    /**
     * Add a document embedding to the database.
     */
    async addDocumentEmbedding(documentId: string, content: string, vector: number[]) {
        // Format vector as string for pgvector: '[1.0, 2.0, ...]'
        const vectorStr = `[${vector.join(',')}]`;

        await db.query(
            `INSERT INTO embeddings_documents (content, vector, document_id) VALUES ($1, $2, $3)`,
            [content, vectorStr, documentId]
        );
    },

    /**
     * Add a message embedding to the database.
     */
    async addMessageEmbedding(messageId: string, chatId: string, content: string, role: string, vector: number[]) {
        const vectorStr = `[${vector.join(',')}]`;

        await db.query(
            `INSERT INTO embeddings_messages (content, vector, message_id, chat_id, role) VALUES ($1, $2, $3, $4, $5)`,
            [content, vectorStr, messageId, chatId, role]
        );
    },

    /**
     * Search for similar documents using cosine similarity.
     */
    async searchSimilarDocuments(vector: number[], limit: number = 5): Promise<DocumentEmbeddingMatch[]> {
        const vectorStr = `[${vector.join(',')}]`;

        // 1 - (vector <=> query) gives cosine similarity (1 is identical, -1 opposite)
        // <=> is cosine distance (0 is identical, 2 opposite). 
        // Usually we want distance minimal. Order by distance ASC.
        const { rows } = await db.query(
            `SELECT id, content, document_id, 1 - (vector <=> $1) as similarity
             FROM embeddings_documents
             ORDER BY vector <=> $1 ASC
             LIMIT $2`,
            [vectorStr, limit]
        );

        return rows;
    },

    /**
     * Search for similar messages, optionally filtering by chat_id.
     */
    async searchSimilarMessages(vector: number[], chatId?: string, limit: number = 10): Promise<MessageEmbeddingMatch[]> {
        const vectorStr = `[${vector.join(',')}]`;

        let query = `
            SELECT id, content, message_id, chat_id, role, created_at, 1 - (vector <=> $1) as similarity
            FROM embeddings_messages
        `;
        const params: any[] = [vectorStr, limit];

        if (chatId) {
            query += ` WHERE chat_id = $3`;
            params.push(chatId);
        }

        query += ` ORDER BY vector <=> $1 ASC LIMIT $2`;

        const { rows } = await db.query(query, params);
        return rows;
    }
};
