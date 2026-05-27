import { generateDocumentQueryEmbedding } from '@/lib/embeddings';
import type { KnowledgeBaseDocument } from '@/lib/types';
import { VectorStore, type CaseMemoryMatch } from '@/lib/vector-store';
import type { AutopilotIntentResolution, UniversalAutopilotIntent } from '@/services/autopilot/intent-types';

const DOCUMENT_LIMIT = 4;
const CASE_LIMIT = 3;
const DOCUMENT_MIN_SIMILARITY = 0.72;
const CASE_MIN_SIMILARITY = 0.74;

const DOCUMENT_MIN_SIMILARITY_BY_INTENT: Partial<Record<UniversalAutopilotIntent, number>> = {
    pricing_request: 0.76,
    billing_or_payment: 0.74,
    troubleshooting: 0.68,
    support_request: 0.68,
    complaint: 0.7,
    human_handoff: 0.78,
    cancellation_request: 0.74,
};

export type ResolvedCasePromptItem = {
    summary: string;
    problem: string;
    resolution: string;
    outcome: string;
    closeReasonLabel?: string | null;
    keywords: string[];
    similarity: number;
};

function dedupeDocumentsByContent(matches: KnowledgeBaseDocument[]) {
    const seen = new Set<string>();
    return matches.filter((item) => {
        const key = `${item.name}::${item.content}`;
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
}

function formatCaseMatch(match: CaseMemoryMatch): ResolvedCasePromptItem {
    return {
        summary: match.summary,
        problem: match.problem || '',
        resolution: match.resolution || '',
        outcome: match.outcome || '',
        closeReasonLabel: match.close_reason_label,
        keywords: match.keywords || [],
        similarity: Number(match.similarity || 0),
    };
}

function getDocumentMinSimilarity(intent?: AutopilotIntentResolution | null) {
    if (!intent) return DOCUMENT_MIN_SIMILARITY;
    return DOCUMENT_MIN_SIMILARITY_BY_INTENT[intent.intent] ?? DOCUMENT_MIN_SIMILARITY;
}

function metadataValue<T>(metadata: Record<string, unknown> | null, key: string): T | undefined {
    return metadata?.[key] as T | undefined;
}

export async function retrieveSupportContext(input: {
    workspaceId: string;
    autopilotConfigId?: string | null;
    query: string;
    excludeChatId?: string | null;
    intent?: AutopilotIntentResolution | null;
    allowedDocumentIds?: string[];
}) {
    const queryText = input.query.trim();
    if (queryText.length < 4) {
        return {
            knowledgeBaseDocuments: [] as KnowledgeBaseDocument[],
            resolvedCases: [] as ResolvedCasePromptItem[],
        };
    }

    const queryVector = await generateDocumentQueryEmbedding(queryText);
    if (queryVector.length === 0) {
        return {
            knowledgeBaseDocuments: [] as KnowledgeBaseDocument[],
            resolvedCases: [] as ResolvedCasePromptItem[],
        };
    }

    const minSimilarity = getDocumentMinSimilarity(input.intent);
    const docMatches = await VectorStore.searchSimilarDocuments({
        vector: queryVector,
        workspaceId: input.workspaceId,
        autopilotConfigId: input.autopilotConfigId ?? null,
        limit: DOCUMENT_LIMIT,
        minSimilarity,
        allowedDocumentIds: input.allowedDocumentIds,
    });

    let finalDocMatches = docMatches;

    const keywordMatches = await VectorStore.searchKeywordDocuments({
        query: queryText,
        workspaceId: input.workspaceId,
        autopilotConfigId: input.autopilotConfigId ?? null,
        limit: DOCUMENT_LIMIT,
        excludeIds: finalDocMatches.map((match) => match.id),
        allowedDocumentIds: input.allowedDocumentIds,
    }).catch((error) => {
        console.warn('[RAG] Keyword retrieval failed:', error);
        return [];
    });
    finalDocMatches = [...finalDocMatches, ...keywordMatches].slice(0, DOCUMENT_LIMIT * 2);

    const caseMatches = await VectorStore.searchSimilarCaseMemories({
        vector: queryVector,
        workspaceId: input.workspaceId,
        autopilotConfigId: input.autopilotConfigId ?? null,
        excludeChatId: input.excludeChatId ?? null,
        limit: CASE_LIMIT,
        minSimilarity: CASE_MIN_SIMILARITY,
    });

    const finalCaseMatches = caseMatches;

    const knowledgeBaseDocuments = dedupeDocumentsByContent(
        finalDocMatches.map((match) => ({
            id: match.document_id,
            name: match.document_name || `Documento ${match.document_id}`,
            content: match.content,
            source: Number(match.similarity || 0) > 0 ? 'vector' : 'keyword',
            priority: Math.round(Number((match as any).keyword_score || match.similarity || 0) * 100),
            category: metadataValue<string | null>(match.metadata, 'category') ?? null,
            tags: metadataValue<string[] | null>(match.metadata, 'tags') ?? null,
            status: metadataValue<string | null>(match.metadata, 'status') ?? 'active',
            validFrom: metadataValue<string | null>(match.metadata, 'validFromTimestamp') ?? null,
            validUntil: metadataValue<string | null>(match.metadata, 'validUntilTimestamp') ?? null,
            audience: metadataValue<string | string[] | null>(match.metadata, 'audience') ?? null,
            workflowHints: metadataValue<string[] | null>(match.metadata, 'workflowHints') ?? null,
            requiredTools: metadataValue<string[] | null>(match.metadata, 'requiredTools') ?? null,
            canonicalAnswer: metadataValue<string | null>(match.metadata, 'canonicalAnswer') ?? null,
            collectionIds: metadataValue<string[] | null>(match.metadata, 'collectionIds') ?? undefined,
            contextRole: metadataValue<string | null>(match.metadata, 'contextRole') ?? null,
            chunkIndex: metadataValue<number | null>(match.metadata, 'chunkIndex') ?? null,
            chunkCount: metadataValue<number | null>(match.metadata, 'chunkCount') ?? null,
        }))
    );

    return {
        knowledgeBaseDocuments,
        resolvedCases: finalCaseMatches.map(formatCaseMatch),
        diagnostics: {
            queryVectorLength: queryVector.length,
            documentMinSimilarity: minSimilarity,
            vectorMatches: docMatches.length,
            keywordMatches: keywordMatches.length,
            caseMatches: finalCaseMatches.length,
            rawDocumentMatches: finalDocMatches.map((match) => ({
                id: match.id,
                documentId: match.document_id,
                documentName: match.document_name,
                similarity: Number(match.similarity || 0),
                keywordScore: Number((match as any).keyword_score || 0),
                source: Number(match.similarity || 0) > 0 ? 'vector' : 'keyword',
            })),
            allowedDocumentIds: input.allowedDocumentIds || null,
        },
    };
}
