import type { KnowledgeBaseDocument } from '@/lib/types';
import { db } from '@/lib/db';
import type { AutopilotIntentResolution, KnowledgeCoverage } from '@/services/autopilot/intent-types';
import type { ResolvedCasePromptItem } from './retrieval';

const DEFAULT_SELECTED_DOCUMENT_LIMIT = 5;
const MAX_DOCUMENTS_PER_CATEGORY = 2;

export type KnowledgeRetrievalStrategy =
  | 'vector'
  | 'vector_static'
  | 'static_documents'
  | 'none';

export type HybridKnowledgeRetrievalResult = {
  knowledgeBaseDocuments: KnowledgeBaseDocument[];
  resolvedCases: ResolvedCasePromptItem[];
  strategy: KnowledgeRetrievalStrategy;
  knowledgeCoverage: KnowledgeCoverage;
  retrieved: {
    vectorDocuments: number;
    staticDocuments: number;
    resolvedCases: number;
  };
  selected: Array<{
    id: string;
    name: string;
    category: string;
    score: number;
    source: 'vector' | 'static';
  }>;
  discarded: Array<{
    id: string;
    name: string;
    reason: string;
    source: 'vector' | 'static';
  }>;
  fallbackReason?: string | null;
  error?: string | null;
  diagnostics?: Record<string, unknown> | null;
};

type ScoredDocument = {
  document: KnowledgeBaseDocument;
  score: number;
  source: 'vector' | 'static';
  category: string;
};

type BaseRetrievalInput = {
  workspaceId: string;
  autopilotConfigId?: string | null;
  query: string;
  excludeChatId?: string | null;
};

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeCategory(value: string | null | undefined): string {
  return normalize(String(value || 'uncategorized')).replace(/[\s-]+/g, '_') || 'uncategorized';
}

function getDocumentValue(document: KnowledgeBaseDocument, keys: string[]): unknown {
  const raw = document as KnowledgeBaseDocument & Record<string, unknown>;
  for (const key of keys) {
    const value = raw[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return null;
}

function getDocumentCategory(document: KnowledgeBaseDocument): string {
  const category = getDocumentValue(document, ['category', 'type', 'kind']);
  if (typeof category === 'string' && category.trim()) return normalizeCategory(category);

  const tags = getDocumentValue(document, ['tags']);
  if (Array.isArray(tags)) {
    const first = tags.find((tag) => typeof tag === 'string' && tag.trim());
    if (typeof first === 'string') return normalizeCategory(first);
  }

  return 'uncategorized';
}

function getDocumentCategories(document: KnowledgeBaseDocument): string[] {
  const tags = getDocumentValue(document, ['tags']);
  const hints = getDocumentValue(document, ['workflowHints', 'workflow_hints']);
  return Array.from(new Set([
    getDocumentCategory(document),
    ...(Array.isArray(tags) ? tags : []),
    ...(Array.isArray(hints) ? hints : []),
  ]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .flatMap((value) => value.split(/[;,]/g))
    .map(normalizeCategory)));
}

function getCanonicalAnswer(document: KnowledgeBaseDocument): string {
  const value = getDocumentValue(document, ['canonicalAnswer', 'canonical_answer']);
  return typeof value === 'string' ? value.trim() : '';
}

function getDocumentPriority(document: KnowledgeBaseDocument): number {
  const value = Number(getDocumentValue(document, ['priority']));
  return Number.isFinite(value) ? value : 0;
}

function parseDate(value: unknown): number | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function isDocumentUsable(document: KnowledgeBaseDocument): boolean {
  const content = String(document.content || '').trim();
  if (!content && !getCanonicalAnswer(document)) return false;

  const status = normalizeCategory(String(getDocumentValue(document, ['status']) || 'active'));
  if (status === 'draft' || status === 'archived' || status === 'expired' || status === 'inactive') return false;

  const now = Date.now();
  const validFrom = parseDate(getDocumentValue(document, ['validFrom', 'valid_from']));
  const validUntil = parseDate(getDocumentValue(document, ['validUntil', 'valid_until']));
  if (validFrom && validFrom > now) return false;
  if (validUntil && validUntil < now) return false;

  return true;
}

function tokenize(value: string): string[] {
  return Array.from(new Set(
    normalize(value)
      .split(/[^a-z0-9_]+/g)
      .filter((token) => token.length >= 3)
  ));
}

function countKeywordOverlap(queryTokens: string[], document: KnowledgeBaseDocument): number {
  if (queryTokens.length === 0) return 0;
  const haystack = normalize(`${document.name || ''}\n${document.summary || ''}\n${document.content || ''}\n${getCanonicalAnswer(document)}`);
  return queryTokens.filter((token) => haystack.includes(token)).length;
}

function matchesIntentCategory(document: KnowledgeBaseDocument, intent?: AutopilotIntentResolution | null): boolean {
  if (!intent) return false;
  const documentCategories = getDocumentCategories(document);
  const intentCategories = intent.knowledgeCategories.map((category) => normalizeCategory(String(category)));
  return documentCategories.some((category) => (
    intentCategories.some((target) => category === target || category.includes(target) || target.includes(category))
  ));
}

function stableDocumentKey(document: KnowledgeBaseDocument): string {
  const contentKey = normalize(String(document.content || getCanonicalAnswer(document))).slice(0, 700);
  return contentKey || normalize(document.name || document.id || 'doc');
}

function hydrateVectorDocumentFromStatic(
  vectorDocument: KnowledgeBaseDocument,
  staticDocuments?: KnowledgeBaseDocument[] | null
): KnowledgeBaseDocument {
  const fullDocument = (staticDocuments || []).find((document) => document.id === vectorDocument.id);
  if (!fullDocument) return vectorDocument;

  return {
    ...fullDocument,
    source: vectorDocument.source || 'vector',
    priority: vectorDocument.priority ?? fullDocument.priority,
  };
}

function scoreStaticDocument(input: {
  document: KnowledgeBaseDocument;
  queryTokens: string[];
  intent?: AutopilotIntentResolution | null;
}): ScoredDocument | null {
  if (!isDocumentUsable(input.document)) return null;

  const categoryMatch = matchesIntentCategory(input.document, input.intent);
  const keywordOverlap = countKeywordOverlap(input.queryTokens, input.document);
  const canonicalAnswer = getCanonicalAnswer(input.document);
  const category = getDocumentCategory(input.document);
  let score = 20;

  if (categoryMatch) score += 90;
  score += Math.min(8, keywordOverlap) * 12;
  score += Math.max(0, Math.min(20, getDocumentPriority(input.document))) * 3;
  if (canonicalAnswer) score += 35;
  if (category === 'persona' || category === 'brand_voice') score -= 35;
  if (category === 'internal_only') score -= 120;

  return {
    document: input.document,
    score,
    source: 'static',
    category,
  };
}

function scoreVectorDocument(input: {
  document: KnowledgeBaseDocument;
  queryTokens: string[];
  intent?: AutopilotIntentResolution | null;
}): ScoredDocument | null {
  if (!String(input.document.content || '').trim()) return null;

  const category = getDocumentCategory(input.document);
  let score = 75;
  const source = String(getDocumentValue(input.document, ['source']) || '');
  const priority = Number(getDocumentValue(input.document, ['priority']));
  if (source === 'keyword') score += 18;
  if (Number.isFinite(priority)) score += Math.min(40, Math.max(0, priority));
  if (matchesIntentCategory(input.document, input.intent)) score += 45;
  score += Math.min(6, countKeywordOverlap(input.queryTokens, input.document)) * 8;

  return {
    document: input.document,
    score,
    source: 'vector',
    category,
  };
}

let ragLogTableReady = false;

async function ensureRagLogTable() {
  if (ragLogTableReady) return true;
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS rag_retrieval_logs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id uuid NOT NULL,
        autopilot_config_id uuid,
        query text NOT NULL,
        intent text,
        strategy text,
        knowledge_coverage text,
        selected jsonb NOT NULL DEFAULT '[]'::jsonb,
        discarded jsonb NOT NULL DEFAULT '[]'::jsonb,
        diagnostics jsonb NOT NULL DEFAULT '{}'::jsonb,
        error text,
        created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
      );
      CREATE INDEX IF NOT EXISTS idx_rag_retrieval_logs_workspace_created
        ON rag_retrieval_logs(workspace_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_rag_retrieval_logs_config_created
        ON rag_retrieval_logs(autopilot_config_id, created_at DESC);
    `);
    ragLogTableReady = true;
    return true;
  } catch (error) {
    console.warn('[RAG] Could not ensure rag_retrieval_logs table:', error);
    return false;
  }
}

async function logRagRetrieval(input: BaseRetrievalInput & {
  intent?: AutopilotIntentResolution | null;
  result: Pick<HybridKnowledgeRetrievalResult, 'strategy' | 'knowledgeCoverage' | 'selected' | 'discarded' | 'diagnostics' | 'error'>;
}) {
  if (!(await ensureRagLogTable())) return;
  try {
    await db.query(
      `INSERT INTO rag_retrieval_logs (
        workspace_id,
        autopilot_config_id,
        query,
        intent,
        strategy,
        knowledge_coverage,
        selected,
        discarded,
        diagnostics,
        error
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        input.workspaceId,
        input.autopilotConfigId || null,
        input.query,
        input.intent?.intent || null,
        input.result.strategy,
        input.result.knowledgeCoverage,
        JSON.stringify(input.result.selected),
        JSON.stringify(input.result.discarded),
        JSON.stringify(input.result.diagnostics || {}),
        input.result.error || null,
      ],
    );
  } catch (error) {
    console.warn('[RAG] Failed to log retrieval:', error);
  }
}

export function mergeAndRerankKnowledgeDocuments(input: {
  vectorDocuments?: KnowledgeBaseDocument[] | null;
  staticDocuments?: KnowledgeBaseDocument[] | null;
  query: string;
  intent?: AutopilotIntentResolution | null;
  limit?: number;
}): Pick<HybridKnowledgeRetrievalResult, 'knowledgeBaseDocuments' | 'strategy' | 'knowledgeCoverage' | 'selected' | 'discarded'> {
  const queryTokens = tokenize(input.query);
  const scored: ScoredDocument[] = [
    ...(input.vectorDocuments || []).map((document) => scoreVectorDocument({
      document: hydrateVectorDocumentFromStatic(document, input.staticDocuments),
      queryTokens,
      intent: input.intent,
    })),
    ...(input.staticDocuments || []).map((document) => scoreStaticDocument({ document, queryTokens, intent: input.intent })),
  ].filter((item): item is ScoredDocument => Boolean(item));

  const seen = new Set<string>();
  const categoryCounts = new Map<string, number>();
  const selected: ScoredDocument[] = [];
  const discarded: HybridKnowledgeRetrievalResult['discarded'] = [];
  const limit = input.limit ?? DEFAULT_SELECTED_DOCUMENT_LIMIT;

  for (const item of scored.sort((left, right) => right.score - left.score || left.document.name.localeCompare(right.document.name))) {
    const key = stableDocumentKey(item.document);
    if (seen.has(key)) {
      discarded.push({ id: item.document.id, name: item.document.name, reason: 'duplicate_content', source: item.source });
      continue;
    }

    const countForCategory = categoryCounts.get(item.category) || 0;
    if (countForCategory >= MAX_DOCUMENTS_PER_CATEGORY && selected.some((selectedItem) => selectedItem.source === item.source)) {
      discarded.push({ id: item.document.id, name: item.document.name, reason: 'category_limit', source: item.source });
      continue;
    }

    selected.push(item);
    seen.add(key);
    categoryCounts.set(item.category, countForCategory + 1);

    if (selected.length >= limit) break;
  }

  const hasVector = selected.some((item) => item.source === 'vector');
  const hasStatic = selected.some((item) => item.source === 'static');
  const strategy: KnowledgeRetrievalStrategy = hasVector && hasStatic
    ? 'vector_static'
    : hasVector
      ? 'vector'
      : hasStatic
        ? 'static_documents'
        : 'none';
  const topScore = selected[0]?.score || 0;
  const knowledgeCoverage: KnowledgeCoverage = selected.length === 0
    ? 'none'
    : topScore >= 120 || Boolean(input.intent?.officialResponse)
      ? 'high'
      : topScore >= 75
        ? 'medium'
        : 'low';

  return {
    knowledgeBaseDocuments: selected.map((item) => item.document),
    strategy,
    knowledgeCoverage,
    selected: selected.map((item) => ({
      id: item.document.id,
      name: item.document.name,
      category: item.category,
      score: item.score,
      source: item.source,
    })),
    discarded,
  };
}

export async function retrieveHybridSupportContext(input: BaseRetrievalInput & {
  staticDocuments?: KnowledgeBaseDocument[] | null;
  intent?: AutopilotIntentResolution | null;
}): Promise<HybridKnowledgeRetrievalResult> {
  try {
    const { retrieveSupportContext } = await import('./retrieval');
    const vectorRetrieval = await retrieveSupportContext({
      workspaceId: input.workspaceId,
      autopilotConfigId: input.autopilotConfigId ?? null,
      query: input.query,
      excludeChatId: input.excludeChatId ?? null,
      intent: input.intent ?? null,
    });
    const merged = mergeAndRerankKnowledgeDocuments({
      vectorDocuments: vectorRetrieval.knowledgeBaseDocuments,
      staticDocuments: input.staticDocuments,
      query: input.query,
      intent: input.intent,
    });

    const result: HybridKnowledgeRetrievalResult = {
      ...merged,
      resolvedCases: vectorRetrieval.resolvedCases,
      retrieved: {
        vectorDocuments: vectorRetrieval.knowledgeBaseDocuments.length,
        staticDocuments: input.staticDocuments?.length || 0,
        resolvedCases: vectorRetrieval.resolvedCases.length,
      },
      diagnostics: (vectorRetrieval as any).diagnostics || null,
      fallbackReason: merged.strategy === 'static_documents' ? 'vector_returned_no_selected_documents' : null,
    };
    await logRagRetrieval({ ...input, result });
    return result;
  } catch (error) {
    const merged = mergeAndRerankKnowledgeDocuments({
      vectorDocuments: [],
      staticDocuments: input.staticDocuments,
      query: input.query,
      intent: input.intent,
    });

    if (merged.knowledgeBaseDocuments.length === 0) {
      throw error;
    }

    const result: HybridKnowledgeRetrievalResult = {
      ...merged,
      resolvedCases: [],
      retrieved: {
        vectorDocuments: 0,
        staticDocuments: input.staticDocuments?.length || 0,
        resolvedCases: 0,
      },
      fallbackReason: 'vector_retrieval_error',
      error: error instanceof Error ? error.message : String(error),
    };
    await logRagRetrieval({ ...input, result });
    return result;
  }
}
