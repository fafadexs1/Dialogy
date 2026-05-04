const DEFAULT_MAX_CUSTOMER_RESPONSE_CHARS = 900;
const MAX_PARAGRAPHS = 5;
const MAX_SENTENCES_PER_PARAGRAPH = 3;
const SOFT_PARAGRAPH_CHAR_LIMIT = 280;

/**
 * Minimum total length to consider splitting into multiple message blocks.
 * Below this threshold the response stays as a single message.
 */
const MIN_CHARS_FOR_MULTI_BLOCK = 300;

/**
 * Maximum number of separate WhatsApp messages sent for a single AI response.
 */
const MAX_MESSAGE_BLOCKS = 3;

/**
 * Regex that detects lines that look like list items.
 * Matches lines starting with: emoji, bullet (•·–—-), number+dot/), asterisk, or 💡🔹▸▪️ style markers.
 */
const LIST_LINE_PATTERN = /^(\s*)([\p{Extended_Pictographic}\u2022\u00b7\u2013\u2014\-\*\u25b8\u25aa\u25cf\u25cb]|\d+[.)]\s)/u;

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

  // Try to trim by whole sentences first
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

/**
 * Returns true when a paragraph block contains list-style lines that should
 * be kept separated by `\n` instead of collapsed into a single line.
 */
function containsListLines(block: string): boolean {
  const lines = block.split('\n').filter(Boolean);
  if (lines.length < 2) return false;
  const listLineCount = lines.filter((line) => LIST_LINE_PATTERN.test(line)).length;
  // If at least 2 lines look like list items, treat the block as a list
  return listLineCount >= 2;
}

function paragraphize(value: string): string {
  const existingParagraphs = value
    .split(/\n{2,}/)
    .filter(Boolean);

  const paragraphs: string[] = [];

  for (const rawParagraph of existingParagraphs) {
    // If the paragraph contains list-like lines, preserve \n breaks
    if (containsListLines(rawParagraph)) {
      const cleanedLines = rawParagraph
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
      paragraphs.push(cleanedLines.join('\n'));
      continue;
    }

    // Otherwise, flow-wrap the paragraph using sentence splitting
    const flatParagraph = rawParagraph.replace(/\s*\n\s*/g, ' ').trim();
    if (!flatParagraph) continue;

    const sentences = splitSentences(flatParagraph);
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

/**
 * Splits a formatted AI response into separate message blocks for WhatsApp.
 *
 * When the AI generates a long response with distinct sections (e.g. a list of
 * plans followed by a promotional offer), this function splits them into
 * individual messages so they appear as separate WhatsApp bubbles.
 *
 * Rules:
 * - Short responses (< MIN_CHARS_FOR_MULTI_BLOCK) are always kept as a single block.
 * - Splitting is done on double newlines (\n\n), which separate logical paragraphs.
 * - Adjacent short paragraphs are merged to avoid sending tiny messages.
 * - Maximum of MAX_MESSAGE_BLOCKS blocks to prevent spamming.
 *
 * @returns An array of 1-3 message strings, each ready to be sent as a separate WhatsApp message.
 */
export function splitIntoMessageBlocks(formattedResponse: string): string[] {
  const trimmed = formattedResponse.trim();
  if (!trimmed) return [];

  // Short responses stay as one message
  if (trimmed.length < MIN_CHARS_FOR_MULTI_BLOCK) {
    return [trimmed];
  }

  const paragraphs = trimmed.split(/\n{2,}/).filter(Boolean);

  // Single paragraph, keep as one message
  if (paragraphs.length <= 1) {
    return [trimmed];
  }

  // Merge small adjacent paragraphs into blocks.
  // A new block starts when adding the next paragraph would exceed a soft
  // threshold OR the current block already has substantial content.
  const BLOCK_SOFT_LIMIT = 350;
  const blocks: string[] = [];
  let currentBlock: string[] = [];

  for (const paragraph of paragraphs) {
    const currentText = currentBlock.join('\n\n');
    const wouldBe = currentText ? `${currentText}\n\n${paragraph}` : paragraph;

    if (currentBlock.length > 0 && wouldBe.length > BLOCK_SOFT_LIMIT) {
      blocks.push(currentText.trim());
      currentBlock = [paragraph];
    } else {
      currentBlock.push(paragraph);
    }
  }

  if (currentBlock.length > 0) {
    blocks.push(currentBlock.join('\n\n').trim());
  }

  // Enforce max blocks — if we exceed, merge trailing blocks into the last one
  if (blocks.length > MAX_MESSAGE_BLOCKS) {
    const kept = blocks.slice(0, MAX_MESSAGE_BLOCKS - 1);
    const merged = blocks.slice(MAX_MESSAGE_BLOCKS - 1).join('\n\n');
    kept.push(merged);
    return kept.filter(Boolean);
  }

  return blocks.filter(Boolean);
}
