/**
 * Best-effort masking of personal data in conversation text before it leaves the database
 * (gold-dataset export). It reduces exposure; it does NOT guarantee anonymity: street names,
 * company names and free-form details remain. Treat exported files as sensitive.
 */

const REPLACEMENTS: Array<[RegExp, string]> = [
  [/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '[EMAIL]'],
  [/https?:\/\/\S+/gi, '[URL]'],
  // CNPJ before CPF before phone: longer, more specific shapes first.
  [/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, '[CNPJ]'],
  [/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[CPF]'],
  [/(?:\+?55[\s-]?)?\(?\b\d{2}\)?[\s-]?9?\d{4}[\s-]?\d{4}\b/g, '[TEL]'],
  [/\b\d{5}-?\d{3}\b/g, '[CEP]'],
  [/\b\d{6,}\b/g, '[NUM]'],
];

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Name tokens shorter than 3 chars are skipped so common words ("de", "da") are not erased. */
export function nameTokens(...names: Array<string | null | undefined>): string[] {
  return [...new Set(names.flatMap((name) => (name || '').split(/\s+/)).map((token) => token.trim()).filter((token) => token.length >= 3))];
}

export function maskConversationText(text: string, names: string[] = [], maxLength = 1000): string {
  let masked = (text || '').slice(0, maxLength);
  for (const [pattern, replacement] of REPLACEMENTS) masked = masked.replace(pattern, replacement);
  for (const token of names) masked = masked.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(token)}(?![\\p{L}\\p{N}])`, 'giu'), '[NOME]');
  return masked;
}
