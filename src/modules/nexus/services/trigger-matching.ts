/**
 * Deterministic message-trigger matching retained from NexusFlow.
 *
 * A phrase matches by weighted word coverage or normalized edit similarity.
 * This lets a configured phrase such as "600 MEGA + Site" match a longer
 * customer message while keeping an explicit, per-phrase confidence floor.
 */

export const DEFAULT_NEXUS_KEYWORD_THRESHOLD = 100;

const LOW_SIGNAL_TOKENS = new Set([
  'a', 'as', 'o', 'os', 'um', 'uma', 'uns', 'umas',
  'de', 'do', 'da', 'dos', 'das', 'em', 'no', 'na', 'nos', 'nas',
  'por', 'pra', 'para', 'pelo', 'pela', 'com', 'sem', 'ao', 'aos',
  'e', 'ou', 'que', 'se', 'me', 'meu', 'minha', 'eu', 'voce', 'vc',
  'ja', 'mais', 'muito', 'bem', 'ai', 'la', 'so', 'tem', 'ter',
]);

const LOW_SIGNAL_WEIGHT = 0.35;
const SPECIFICITY_MARGIN = 15;

function typoBudget(length: number) {
  if (length <= 3) return 0;
  if (length <= 5) return 1;
  if (length <= 9) return 2;
  return 3;
}

export function normalizeNexusKeywordText(value: unknown) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/(\d+)\s*[ªº°]/g, '$1')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('pt-BR');
}

function tokenize(value: unknown) {
  return normalizeNexusKeywordText(value).split(' ').filter(Boolean);
}

function levenshtein(left: string, right: string, ceiling = Number.POSITIVE_INFINITY) {
  if (left === right) return 0;
  if (Math.abs(left.length - right.length) > ceiling) return ceiling + 1;
  if (!left.length) return right.length;
  if (!right.length) return left.length;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  let current = new Array<number>(right.length + 1);
  for (let row = 1; row <= left.length; row += 1) {
    current[0] = row;
    let rowMinimum = row;
    for (let column = 1; column <= right.length; column += 1) {
      const substitution = previous[column - 1]! + (left[row - 1] === right[column - 1] ? 0 : 1);
      current[column] = Math.min(previous[column]! + 1, current[column - 1]! + 1, substitution);
      rowMinimum = Math.min(rowMinimum, current[column]!);
    }
    if (rowMinimum > ceiling) return ceiling + 1;
    [previous, current] = [current, previous];
  }
  return previous[right.length]!;
}

function tokenAppearsIn(keywordToken: string, messageTokens: string[]) {
  const budget = typoBudget(keywordToken.length);
  return messageTokens.some((messageToken) => {
    if (messageToken === keywordToken) return true;
    if (
      keywordToken.length >= 4
      && (messageToken.startsWith(keywordToken) || keywordToken.startsWith(messageToken))
      && Math.abs(messageToken.length - keywordToken.length) <= 3
    ) return true;
    return budget > 0 && levenshtein(keywordToken, messageToken, budget) <= budget;
  });
}

function evaluateKeyword(keyword: unknown, message: unknown) {
  const keywordTokens = tokenize(keyword);
  const messageTokens = tokenize(message);
  if (keywordTokens.length === 0 || messageTokens.length === 0) return { score: 0, matchedWeight: 0 };
  let totalWeight = 0;
  let matchedWeight = 0;
  for (const token of keywordTokens) {
    const weight = LOW_SIGNAL_TOKENS.has(token) ? LOW_SIGNAL_WEIGHT : 1;
    totalWeight += weight;
    if (tokenAppearsIn(token, messageTokens)) matchedWeight += weight;
  }
  const coverage = totalWeight > 0 ? matchedWeight / totalWeight : 0;
  const normalizedKeyword = normalizeNexusKeywordText(keyword);
  const normalizedMessage = normalizeNexusKeywordText(message);
  const longest = Math.max(normalizedKeyword.length, normalizedMessage.length);
  const similarity = longest > 0
    ? Math.max(0, 1 - levenshtein(normalizedKeyword, normalizedMessage) / longest)
    : 0;
  return { score: Math.round(Math.max(coverage, similarity) * 100), matchedWeight };
}

export function scoreNexusKeywordMatch(keyword: unknown, message: unknown) {
  return evaluateKeyword(keyword, message).score;
}

export function clampNexusKeywordThreshold(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_NEXUS_KEYWORD_THRESHOLD;
  return Math.min(100, Math.max(0, Math.round(numeric)));
}

export function resolveNexusKeywordThreshold(
  thresholds: Record<string, unknown> | null | undefined,
  keyword: string,
) {
  if (!thresholds) return DEFAULT_NEXUS_KEYWORD_THRESHOLD;
  if (Object.prototype.hasOwnProperty.call(thresholds, keyword)) {
    return clampNexusKeywordThreshold(thresholds[keyword]);
  }
  const normalizedKeyword = normalizeNexusKeywordText(keyword);
  const equivalent = Object.entries(thresholds).find(([configured]) => (
    normalizeNexusKeywordText(configured) === normalizedKeyword
  ));
  return equivalent ? clampNexusKeywordThreshold(equivalent[1]) : DEFAULT_NEXUS_KEYWORD_THRESHOLD;
}

export function parseNexusTriggerKeywords(value: unknown) {
  return (Array.isArray(value) ? value : String(value ?? '').split(/[\n,]/))
    .map(String)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export type NexusKeywordMatch = {
  keyword: string;
  score: number;
  threshold: number;
  matchedWeight: number;
};

export function findBestNexusKeywordMatch(
  keywords: string[],
  thresholds: Record<string, unknown> | null | undefined,
  message: unknown,
): NexusKeywordMatch | null {
  let best: NexusKeywordMatch | null = null;
  for (const keyword of keywords) {
    const threshold = resolveNexusKeywordThreshold(thresholds, keyword);
    const evaluated = evaluateKeyword(keyword, message);
    if (evaluated.score < threshold) continue;
    const candidate = { keyword, threshold, ...evaluated };
    if (!best) {
      best = candidate;
      continue;
    }
    if (Math.abs(candidate.score - best.score) <= SPECIFICITY_MARGIN) {
      if (
        candidate.matchedWeight > best.matchedWeight
        || (candidate.matchedWeight === best.matchedWeight && candidate.score > best.score)
      ) best = candidate;
      continue;
    }
    if (candidate.score > best.score) best = candidate;
  }
  return best;
}
