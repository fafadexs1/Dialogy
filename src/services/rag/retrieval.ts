import { generateDocumentQueryEmbedding } from '@/lib/embeddings';
import type { KnowledgeBaseDocument } from '@/lib/types';
import { VectorStore, type CaseMemoryMatch } from '@/lib/vector-store';
import type { AutopilotIntentResolution, UniversalAutopilotIntent } from '@/services/autopilot/intent-types';

const DOCUMENT_LIMIT = 4;
const CASE_LIMIT = 3;
const DOCUMENT_MIN_SIMILARITY = 0.54;
const CASE_MIN_SIMILARITY = 0.74;
const RRF_RANK_CONSTANT = 60;

const DOCUMENT_MIN_SIMILARITY_BY_INTENT: Partial<Record<UniversalAutopilotIntent, number>> = {
    pricing_request: 0.54,
    billing_or_payment: 0.58,
    troubleshooting: 0.58,
    support_request: 0.58,
    complaint: 0.58,
    human_handoff: 0.62,
    cancellation_request: 0.58,
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

function dedupeMatchesByDocumentId<T extends { document_id: string }>(matches: T[]) {
    const seen = new Set<string>();
    return matches.filter((match) => {
        if (seen.has(match.document_id)) return false;
        seen.add(match.document_id);
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

type RankedDocumentMatch = Awaited<ReturnType<typeof VectorStore.searchSimilarDocuments>>[number] & {
    keyword_score?: number;
    retrieval_sources?: string[];
    rrf_score?: number;
};

export function fuseDocumentMatchesWithRrf(input: {
    vectorMatches: RankedDocumentMatch[];
    keywordMatches: RankedDocumentMatch[];
    limit?: number;
}): RankedDocumentMatch[] {
    const fused = new Map<string, RankedDocumentMatch & { retrieval_sources: string[]; rrf_score: number }>();
    const mergeRanking = (matches: RankedDocumentMatch[], source: 'vector' | 'keyword', weight: number) => {
        matches.forEach((match, index) => {
            const score = weight / (RRF_RANK_CONSTANT + index + 1);
            const existing = fused.get(match.document_id);
            if (!existing) {
                fused.set(match.document_id, {
                    ...match,
                    retrieval_sources: [source],
                    rrf_score: score,
                });
                return;
            }
            existing.rrf_score += score;
            if (!existing.retrieval_sources.includes(source)) existing.retrieval_sources.push(source);
            if (source === 'vector') {
                existing.content = match.content;
                existing.similarity = match.similarity;
                existing.metadata = match.metadata;
            }
            existing.keyword_score = Math.max(Number(existing.keyword_score || 0), Number(match.keyword_score || 0));
        });
    };

    mergeRanking(input.vectorMatches, 'vector', 1);
    mergeRanking(input.keywordMatches, 'keyword', 1.15);
    return Array.from(fused.values())
        .sort((left, right) => right.rrf_score - left.rrf_score)
        .slice(0, input.limit ?? DOCUMENT_LIMIT * 2);
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
    const docMatches = dedupeMatchesByDocumentId(await VectorStore.searchSimilarDocuments({
        vector: queryVector,
        workspaceId: input.workspaceId,
        autopilotConfigId: input.autopilotConfigId ?? null,
        limit: DOCUMENT_LIMIT * 3,
        minSimilarity,
        allowedDocumentIds: input.allowedDocumentIds,
    })).slice(0, DOCUMENT_LIMIT * 2);

    const keywordMatches = dedupeMatchesByDocumentId(await VectorStore.searchKeywordDocuments({
        query: queryText,
        workspaceId: input.workspaceId,
        autopilotConfigId: input.autopilotConfigId ?? null,
        limit: DOCUMENT_LIMIT * 3,
        allowedDocumentIds: input.allowedDocumentIds,
    }).catch((error) => {
        console.warn('[RAG] Keyword retrieval failed:', error);
        return [];
    })).slice(0, DOCUMENT_LIMIT * 2);
    const finalDocMatches = fuseDocumentMatchesWithRrf({
        vectorMatches: docMatches,
        keywordMatches,
        limit: DOCUMENT_LIMIT * 2,
    });

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
            content: metadataValue<string | null>(match.metadata, 'parentContent') || match.content,
            source: match.retrieval_sources?.includes('vector') ? 'vector' : 'keyword',
            priority: Math.round(Number(match.rrf_score || 0) * 10000),
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
            parentContent: metadataValue<string | null>(match.metadata, 'parentContent') ?? null,
            parentHeading: metadataValue<string | null>(match.metadata, 'parentHeading') ?? null,
            retrievalSources: match.retrieval_sources ?? null,
            rrfScore: match.rrf_score ?? null,
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
                source: match.retrieval_sources?.join('+') || (Number(match.similarity || 0) > 0 ? 'vector' : 'keyword'),
                rrfScore: Number(match.rrf_score || 0),
            })),
            allowedDocumentIds: input.allowedDocumentIds || null,
        },
    };
}
