import { isRecord, materializeValue } from '@/services/workflow-runtime/utils';

/** Resolve and freeze the exact request approved by a human. */
export function resolveAgentHttpApproval(config: Record<string, unknown>, args: Record<string, unknown>) {
  const fields = { url: config.url, headers: config.headers || {}, query: config.query || {}, body: config.body ?? {} };
  const inspect = (value: unknown): void => {
    if (typeof value === 'string') {
      for (const match of value.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)) {
        const path = match[1].trim();
        if (!/^(?:arguments|current)(?:\.[a-zA-Z0-9_-]+)*$/.test(path) || path.split('.').some((part) => ['__proto__', 'prototype', 'constructor'].includes(part))) throw new Error('A operação aprovada só pode usar argumentos explícitos da ferramenta.');
      }
    } else if (Array.isArray(value)) value.forEach(inspect);
    else if (isRecord(value)) Object.values(value).forEach(inspect);
  };
  inspect(fields);
  const source = { arguments: args, current: args };
  const resolved = materializeValue(fields, source);
  if (!isRecord(resolved) || typeof resolved.url !== 'string' || !isRecord(resolved.headers) || !isRecord(resolved.query)) throw new Error('URL, cabeçalhos ou parâmetros HTTP inválidos.');
  let original: URL, target: URL;
  try { original = new URL(String(config.url || '')); target = new URL(resolved.url); }
  catch { throw new Error('A origem da URL deve ser fixa e válida.'); }
  if (original.protocol !== 'https:' || /[{}]/.test(original.host) || original.origin !== target.origin || target.username || target.password) throw new Error('A origem da URL deve ser fixa e válida.');
  for (const [name, value] of Object.entries(resolved.query)) target.searchParams.set(name, String(value));
  target.hash = '';
  const headers = Object.fromEntries(Object.entries(resolved.headers).map(([name, value]) => [name, String(value)]));
  const request: Record<string, unknown> & { method: string } = { ...config, ...resolved, url: target.href, headers, query: {}, method: String(config.method || 'GET').toUpperCase() };
  return { request, proposal: { method: request.method, url: target.href, headers, bodyType: config.bodyType || 'none', body: resolved.body, credentialId: config.credentialId || null } };
}
