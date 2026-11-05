import type { AgentReleaseManifest } from './types';

const words = (value: string) => new Set(value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || []);

/** Bounded extractive context from the immutable release, without a live index or generated facts. */
export function studioFlowKnowledgeContext(release: AgentReleaseManifest, query: string, maxCharacters = 24000) {
  const terms = words(query);
  const chunks = (release.knowledgeSnapshot || []).flatMap((source, sourceIndex) => {
    if (typeof source.content !== 'string') return [];
    const result: Array<{ sourceId: string; name: string; content: string; score: number; order: number }> = [];
    const content = source.content.slice(0, 100000);
    for (let offset = 0; offset < content.length; offset += 1800) {
      const text = content.slice(offset, offset + 2000);
      result.push({ sourceId: String(source.id || sourceIndex), name: String(source.name || 'Fonte publicada'), content: text,
        score: [...words(text)].filter((word) => terms.has(word)).length, order: sourceIndex * 100000 + offset });
    }
    return result;
  }).sort((a, b) => b.score - a.score || a.order - b.order);
  const selected: Array<{ sourceId: string; name: string; content: string }> = [];
  let remaining = maxCharacters;
  for (const chunk of chunks) {
    if (chunk.content.length > remaining) continue;
    selected.push({ sourceId: chunk.sourceId, name: chunk.name, content: chunk.content }); remaining -= chunk.content.length;
  }
  return { excerpts: selected, omitted: selected.length < chunks.length };
}
