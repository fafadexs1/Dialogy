/**
 * Pure text normalization and cleaning routines for agent knowledge sources.
 * Safe to import in both Client and Server Components.
 */

export function cleanDocumentText(value: string): string {
  return value
    .replace(/\0/g, '')
    .replace(/\r\n?/g, '\n')
    // Rejoin words split across lines with hyphens: "inter-\nromper" -> "interromper"
    .replace(/(\p{L}+)-\n(\p{L}+)/gu, '$1$2')
    // Normalize excessive consecutive blank lines to at most 2
    .replace(/\n{3,}/g, '\n\n')
    // Normalize spaces within lines
    .replace(/[ \t]+/g, ' ')
    .trim();
}
