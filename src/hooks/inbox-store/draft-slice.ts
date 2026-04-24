export function normalizeDraftForStorage(text: string): string {
  if (!text) return '';

  const plainText = text
    .replace(/<\/(div|p)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/&nbsp;/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/\u200B/g, '')
    .trim();

  return plainText.length > 0 ? text : '';
}
