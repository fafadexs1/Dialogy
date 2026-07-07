const STOP_WORDS = new Set([
  'a', 'ao', 'aos', 'as', 'com', 'da', 'das', 'de', 'do', 'dos', 'e', 'em',
  'essa', 'esse', 'esta', 'este', 'eu', 'ja', 'mais', 'meu', 'minha', 'na',
  'nas', 'no', 'nos', 'o', 'os', 'ou', 'para', 'por', 'que', 'se', 'seu',
  'sua', 'um', 'uma', 'voce',
]);

function meaningfulTokens(value: string): Set<string> {
  const normalized = value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ');
  return new Set(
    normalized
      .split(/\s+/)
      .filter((token) => token.length >= 3 && !STOP_WORDS.has(token)),
  );
}

export function shouldPrependPrimaryResponseToMessageBlocks(
  response: string,
  blocks: string[],
): boolean {
  const primary = response.trim();
  const combinedBlocks = blocks.join('\n').trim();
  if (!primary || !combinedBlocks) return Boolean(primary);

  const normalizedPrimary = primary.toLowerCase();
  const normalizedBlocks = combinedBlocks.toLowerCase();
  if (
    normalizedBlocks.includes(normalizedPrimary) ||
    normalizedPrimary.includes(normalizedBlocks)
  ) {
    return false;
  }

  const primaryTokens = meaningfulTokens(primary);
  const blockTokens = meaningfulTokens(combinedBlocks);
  if (primaryTokens.size < 3) return true;

  const overlap = [...primaryTokens].filter((token) => blockTokens.has(token)).length;
  return overlap / primaryTokens.size < 0.5;
}
