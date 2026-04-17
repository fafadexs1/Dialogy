import { db } from './db';

export interface DocumentEmbeddingMatch {
    id: string;
    content: string;
    similarity: number;
    document_id: string;
    document_name: string | null;
    workspace_id: string | null;
    autopilot_config_id: string | null;
    metadata: Record<string, unknown> | null;
}

export interface CaseMemoryMatch {
    id: string;
    chat_id: string;
    workspace_id: string;
    autopilot_config_id: string | null;
    summary: string;
    problem: string | null;
    resolution: string | null;
    outcome: string | null;
    close_reason_label: string | null;
    keywords: string[];
    similarity: number;
    metadata: Record<string, unknown> | null;
}

type AddDocumentEmbeddingInput = {
    documentId: string;
    workspaceId: string;
    autopilotConfigId?: string | null;
    documentName: string;
    content: string;
    vector: number[];
    metadata?: Record<string, unknown>;
};

type SearchSimilarDocumentsInput = {
    vector: number[];
    workspaceId: string;
    autopilotConfigId?: string | null;
    limit?: number;
    minSimilarity?: number;
    excludeIds?: string[];
};

type UpsertCaseMemoryInput = {
    chatId: string;
    workspaceId: string;
    contactId?: string | null;
    autopilotConfigId?: string | null;
    summary: string;
    problem?: string | null;
    resolution?: string | null;
    outcome?: string | null;
    closeReasonTagId?: string | null;
    closeReasonLabel?: string | null;
    keywords?: string[];
    searchableContent: string;
    vector: number[];
    metadata?: Record<string, unknown>;
};

type SearchSimilarCaseMemoriesInput = {
    vector: number[];
    workspaceId: string;
    autopilotConfigId?: string | null;
    limit?: number;
    minSimilarity?: number;
    excludeChatId?: string | null;
    excludeIds?: string[];
};

function toVectorString(vector: number[]) {
    return `[${vector.join(',')}]`;
}

export const VectorStore = {
    async deleteDocumentEmbeddings(documentId: string) {
        await db.query(`DELETE FROM embeddings_documents WHERE document_id = $1`, [documentId]);
    },

    async addDocumentEmbedding(input: AddDocumentEmbeddingInput) {
        const vectorStr = toVectorString(input.vector);

        await db.query(
            `INSERT INTO embeddings_documents (
                content,
                vector,
                document_id,
                workspace_id,
                autopilot_config_id,
                document_name,
                metadata
             ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
                input.content,
                vectorStr,
                input.documentId,
                input.workspaceId,
                input.autopilotConfigId ?? null,
                input.documentName,
                JSON.stringify(input.metadata ?? {}),
            ]
        );
    },

    async searchSimilarDocuments(input: SearchSimilarDocumentsInput): Promise<DocumentEmbeddingMatch[]> {
        const vectorStr = toVectorString(input.vector);
        const limit = input.limit ?? 5;
        const minSimilarity = input.minSimilarity ?? 0;
        const excludeIds = input.excludeIds ?? [];

        const params: any[] = [vectorStr, input.workspaceId, limit, minSimilarity];
        let autopilotFilter = '';
        let excludeFilter = '';

        if (input.autopilotConfigId) {
            params.push(input.autopilotConfigId);
            autopilotFilter = `AND autopilot_config_id = $${params.length}`;
        }

        if (excludeIds.length > 0) {
            params.push(excludeIds);
            excludeFilter = `AND id <> ALL($${params.length}::uuid[])`;
        }

        const { rows } = await db.query(
            `SELECT
                id,
                content,
                document_id,
                document_name,
                workspace_id,
                autopilot_config_id,
                metadata,
                1 - (vector <=> $1) AS similarity
             FROM embeddings_documents
             WHERE workspace_id = $2
               ${autopilotFilter}
               ${excludeFilter}
               AND 1 - (vector <=> $1) >= $4
             ORDER BY vector <=> $1 ASC
             LIMIT $3`,
            params
        );

        return rows;
    },

    async upsertCaseMemory(input: UpsertCaseMemoryInput) {
        const vectorStr = toVectorString(input.vector);

        await db.query(
            `INSERT INTO chat_case_memories (
                chat_id,
                workspace_id,
                contact_id,
                autopilot_config_id,
                searchable_content,
                summary,
                problem,
                resolution,
                outcome,
                close_reason_tag_id,
                close_reason_label,
                keywords,
                metadata,
                vector,
                updated_at
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW())
             ON CONFLICT (chat_id) DO UPDATE
             SET
                workspace_id = EXCLUDED.workspace_id,
                contact_id = EXCLUDED.contact_id,
                autopilot_config_id = EXCLUDED.autopilot_config_id,
                searchable_content = EXCLUDED.searchable_content,
                summary = EXCLUDED.summary,
                problem = EXCLUDED.problem,
                resolution = EXCLUDED.resolution,
                outcome = EXCLUDED.outcome,
                close_reason_tag_id = EXCLUDED.close_reason_tag_id,
                close_reason_label = EXCLUDED.close_reason_label,
                keywords = EXCLUDED.keywords,
                metadata = EXCLUDED.metadata,
                vector = EXCLUDED.vector,
                updated_at = NOW()`,
            [
                input.chatId,
                input.workspaceId,
                input.contactId ?? null,
                input.autopilotConfigId ?? null,
                input.searchableContent,
                input.summary,
                input.problem ?? null,
                input.resolution ?? null,
                input.outcome ?? null,
                input.closeReasonTagId ?? null,
                input.closeReasonLabel ?? null,
                input.keywords ?? [],
                JSON.stringify(input.metadata ?? {}),
                vectorStr,
            ]
        );
    },

    async deleteCaseMemoryByChatId(chatId: string) {
        await db.query(`DELETE FROM chat_case_memories WHERE chat_id = $1`, [chatId]);
    },

    async searchSimilarCaseMemories(input: SearchSimilarCaseMemoriesInput): Promise<CaseMemoryMatch[]> {
        const vectorStr = toVectorString(input.vector);
        const limit = input.limit ?? 5;
        const minSimilarity = input.minSimilarity ?? 0;
        const params: any[] = [vectorStr, input.workspaceId, limit, minSimilarity];
        const filters: string[] = [];

        if (input.autopilotConfigId) {
            params.push(input.autopilotConfigId);
            filters.push(`autopilot_config_id = $${params.length}`);
        }

        if (input.excludeChatId) {
            params.push(input.excludeChatId);
            filters.push(`chat_id <> $${params.length}`);
        }

        if ((input.excludeIds ?? []).length > 0) {
            params.push(input.excludeIds);
            filters.push(`id <> ALL($${params.length}::uuid[])`);
        }

        const dynamicWhere = filters.length > 0 ? `AND ${filters.join(' AND ')}` : '';
        const { rows } = await db.query(
            `SELECT
                id,
                chat_id,
                workspace_id,
                autopilot_config_id,
                summary,
                problem,
                resolution,
                outcome,
                close_reason_label,
                keywords,
                metadata,
                1 - (vector <=> $1) AS similarity
             FROM chat_case_memories
             WHERE workspace_id = $2
               ${dynamicWhere}
               AND 1 - (vector <=> $1) >= $4
             ORDER BY vector <=> $1 ASC
             LIMIT $3`,
            params
        );

        return rows;
    },

    async getCaseMemoryByChatId(chatId: string) {
        const { rows } = await db.query(
            `SELECT
                id,
                chat_id,
                workspace_id,
                autopilot_config_id,
                summary,
                problem,
                resolution,
                outcome,
                close_reason_label,
                keywords,
                metadata
             FROM chat_case_memories
             WHERE chat_id = $1
             LIMIT 1`,
            [chatId]
        );

        return rows[0] ?? null;
    },

    // Legacy helpers retained while the old flow is being phased out.
    async addMessageEmbedding(_messageId: string, _chatId: string, _content: string, _role: string, _vector: number[]) {
        console.warn('[VectorStore] addMessageEmbedding is deprecated and ignored.');
    },

    async searchSimilarMessages(_vector: number[], _chatId?: string, _limit: number = 10) {
        return [];
    },
};
