import { describe, expect, it } from 'vitest';

import {
  MAX_PROMPT_DOCUMENT_CHARS,
  MAX_PROMPT_DOCUMENT_TOTAL_CHARS,
  compactKnowledgeDocumentsForPrompt,
  truncateAtSafeBoundary,
} from '@/services/autopilot/knowledge-prompt-budget';
import type { KnowledgeBaseDocument } from '@/lib/types';

function doc(overrides: Partial<KnowledgeBaseDocument> & { content: string }): KnowledgeBaseDocument {
  return {
    id: 'doc-1',
    name: 'Documento',
    ...overrides,
  } as KnowledgeBaseDocument;
}

function priceTable(rows: number): string {
  return Array.from({ length: rows }, (_, index) => (
    `Plano ${index + 1} Fibra: R$ ${100 + index},90 por mes`
  )).join('\n');
}

describe('truncateAtSafeBoundary', () => {
  it('returns the content untouched when it fits', () => {
    expect(truncateAtSafeBoundary('Plano A: R$ 99,90', 100)).toBe('Plano A: R$ 99,90');
  });

  it('never cuts inside a line, so a price row is whole or absent', () => {
    const table = priceTable(40);
    const truncated = truncateAtSafeBoundary(table, 500);

    const factLines = truncated.split('\n').filter((line) => line !== '…');
    expect(factLines.length).toBeGreaterThan(0);
    for (const line of factLines) {
      expect(line).toMatch(/^Plano \d+ Fibra: R\$ \d+,90 por mes$/);
    }
  });

  it('marks the cut so the model can tell the document continues', () => {
    expect(truncateAtSafeBoundary(priceTable(40), 500)).toMatch(/\n…$/);
  });

  it('prefers a paragraph boundary over a line boundary', () => {
    const content = `${'a'.repeat(200)}\n\n${'b'.repeat(60)}\n${'c'.repeat(200)}`;
    const truncated = truncateAtSafeBoundary(content, 280);
    expect(truncated).toBe(`${'a'.repeat(200)}\n…`);
  });

  it('drops content with no usable boundary instead of emitting a fragment', () => {
    expect(truncateAtSafeBoundary('x'.repeat(5000), 1000)).toBe('');
  });

  it('does not discard content when the only boundary sits very early', () => {
    // A boundary before half the budget would waste most of the window; the
    // next boundary down is used instead.
    const content = `short\n${priceTable(40)}`;
    const truncated = truncateAtSafeBoundary(content, 600);
    expect(truncated.length).toBeGreaterThan(300);
  });
});

describe('compactKnowledgeDocumentsForPrompt', () => {
  it('keeps a realistic catalog whole instead of slicing it', () => {
    // ~2.4k chars: fits the current budget but was cut at 1200 before.
    const catalog = priceTable(60);
    const [compacted] = compactKnowledgeDocumentsForPrompt([doc({ content: catalog })]);

    expect(compacted.content).toBe(catalog);
    expect(compacted.content).not.toMatch(/…/);
  });

  it('respects the per-document budget', () => {
    const huge = priceTable(400);
    const [compacted] = compactKnowledgeDocumentsForPrompt([doc({ content: huge })]);

    expect(compacted.content.length).toBeLessThanOrEqual(MAX_PROMPT_DOCUMENT_CHARS);
  });

  it('respects the total budget across documents', () => {
    const documents = Array.from({ length: 12 }, (_, index) => doc({
      id: `doc-${index}`,
      content: priceTable(200),
    }));

    const compacted = compactKnowledgeDocumentsForPrompt(documents);
    const total = compacted.reduce((sum, document) => sum + document.content.length, 0);
    expect(total).toBeLessThanOrEqual(MAX_PROMPT_DOCUMENT_TOTAL_CHARS);
  });

  it('honours a per-document override above the default', () => {
    const huge = priceTable(400);
    const [compacted] = compactKnowledgeDocumentsForPrompt([
      doc({ content: huge, maxPromptChars: MAX_PROMPT_DOCUMENT_CHARS + 2000 }),
    ]);

    expect(compacted.content.length).toBeGreaterThan(MAX_PROMPT_DOCUMENT_CHARS);
  });

  it('skips empty documents', () => {
    expect(compactKnowledgeDocumentsForPrompt([doc({ content: '   \n\n  ' })])).toEqual([]);
  });

  it('does not append a sub-minimal fragment when the budget runs out', () => {
    const documents = Array.from({ length: 20 }, (_, index) => doc({
      id: `doc-${index}`,
      content: priceTable(200),
    }));

    for (const document of compactKnowledgeDocumentsForPrompt(documents)) {
      expect(document.content.length).toBeGreaterThanOrEqual(100);
    }
  });
});
