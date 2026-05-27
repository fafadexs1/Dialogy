import type { KnowledgeBaseDocument } from '@/lib/types';
import { RecursiveCharacterTextSplitter } from '@/lib/text-splitter';

export type KnowledgeContextRole = 'fact' | 'procedure' | 'policy' | 'persona';

const FACT_CATEGORY_PATTERN = /(catalog|plan|pricing|price|promotion|offer|product|service|contact|wifi|faq|informacao|info_)/i;
const POLICY_CATEGORY_PATTERN = /(policy|rule|handoff|transfer|close|compliance|regra)/i;
const PROCEDURE_CATEGORY_PATTERN = /(workflow|flow|procedure|required_fields|completion|context|sales|process|roteiro)/i;
const PERSONA_CATEGORY_PATTERN = /(persona|brand_voice|tone)/i;

function categoryOf(document: Pick<KnowledgeBaseDocument, 'category' | 'tags'>): string {
  return [document.category || '', ...(document.tags || [])].join(' ');
}

export function inferKnowledgeContextRole(document: Pick<KnowledgeBaseDocument, 'category' | 'tags' | 'contextRole'>): KnowledgeContextRole {
  if (document.contextRole === 'fact' || document.contextRole === 'procedure' || document.contextRole === 'policy' || document.contextRole === 'persona') {
    return document.contextRole;
  }

  const category = categoryOf(document);
  if (PERSONA_CATEGORY_PATTERN.test(category)) return 'persona';
  if (FACT_CATEGORY_PATTERN.test(category)) return 'fact';
  if (POLICY_CATEGORY_PATTERN.test(category)) return 'policy';
  if (PROCEDURE_CATEGORY_PATTERN.test(category)) return 'procedure';
  return 'fact';
}

function validTimestamp(value: string | null | undefined): string | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

export function buildKnowledgeChunkMetadata(document: KnowledgeBaseDocument) {
  return {
    category: document.category ?? null,
    tags: document.tags ?? null,
    priority: document.priority ?? null,
    status: document.status ?? 'active',
    validFromTimestamp: validTimestamp(document.validFrom),
    validUntilTimestamp: validTimestamp(document.validUntil),
    audience: document.audience ?? null,
    owner: document.owner ?? null,
    updatedAt: document.updatedAt ?? null,
    workflowHints: document.workflowHints ?? null,
    requiredTools: document.requiredTools ?? null,
    canonicalAnswer: document.canonicalAnswer ?? null,
    collectionIds: document.collectionIds ?? null,
    contextRole: inferKnowledgeContextRole(document),
  };
}

export async function splitKnowledgeDocument(document: KnowledgeBaseDocument): Promise<string[]> {
  const role = inferKnowledgeContextRole(document);
  const category = categoryOf(document);
  const isCatalog = /(catalog|plan|pricing|price|promotion|offer|product|service)/i.test(category);
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: isCatalog ? 620 : role === 'fact' ? 760 : 900,
    chunkOverlap: isCatalog ? 0 : role === 'fact' ? 60 : 100,
    preserveHeadings: true,
  });
  return splitter.splitText(document.content);
}

export function partitionKnowledgeDocuments(documents: KnowledgeBaseDocument[]) {
  return documents.reduce((partition, document) => {
    const role = inferKnowledgeContextRole(document);
    if (role === 'fact') partition.facts.push(document);
    else partition.procedures.push(document);
    return partition;
  }, { facts: [] as KnowledgeBaseDocument[], procedures: [] as KnowledgeBaseDocument[] });
}
