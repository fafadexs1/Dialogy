import type { KnowledgeBaseDocument } from '@/lib/types';
import { RecursiveCharacterTextSplitter } from '@/lib/text-splitter';
import { getCanonicalKnowledgeAnswer } from './document-safety';

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

/**
 * Preenche os campos curados antes do parse do zod.
 *
 * Sem isto, dois vazamentos silenciosos: documentos antigos usam
 * `canonical_answer` em vez de `canonicalAnswer` e o zod descartaria a grafia
 * nao declarada; e `contextRole` costuma estar implicito na categoria, entao
 * so seria enviado quando alguem o preencheu na mao.
 */
export function enrichKnowledgeDocumentsForPrompt(
  documents: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  return (documents || []).map((document) => {
    const typed = document as unknown as KnowledgeBaseDocument;
    const canonicalAnswer = getCanonicalKnowledgeAnswer(typed);
    return {
      ...document,
      canonicalAnswer: canonicalAnswer || null,
      contextRole: inferKnowledgeContextRole(typed) || null,
    };
  });
}

function validTimestamp(value: string | null | undefined): string | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function markdownTitle(document: Pick<KnowledgeBaseDocument, 'name'>): string {
  return String(document.name || 'Documento')
    .replace(/\.(?:md|txt|csv|json)$/i, '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/^#+\s*/, '')
    .trim() || 'Documento';
}

export function toCanonicalKnowledgeMarkdown(document: Pick<KnowledgeBaseDocument, 'name' | 'content'>): string {
  const content = String(document.content || '').replace(/\r\n/g, '\n').trim();
  if (!content) return '';
  if (/^#\s+\S/m.test(content)) return content;
  return `# ${markdownTitle(document)}\n\n${content}`;
}

export function buildKnowledgeChunkMetadata(document: KnowledgeBaseDocument) {
  return {
    contentFormat: 'markdown',
    sourceFormat: document.sourceFormat ?? 'markdown',
    originalFilename: document.originalFilename ?? null,
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
  return (await splitKnowledgeDocumentWithMetadata(document)).map((chunk) => chunk.content);
}

export type KnowledgeDocumentChunk = {
  content: string;
  parentContent: string | null;
  parentHeading: string | null;
};

function splitMarkdownSections(markdown: string): Array<{ heading: string | null; content: string }> {
  const sections: Array<{ heading: string | null; lines: string[] }> = [];
  let current = { heading: null as string | null, lines: [] as string[] };

  for (const line of markdown.split('\n')) {
    if (/^#{1,4}\s+\S/.test(line) && current.lines.some((item) => item.trim())) {
      sections.push(current);
      current = { heading: line.replace(/^#{1,4}\s+/, '').trim(), lines: [line] };
      continue;
    }
    if (/^#{1,4}\s+\S/.test(line)) {
      current.heading = line.replace(/^#{1,4}\s+/, '').trim();
    }
    current.lines.push(line);
  }

  if (current.lines.some((item) => item.trim())) sections.push(current);
  return sections.map((section) => ({
    heading: section.heading,
    content: section.lines.join('\n').trim(),
  }));
}

export async function splitKnowledgeDocumentWithMetadata(document: KnowledgeBaseDocument): Promise<KnowledgeDocumentChunk[]> {
  const role = inferKnowledgeContextRole(document);
  const category = categoryOf(document);
  const isCatalog = /(catalog|plan|pricing|price|promotion|offer|product|service)/i.test(category);
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: isCatalog ? 620 : role === 'fact' ? 760 : 900,
    chunkOverlap: isCatalog ? 0 : role === 'fact' ? 60 : 100,
    preserveHeadings: true,
  });
  const markdown = toCanonicalKnowledgeMarkdown(document);
  const sections = splitMarkdownSections(markdown);
  const useParentContext = role === 'procedure' || role === 'policy';
  const chunks: KnowledgeDocumentChunk[] = [];

  for (const section of sections) {
    const sectionChunks = await splitter.splitText(section.content);
    for (const content of sectionChunks) {
      const parentContent = useParentContext && section.content.length > content.length
        ? section.content.slice(0, 2800)
        : null;
      chunks.push({
        content,
        parentContent,
        parentHeading: parentContent ? section.heading : null,
      });
    }
  }

  return chunks;
}

export function hasKnowledgeDocumentIndexChanged(
  previous: KnowledgeBaseDocument | undefined,
  next: KnowledgeBaseDocument,
): boolean {
  if (!previous) return true;
  if (previous.name !== next.name) return true;
  if (toCanonicalKnowledgeMarkdown(previous) !== toCanonicalKnowledgeMarkdown(next)) return true;
  return JSON.stringify(buildKnowledgeChunkMetadata(previous)) !== JSON.stringify(buildKnowledgeChunkMetadata(next));
}

export function partitionKnowledgeDocuments(documents: KnowledgeBaseDocument[]) {
  return documents.reduce((partition, document) => {
    const role = inferKnowledgeContextRole(document);
    if (role === 'fact') partition.facts.push(document);
    else partition.procedures.push(document);
    return partition;
  }, { facts: [] as KnowledgeBaseDocument[], procedures: [] as KnowledgeBaseDocument[] });
}
