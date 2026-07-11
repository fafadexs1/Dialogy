import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/components/autopilot/autopilot-knowledge.tsx'),
  'utf8'
);

describe('Autopilot knowledge editor interaction contract', () => {
  it('keeps document typing local and flushes it without waiting for every agent rerender', () => {
    expect(source).toContain("const [contentDraft, setContentDraft] = useState('')");
    expect(source).toContain('value={contentDraft}');
    expect(source).toContain('updateContentDraft(selectedDoc.id, event.target.value)');
    expect(source).toContain('onBlur={commitPendingContent}');
    expect(source).toContain('contentCommitTimerRef.current = setTimeout');
  });

  it('isolates editor gestures from the flow canvas and does not expose document ids as editable context', () => {
    expect(source).toContain('className="nodrag nowheel nopan grid');
    expect(source).toContain('onKeyDown={(event) => event.stopPropagation()}');
    expect(source).not.toContain('{selectedDoc.id}\n                  </Badge>');
  });

  it('flushes pending content before changing documents by mouse or keyboard', () => {
    const flushBeforeSelection = /commitPendingContent\(\);\s+setSelectedDocId\(doc\.id\)/g;
    expect(source.match(flushBeforeSelection)).toHaveLength(2);
  });

  it('offers practical document discovery instead of requiring technical ids', () => {
    expect(source).toContain('Buscar por nome, tag, categoria ou colecao');
    expect(source).toContain('filteredDocuments.map((doc) =>');
    expect(source).toContain('list="autopilot-doc-category-options"');
  });
});
