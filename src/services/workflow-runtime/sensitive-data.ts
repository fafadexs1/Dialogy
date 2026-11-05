const marker = '__studioSensitivePaths';
const safeParts = (path: string) => {
  const parts = path.split('.');
  return parts.every((part) => /^[\p{L}\p{N}_-]+$/u.test(part) && !['__proto__', 'constructor', 'prototype'].includes(part)) ? parts : [];
};

export function markWorkflowSensitivePaths<T extends Record<string, unknown>>(value: T, paths: string[]): T {
  const existing = Array.isArray(value[marker]) ? value[marker].filter((entry): entry is string => typeof entry === 'string') : [];
  const next = [...new Set([...existing, ...paths.filter((path) => safeParts(path).length)])];
  if (next.length > 10000) throw new Error('Limite de campos sensíveis por execução atingido.');
  if (next.length) (value as Record<string, unknown>)[marker] = next;
  return value;
}

/** Markers describe public contract sensitivity; the original runtime data remains usable. */
export function maskDeclaredWorkflowData(value: Record<string, unknown>) {
  if (!Array.isArray(value[marker])) return value;
  const result = { ...value }; delete result[marker];
  const secrets: string[] = [];
  for (const path of value[marker].slice(0, 10000)) {
    if (typeof path !== 'string') continue;
    const parts = safeParts(path); if (!parts.length) continue;
    let cursor = result;
    for (let index = 0; index < parts.length; index++) {
      const key = parts[index];
      if (!Object.hasOwn(cursor, key)) break;
      if (index === parts.length - 1) { if (typeof cursor[key] === 'string') secrets.push(cursor[key]); cursor[key] = '[REDACTED]'; }
      else if (cursor[key] && typeof cursor[key] === 'object' && !Array.isArray(cursor[key])) { cursor[key] = { ...(cursor[key] as Record<string, unknown>) }; cursor = cursor[key] as Record<string, unknown>; }
      else break;
    }
  }
  if (typeof result.response === 'string') { let response = result.response; for (const secret of secrets.filter(Boolean)) response = response.split(secret).join('[REDACTED]'); result.response = response; }
  return result;
}
