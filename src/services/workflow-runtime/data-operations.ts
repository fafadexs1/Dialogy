import { z } from 'zod';
import { isRecord, readPath, stableStringify } from './data-values';

export const DataOperationSchema = z.object({
  operation: z.enum(['pick', 'split', 'regex', 'convert', 'format', 'validate', 'filter', 'sort', 'unique', 'group', 'aggregate', 'join']),
  pattern: z.string().max(500).optional(),
  source: z.unknown().optional(),
  field: z.string().max(500).default(''),
  value: z.unknown().optional(),
  delimiter: z.string().max(100).default(';'),
  targetType: z.enum(['text', 'number', 'boolean', 'json', 'date']).default('text'),
  format: z.enum(['date', 'currency', 'digits', 'upper', 'lower', 'trim']).default('trim'),
  locale: z.string().max(40).default('pt-BR'),
  currency: z.string().length(3).default('BRL'),
  operator: z.enum(['equals', 'not_equals', 'contains', 'greater_than', 'less_than', 'exists']).default('equals'),
  descending: z.boolean().default(false),
  aggregate: z.enum(['count', 'sum', 'average', 'min', 'max']).default('count'),
  right: z.union([z.array(z.unknown()).max(1000), z.string().regex(/^\{\{\s*[A-Za-z_][\w.-]*\s*\}\}$/)]).default([]),
  rightField: z.string().max(500).default(''),
  requiredFields: z.array(z.string().min(1).max(500)).max(100).default([]),
}).passthrough();

export function executeDataOperation(config: unknown, source: unknown): unknown {
  const c = DataOperationSchema.parse(config);
  if (c.operation === 'regex') throw new Error('Expressões regulares são executadas no motor isolado.');
  if (new TextEncoder().encode(JSON.stringify(source) ?? 'null').length > 1_000_000) throw new Error('Os dados excedem 1 MB.');
  const field = (item: unknown) => c.field ? readPath(item, c.field) : item;
  const equal = (a: unknown, b: unknown) => stableStringify(a) === stableStringify(b);
  const numeric = (value: unknown): number => {
    if (value === null || value === '' || typeof value === 'boolean') throw new Error('Informe um número válido.');
    const n = Number(value);
    if (!Number.isFinite(n)) throw new Error('Informe um número válido.');
    return n;
  };
  if (c.operation === 'pick') return field(source) ?? null;
  if (c.operation === 'split') {
    if (typeof source !== 'string' || !c.delimiter) throw new Error('Informe um texto e um separador.');
    const result = source.split(c.delimiter);
    if (result.length > 1000) throw new Error('A lista excede 1.000 itens.');
    return result;
  }
  if (c.operation === 'validate') {
    const missing = c.requiredFields.filter((path) => {
      const value = readPath(source, path);
      return value === undefined || value === null || value === '';
    });
    return { valid: missing.length === 0, missing, data: source };
  }
  if (c.operation === 'convert') {
    if (c.targetType === 'number') return numeric(source);
    if (c.targetType === 'boolean') {
      if (source === true || source === 'true' || source === 1) return true;
      if (source === false || source === 'false' || source === 0) return false;
      throw new Error('Use true, false, 1 ou 0 para converter um booleano.');
    }
    if (c.targetType === 'json') return typeof source === 'string' ? JSON.parse(source) : source;
    if (c.targetType === 'date') {
      const date = new Date(String(source));
      if (!Number.isFinite(date.getTime())) throw new Error('Data inválida.');
      return date.toISOString();
    }
    return typeof source === 'object' ? JSON.stringify(source) : String(source ?? '');
  }
  if (c.operation === 'format') {
    if (c.format === 'currency') return new Intl.NumberFormat(c.locale, { style: 'currency', currency: c.currency }).format(numeric(source));
    if (c.format === 'date') {
      const date = new Date(String(source));
      if (!Number.isFinite(date.getTime())) throw new Error('Data inválida.');
      return new Intl.DateTimeFormat(c.locale, { timeZone: 'UTC', dateStyle: 'short' }).format(date);
    }
    const text = String(source ?? '');
    if (c.format === 'digits') return text.replace(/\D/g, '');
    if (c.format === 'upper') return text.toLocaleUpperCase(c.locale);
    if (c.format === 'lower') return text.toLocaleLowerCase(c.locale);
    return text.trim();
  }
  if (!Array.isArray(source)) throw new Error('Esta operação precisa de uma lista.');
  if (source.length > 1000) throw new Error('A lista excede 1.000 itens.');
  if (c.operation === 'filter') return source.filter((item) => {
    const value = field(item);
    if (c.operator === 'exists') return value !== undefined && value !== null && value !== '';
    if (c.operator === 'contains') return typeof value === 'string' ? value.includes(String(c.value ?? '')) : Array.isArray(value) && value.some((entry) => equal(entry, c.value));
    if (c.operator === 'greater_than') return numeric(value) > numeric(c.value);
    if (c.operator === 'less_than') return numeric(value) < numeric(c.value);
    return c.operator === 'not_equals' ? !equal(value, c.value) : equal(value, c.value);
  });
  if (c.operation === 'sort') return [...source].sort((a, b) => {
    const left = field(a), right = field(b);
    const order = typeof left === 'number' && typeof right === 'number' ? left - right : String(left ?? '').localeCompare(String(right ?? ''), c.locale);
    return c.descending ? -order : order;
  });
  if (c.operation === 'unique') {
    const seen = new Set<string>();
    return source.filter((item) => { const key = stableStringify(field(item)); if (seen.has(key)) return false; seen.add(key); return true; });
  }
  if (c.operation === 'group') {
    const groups = new Map<string, { key: unknown; items: unknown[] }>();
    for (const item of source) {
      const value = field(item) ?? null, key = stableStringify(value);
      if (!groups.has(key)) groups.set(key, { key: value, items: [] });
      groups.get(key)!.items.push(item);
    }
    return [...groups.values()];
  }
  if (c.operation === 'join') {
    if (!Array.isArray(c.right)) throw new Error('A lista da direita precisa estar disponível antes de combinar.');
    const index = new Map<string, Array<{ value: unknown; bytes: number }>>();
    if (new TextEncoder().encode(JSON.stringify(c.right)).length > 1_000_000) throw new Error('A lista da direita excede 1 MB.');
    for (const item of c.right) {
      const keyValue = c.rightField ? readPath(item, c.rightField) : item;
      if (keyValue === undefined || keyValue === null) continue;
      const key = stableStringify(keyValue);
      index.set(key, [...(index.get(key) || []), { value: item, bytes: new TextEncoder().encode(JSON.stringify(item) ?? 'null').length }]);
    }
    let bytes = 0;
    return source.map(item => {
      const matches = index.get(stableStringify(field(item))) || [];
      bytes += new TextEncoder().encode(JSON.stringify(item) ?? 'null').length + matches.reduce((sum, match) => sum + match.bytes, 0) + 100;
      if (bytes > 1_000_000) throw new Error('A combinação excede 1 MB. Filtre ou remova chaves duplicadas antes de combinar.');
      return { left: item, matches: matches.map(match => match.value) };
    });
  }
  if (c.aggregate === 'count') return source.length;
  const numbers = source.map((item) => numeric(field(item)));
  if (numbers.length === 0) return c.aggregate === 'sum' ? 0 : null;
  if (c.aggregate === 'min') return Math.min(...numbers);
  if (c.aggregate === 'max') return Math.max(...numbers);
  const sum = numbers.reduce((a, b) => a + b, 0);
  return c.aggregate === 'average' ? sum / numbers.length : sum;
}

export function sampleDataFields(value: unknown, prefix: string, maxEntries = 150): Array<{ path: string; type: string; preview: string }> {
  const result: Array<{ path: string; type: string; preview: string }> = [];
  const walk = (entry: unknown, path: string, depth: number) => {
    if (result.length >= maxEntries || depth > 8) return;
    const type = entry === null ? 'null' : Array.isArray(entry) ? 'lista' : typeof entry;
    result.push({ path, type, preview: (JSON.stringify(entry) ?? 'ausente').slice(0, 120) });
    if (Array.isArray(entry)) entry.slice(0, 10).forEach((item, index) => walk(item, `${path}.${index}`, depth + 1));
    else if (isRecord(entry)) Object.entries(entry).forEach(([key, child]) => {
      if (/^[A-Za-z_][\w-]*$/.test(key) && !['__proto__', 'constructor', 'prototype'].includes(key)) walk(child, `${path}.${key}`, depth + 1);
    });
  };
  walk(value, prefix, 0);
  return result;
}
