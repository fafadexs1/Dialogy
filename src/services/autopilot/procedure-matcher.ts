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
  const normalizedMsg = normalizeText(message);
  const msgWords = normalizedMsg.split(/\s+/).filter(w => w.length >= 3);

  let hits = 0;
  for (const kw of keywords) {
    const normalizedKw = normalizeText(kw);
    // Exact substring check
    if (normalizedMsg.includes(normalizedKw)) {
      hits++;
      continue;
    }

    // Fuzzy prefix check
    const kwWords = normalizedKw.split(/\s+/).filter(w => w.length >= 3);
    let matched = false;
    for (const msgWord of msgWords) {
      for (const kwWord of kwWords) {
        if (
          msgWord.startsWith(kwWord.slice(0, 5)) ||
          kwWord.startsWith(msgWord.slice(0, 5))
        ) {
          matched = true;
          break;
        }
      }
      if (matched) break;
    }
    if (matched) {
      hits++;
    }
  }
  return hits;
}

function hasRequiredDomainEvidence(documentName: string, customerMessage: string): boolean {
  const normalizedName = normalizeText(documentName);
  const normalizedMessage = normalizeText(customerMessage);

  if (/\b(financeiro|pagamento|boleto|fatura|pix|cobranca)\b/.test(normalizedName)) {
    return /\b(financeiro|pagamento|pagar|boleto|fatura|pix|cobranca|vencimento|negociacao|promessa)\b/.test(normalizedMessage);
  }
  if (/\b(cancelamento|cancelar)\b/.test(normalizedName)) {
    return /\b(cancelar|cancelamento|desistir|encerrar contrato)\b/.test(normalizedMessage);
  }
  if (/\b(transferencia|transferir|humano|atendente)\b/.test(normalizedName)) {
    return /\b(transferir|transferencia|humano|atendente|falar com alguem|pessoa)\b/.test(normalizedMessage);
  }
  return true;
}

/**
 * Given the resolved intent, the customer message, and the list of compiled
 * procedures, return the best match (if any).
 *
 * Scoring:
 *   +3 per intent match
 *   +1 per keyword hit
 *   +2 per title word hit
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
    if (!hasRequiredDomainEvidence(graph.documentName, customerMessage)) {
      continue;
    }

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

    // NEW: Title word hits to boost specialized procedures
    const docWords = normalizeText(graph.documentName)
      .split(/[\s\-/,.:;!?()]+/)
      .filter((w) => w.length >= 4 && w !== 'para' && w !== 'como' && w !== 'suporte' && w !== 'atendimento' && w !== 'tecnico');

    const msgWords = normalizeText(customerMessage)
      .split(/[\s\-/,.:;!?()]+/);

    let titleWordHits = 0;
    for (const dw of docWords) {
      for (const mw of msgWords) {
        if (mw.startsWith(dw.slice(0, 5)) || dw.startsWith(mw.slice(0, 5))) {
          titleWordHits++;
          break;
        }
      }
    }
    if (titleWordHits > 0) {
      score += titleWordHits * 2;
      reasons.push(`${titleWordHits} title word hit(s)`);
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
