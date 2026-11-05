/** Client-safe data helpers; no crypto, storage, credentials or runtime dependencies. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
export function readPath(source: unknown, path: string): unknown {
  const normalized = path.replace(/^\{\{\s*|\s*\}\}$/g, '').replace(/^\$\./, '').trim();
  if (!normalized) return source;
  return normalized.split('.').reduce<unknown>((value, segment) => {
    if ((!isRecord(value) && !Array.isArray(value)) || ['__proto__', 'constructor', 'prototype'].includes(segment) || !Object.hasOwn(value, segment)) return undefined;
    return (value as Record<string, unknown>)[segment];
  }, source);
}
export function stableStringify(value: unknown): string {
  const normalize = (entry: unknown): unknown => Array.isArray(entry) ? entry.map(normalize) : isRecord(entry) ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, normalize(child)])) : entry;
  return JSON.stringify(normalize(value)) ?? 'null';
}
