const DEFAULT_MAX_CUSTOMER_RESPONSE_CHARS = 520;
const MAX_PARAGRAPHS = 3;
const MAX_SENTENCES_PER_PARAGRAPH = 2;
const SOFT_PARAGRAPH_CHAR_LIMIT = 220;

function normalizeWhitespace(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function splitSentences(value: string): string[] {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return [];
  return normalized.match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.map((item) => item.trim()).filter(Boolean) || [normalized];
}

function trimToMaxLength(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;

  const sentences = splitSentences(value);
  const kept: string[] = [];

  for (const sentence of sentences) {
    const candidate = [...kept, sentence].join(' ');
    if (candidate.length > maxChars) break;
    kept.push(sentence);
  }

  if (kept.length > 0) return kept.join(' ').trim();

  const hardCut = value.slice(0, Math.max(0, maxChars - 3)).trim();
  const wordBoundary = hardCut.lastIndexOf(' ');
  const compact = wordBoundary > 80 ? hardCut.slice(0, wordBoundary).trim() : hardCut;
  return `${compact}...`;
}

function paragraphize(value: string): string {
  const existingParagraphs = value
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/\s*\n\s*/g, ' ').trim())
    .filter(Boolean);

  const sourceParagraphs = existingParagraphs.length > 1
    ? existingParagraphs
    : [value.replace(/\s*\n\s*/g, ' ').trim()].filter(Boolean);

  const paragraphs: string[] = [];

  for (const source of sourceParagraphs) {
    const sentences = splitSentences(source);
    let current: string[] = [];

    for (const sentence of sentences) {
      const candidate = [...current, sentence].join(' ');
      const shouldBreak =
        current.length >= MAX_SENTENCES_PER_PARAGRAPH ||
        (current.length > 0 && candidate.length > SOFT_PARAGRAPH_CHAR_LIMIT);

      if (shouldBreak) {
        paragraphs.push(current.join(' ').trim());
        current = [sentence];
      } else {
        current.push(sentence);
      }
    }

    if (current.length > 0) {
      paragraphs.push(current.join(' ').trim());
    }
  }

  return paragraphs.slice(0, MAX_PARAGRAPHS).join('\n\n').trim();
}

export function formatCustomerFacingAiResponse(
  response: string,
  maxChars = DEFAULT_MAX_CUSTOMER_RESPONSE_CHARS
): string {
  const normalized = normalizeWhitespace(response);
  if (!normalized) return '';

  const limited = trimToMaxLength(normalized, maxChars);
  return paragraphize(limited);
}
