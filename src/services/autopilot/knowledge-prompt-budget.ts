import type { KnowledgeBaseDocument } from '@/lib/types';

/**
 * Knowledge documents are trimmed to fit the agent prompt. Cutting mid-line is
 * actively harmful: the model completes the truncated pattern (half a price
 * table becomes an invented price), and the response validator then rejects
 * facts whose evidence was sliced away. Every cut here lands on a structural
 * boundary, so a table row, a price or a URL is either fully present or absent.
 */

function promptCharsEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const MAX_PROMPT_DOCUMENT_CHARS = promptCharsEnv('AUTOPILOT_PROMPT_DOCUMENT_MAX_CHARS', 4000);
export const MAX_PROMPT_DOCUMENT_TOTAL_CHARS = promptCharsEnv('AUTOPILOT_PROMPT_DOCUMENTS_TOTAL_MAX_CHARS', 16000);
/** Below this, a slice cannot carry a complete fact and only adds noise. */
export const MIN_PROMPT_DOCUMENT_CHARS = 400;

export function normalizeKnowledgeContent(content: string): string {
  return String(content || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Truncates at the last structural boundary that fits, preferring the largest
 * unit: blank line, then line, then sentence. Returns '' when no boundary is
 * usable (a single very long line), so callers drop the document rather than
 * emit a fragment the model would try to complete.
 */
export function truncateAtSafeBoundary(content: string, maxChars: number): string {
  if (maxChars <= 0) return '';
  if (content.length <= maxChars) return content;

  const window = content.slice(0, maxChars);
  const boundaries = [
    window.lastIndexOf('\n\n'),
    window.lastIndexOf('\n'),
    Math.max(window.lastIndexOf('. '), window.lastIndexOf('.\n')),
  ];

  for (const boundary of boundaries) {
    // Keep at least half the budget, otherwise an early boundary would discard
    // content that still fits cleanly.
    if (boundary >= Math.floor(maxChars / 2)) {
      const sliced = content.slice(0, boundary).trim();
      if (sliced) return `${sliced}\n…`;
    }
  }

  return '';
}

export function resolvePromptDocumentLimit(document: KnowledgeBaseDocument): number {
  return typeof document.maxPromptChars === 'number'
    && Number.isFinite(document.maxPromptChars)
    && document.maxPromptChars > 0
    ? Math.floor(document.maxPromptChars)
    : MAX_PROMPT_DOCUMENT_CHARS;
}

export function resolvePromptDocumentsTotalLimit(documents: KnowledgeBaseDocument[]): number {
  const configuredExtra = (documents || []).reduce((total, document) => {
    const limit = resolvePromptDocumentLimit(document);
    return total + Math.max(0, limit - MAX_PROMPT_DOCUMENT_CHARS);
  }, 0);
  return MAX_PROMPT_DOCUMENT_TOTAL_CHARS + configuredExtra;
}

export function compactKnowledgeDocumentsForPrompt(
  documents: KnowledgeBaseDocument[],
): KnowledgeBaseDocument[] {
  let totalChars = 0;
  const compacted: KnowledgeBaseDocument[] = [];
  const totalLimit = resolvePromptDocumentsTotalLimit(documents);

  for (const document of documents || []) {
    const rawContent = normalizeKnowledgeContent(document.content || '');
    if (!rawContent) continue;

    const remaining = totalLimit - totalChars;
    if (remaining < MIN_PROMPT_DOCUMENT_CHARS) break;

    const maxForDocument = Math.min(resolvePromptDocumentLimit(document), remaining);
    const content = truncateAtSafeBoundary(rawContent, maxForDocument);
    if (!content) continue;

    compacted.push({ ...document, content });
    totalChars += content.length;
  }

  return compacted;
}
