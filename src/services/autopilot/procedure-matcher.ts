/**
 * Procedure Matcher
 *
 * Finds the best compiled ProcedureGraph for a given customer message
 * based on intent overlap, keyword scoring, and document relevance.
 */

import type { ProcedureGraph } from './procedure-types';
import type { UniversalAutopilotIntent } from './intent-types';

export type ProcedureMatchResult = {
  graph: ProcedureGraph;
  score: number;
  matchReason: string;
};

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function countKeywordHits(message: string, keywords: string[]): number {
  const normalized = normalizeText(message);
  return keywords.filter((kw) => normalized.includes(normalizeText(kw))).length;
}

/**
 * Given the resolved intent, the customer message, and the list of compiled
 * procedures, return the best match (if any).
 *
 * Scoring:
 *   +3 per intent match
 *   +1 per keyword hit
 *   Minimum score of 2 to be considered a match
 */
export function matchProcedure(input: {
  intent: UniversalAutopilotIntent;
  customerMessage: string;
  compiledProcedures: ProcedureGraph[];
}): ProcedureMatchResult | null {
  const { intent, customerMessage, compiledProcedures } = input;

  if (!compiledProcedures || compiledProcedures.length === 0) return null;

  const scored: ProcedureMatchResult[] = [];

  for (const graph of compiledProcedures) {
    let score = 0;
    const reasons: string[] = [];

    // Intent overlap
    const intentMatch = graph.triggerIntents.includes(intent);
    if (intentMatch) {
      if (intent !== 'unknown') {
        score += 3;
        reasons.push(`intent "${intent}" match`);
      }
    }

    // Keyword hits
    const keywordHits = countKeywordHits(customerMessage, graph.triggerKeywords);
    if (keywordHits > 0) {
      score += keywordHits;
      reasons.push(`${keywordHits} keyword hit(s)`);
    }

    // Document name fuzzy match against message
    const docNameHit = normalizeText(customerMessage).includes(
      normalizeText(graph.documentName).slice(0, 20),
    );
    if (docNameHit) {
      score += 2;
      reasons.push('document name in message');
    }

    if (score >= 2) {
      scored.push({
        graph,
        score,
        matchReason: reasons.join(', '),
      });
    }
  }

  if (scored.length === 0) return null;

  // Sort by score descending, then by fewer steps (simpler procedure wins ties)
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.graph.steps.length - b.graph.steps.length;
  });

  return scored[0];
}
