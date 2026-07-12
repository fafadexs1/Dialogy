import { db } from './db';
import { DOCUMENT_EMBEDDING_DIMENSIONS, DOCUMENT_EMBEDDING_MODEL } from './embeddings';

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

export type DeleteDocumentEmbeddingsInput = {
    documentId: string;
    workspaceId: string;
    /**
     * Pass null only for embeddings that explicitly do not belong to an agent.
     * Requiring the property prevents an accidental workspace-wide deletion.
     */
    autopilotConfigId: string | null;
};

type SearchSimilarDocumentsInput = {
    vector: number[];
    workspaceId: string;
    autopilotConfigId?: string | null;
    limit?: number;
    minSimilarity?: number;
    excludeIds?: string[];
    allowedDocumentIds?: string[];
};

type KeywordDocumentMatch = DocumentEmbeddingMatch & {
    keyword_score: number;
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

function assertDocumentVectorDimensions(vector: number[]) {
    if (vector.length !== DOCUMENT_EMBEDDING_DIMENSIONS) {
        throw new Error(
            `Embedding dimension mismatch for ${DOCUMENT_EMBEDDING_MODEL}: expected ${DOCUMENT_EMBEDDING_DIMENSIONS}, received ${vector.length}.`,
        );
    }
}

export const VectorStore = {
    async deleteDocumentEmbeddings(input: DeleteDocumentEmbeddingsInput) {
        if (!input.documentId?.trim()) {
            throw new Error('documentId is required to delete document embeddings.');
        }
        if (!input.workspaceId?.trim()) {
            throw new Error('workspaceId is required to delete document embeddings.');
        }

        const params: Array<string> = [input.documentId, input.workspaceId];
        const filters = [
            'document_id = $1',
            'workspace_id = $2',
        ];

        if (input.autopilotConfigId === undefined) {
            throw new Error('autopilotConfigId is required to delete document embeddings.');
        }
        if (input.autopilotConfigId === null) {
            filters.push('autopilot_config_id IS NULL');
        } else {
            if (!input.autopilotConfigId.trim()) {
                throw new Error('autopilotConfigId must be a non-empty string when provided.');
            }
            params.push(input.autopilotConfigId);
            filters.push(`autopilot_config_id = $${params.length}`);
        }

        await db.query(
            `DELETE FROM embeddings_documents WHERE ${filters.join(' AND ')}`,
            params,
        );
    },

    async addDocumentEmbedding(input: AddDocumentEmbeddingInput) {
        assertDocumentVectorDimensions(input.vector);
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
                JSON.stringify({
                    embeddingModel: DOCUMENT_EMBEDDING_MODEL,
                    embeddingDimensions: DOCUMENT_EMBEDDING_DIMENSIONS,
                    ...(input.metadata ?? {}),
                }),
            ]
        );
    },

    async getDocumentEmbeddingStats(input: {
        workspaceId: string;
        autopilotConfigId?: string | null;
        documentIds?: string[];
    }) {
        const params: any[] = [input.workspaceId];
        const filters = ['workspace_id = $1'];

        if (input.autopilotConfigId) {
            params.push(input.autopilotConfigId);
            filters.push(`autopilot_config_id = $${params.length}`);
        }

        if ((input.documentIds ?? []).length > 0) {
            params.push(input.documentIds);
            filters.push(`document_id = ANY($${params.length}::uuid[])`);
        }

        const { rows } = await db.query(
            `SELECT
                document_id,
                document_name,
                COUNT(*)::int AS chunks,
                MIN(created_at) AS first_indexed_at,
                MAX(created_at) AS last_indexed_at,
                MIN(vector_dims(vector))::int AS min_dims,
                MAX(vector_dims(vector))::int AS max_dims,
                COUNT(*) FILTER (
                    WHERE vector_dims(vector) <> ${DOCUMENT_EMBEDDING_DIMENSIONS}
                       OR COALESCE(metadata->>'embeddingModel', '') <> '${DOCUMENT_EMBEDDING_MODEL}'
                       OR COALESCE(metadata->>'contentFormat', '') <> 'markdown'
                )::int AS wrong_dims,
                jsonb_agg(DISTINCT metadata->>'contentHash') FILTER (WHERE metadata ? 'contentHash') AS content_hashes,
                jsonb_agg(DISTINCT metadata->>'indexingStatus') FILTER (WHERE metadata ? 'indexingStatus') AS statuses
             FROM embeddings_documents
             WHERE ${filters.join(' AND ')}
             GROUP BY document_id, document_name
             ORDER BY MAX(created_at) DESC`,
            params,
        );

        return rows;
    },

    async searchKeywordDocuments(input: {
        query: string;
        workspaceId: string;
        autopilotConfigId?: string | null;
        limit?: number;
        excludeIds?: string[];
        excludeDocumentIds?: string[];
        allowedDocumentIds?: string[];
    }): Promise<KeywordDocumentMatch[]> {
        const tokens = Array.from(new Set(
            input.query
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .toLowerCase()
                .split(/[^a-z0-9]+/g)
                .filter((token) => token.length >= 3)
        )).slice(0, 12);

        if (tokens.length === 0) return [];

        const params: any[] = [input.workspaceId];
        const filters = [
            'workspace_id = $1',
            `COALESCE(metadata->>'status', 'active') NOT IN ('draft', 'archived', 'expired', 'inactive')`,
            `(NULLIF(metadata->>'validFromTimestamp', '') IS NULL OR (metadata->>'validFromTimestamp')::timestamptz <= NOW())`,
            `(NULLIF(metadata->>'validUntilTimestamp', '') IS NULL OR (metadata->>'validUntilTimestamp')::timestamptz >= NOW())`,
        ];
        const scoreParts: string[] = [];
        const keywordConditions: string[] = [];
        params.push(input.query.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase());
        const normalizedQueryParam = `$${params.length}`;
        const searchableText = `lower(COALESCE(document_name, '') || ' ' || content || ' ' || COALESCE(metadata->>'canonicalAnswer', ''))`;
        const textSearchRank = `ts_rank_cd(to_tsvector('simple', ${searchableText}), plainto_tsquery('simple', ${normalizedQueryParam}))`;
        keywordConditions.push(`to_tsvector('simple', ${searchableText}) @@ plainto_tsquery('simple', ${normalizedQueryParam})`);
        scoreParts.push(`(${textSearchRank} * 12)`);
        scoreParts.push(`CASE WHEN ${searchableText} LIKE ('%' || ${normalizedQueryParam} || '%') THEN 8 ELSE 0 END`);

        if (input.autopilotConfigId) {
            params.push(input.autopilotConfigId);
            filters.push(`autopilot_config_id = $${params.length}`);
        }

        if ((input.excludeIds ?? []).length > 0) {
            params.push(input.excludeIds);
            filters.push(`id <> ALL($${params.length}::uuid[])`);
        }
        if ((input.excludeDocumentIds ?? []).length > 0) {
            params.push(input.excludeDocumentIds);
            filters.push(`document_id <> ALL($${params.length}::uuid[])`);
        }
        if (input.allowedDocumentIds) {
            if (input.allowedDocumentIds.length === 0) return [];
            params.push(input.allowedDocumentIds);
            filters.push(`document_id = ANY($${params.length}::uuid[])`);
        }

        for (const token of tokens) {
            params.push(`%${token}%`);
            const param = `$${params.length}`;
            keywordConditions.push(`(unaccent(lower(content)) LIKE ${param} OR unaccent(lower(COALESCE(document_name, ''))) LIKE ${param} OR unaccent(lower(COALESCE(metadata->>'canonicalAnswer', ''))) LIKE ${param})`);
            scoreParts.push(`CASE WHEN unaccent(lower(content)) LIKE ${param} THEN 1 ELSE 0 END`);
            scoreParts.push(`CASE WHEN unaccent(lower(COALESCE(document_name, ''))) LIKE ${param} THEN 3 ELSE 0 END`);
            scoreParts.push(`CASE WHEN unaccent(lower(COALESCE(metadata->>'canonicalAnswer', ''))) LIKE ${param} THEN 2 ELSE 0 END`);
        }
        filters.push(`(${keywordConditions.join(' OR ')})`);

        params.push(input.limit ?? 5);
        const limitParam = `$${params.length}`;

        try {
            const { rows } = await db.query(
                `SELECT
                    id,
                    content,
                    document_id,
                    document_name,
                    workspace_id,
                    autopilot_config_id,
                    metadata,
                    0::float AS similarity,
                    (${scoreParts.join(' + ')})::float AS keyword_score
                 FROM embeddings_documents
                 WHERE ${filters.join(' AND ')}
                 ORDER BY keyword_score DESC, created_at DESC
                 LIMIT ${limitParam}`,
                params,
            );

            return rows.filter((row) => Number(row.keyword_score || 0) > 0);
        } catch (error) {
            if ((error as any)?.code !== '42883') throw error;

            const withoutUnaccent = (sql: string) => sql
                .replace(/unaccent\(lower\(content\)\)/g, 'lower(content)')
                .replace(/unaccent\(lower\(COALESCE\(document_name, ''\)\)\)/g, "lower(COALESCE(document_name, ''))")
                .replace(/unaccent\(lower\(COALESCE\(metadata->>'canonicalAnswer', ''\)\)\)/g, "lower(COALESCE(metadata->>'canonicalAnswer', ''))");
            const fallbackFilters = filters.map(withoutUnaccent);
            const fallbackScoreParts = scoreParts.map(withoutUnaccent);
            const { rows } = await db.query(
                `SELECT
                    id,
                    content,
                    document_id,
                    document_name,
                    workspace_id,
                    autopilot_config_id,
                    metadata,
                    0::float AS similarity,
                    (${fallbackScoreParts.join(' + ')})::float AS keyword_score
                 FROM embeddings_documents
                 WHERE ${fallbackFilters.join(' AND ')}
                 ORDER BY keyword_score DESC, created_at DESC
                 LIMIT ${limitParam}`,
                params,
            );

            return rows.filter((row) => Number(row.keyword_score || 0) > 0);
        }
    },

    async searchSimilarDocuments(input: SearchSimilarDocumentsInput): Promise<DocumentEmbeddingMatch[]> {
        assertDocumentVectorDimensions(input.vector);
        const vectorStr = toVectorString(input.vector);
        const limit = input.limit ?? 5;
        const minSimilarity = input.minSimilarity ?? 0;
        const excludeIds = input.excludeIds ?? [];

        const params: any[] = [vectorStr, input.workspaceId, limit, minSimilarity, DOCUMENT_EMBEDDING_MODEL];
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
        if (input.allowedDocumentIds) {
            if (input.allowedDocumentIds.length === 0) return [];
            params.push(input.allowedDocumentIds);
            excludeFilter += ` AND document_id = ANY($${params.length}::uuid[])`;
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
               AND metadata->>'embeddingModel' = $5
               AND COALESCE(metadata->>'status', 'active') NOT IN ('draft', 'archived', 'expired', 'inactive')
               AND (NULLIF(metadata->>'validFromTimestamp', '') IS NULL OR (metadata->>'validFromTimestamp')::timestamptz <= NOW())
               AND (NULLIF(metadata->>'validUntilTimestamp', '') IS NULL OR (metadata->>'validUntilTimestamp')::timestamptz >= NOW())
               AND 1 - (vector <=> $1) >= $4
             ORDER BY vector <=> $1 ASC
             LIMIT $3`,
            params
        );

        return rows;
    },

    async upsertCaseMemory(input: UpsertCaseMemoryInput) {
        assertDocumentVectorDimensions(input.vector);
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
                JSON.stringify({
                    embeddingModel: DOCUMENT_EMBEDDING_MODEL,
                    embeddingDimensions: DOCUMENT_EMBEDDING_DIMENSIONS,
                    ...(input.metadata ?? {}),
                }),
                vectorStr,
            ]
        );
    },

    async deleteCaseMemoryByChatId(chatId: string) {
        await db.query(`DELETE FROM chat_case_memories WHERE chat_id = $1`, [chatId]);
    },

    async searchSimilarCaseMemories(input: SearchSimilarCaseMemoriesInput): Promise<CaseMemoryMatch[]> {
        assertDocumentVectorDimensions(input.vector);
        const vectorStr = toVectorString(input.vector);
        const limit = input.limit ?? 5;
        const minSimilarity = input.minSimilarity ?? 0;
        const params: any[] = [vectorStr, input.workspaceId, limit, minSimilarity, DOCUMENT_EMBEDDING_MODEL];
        const filters: string[] = [`metadata->>'embeddingModel' = $5`];

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
