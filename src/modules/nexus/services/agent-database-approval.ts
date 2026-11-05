import { isRecord, materializeValue, readPath } from '@/services/workflow-runtime/utils';
import { parseDataArgument } from './tool-registry';

/** Resolve only explicit arguments once; literal argument contents never become templates. */
export function resolveAgentDatabaseApproval(config: Record<string, unknown>, args: Record<string, unknown>) {
  const operation = String(config.operation || 'select');
  if (!['select', 'insert', 'update', 'delete'].includes(operation)) throw new Error('Operação de banco inválida.');
  const table = String(config.table || '').trim(), credentialId = String(config.credentialId || '').trim();
  if (!table || !credentialId) throw new Error('Configure tabela e credencial de banco.');
  const configured = { values: isRecord(config.values) ? config.values : {}, filters: Array.isArray(config.filters) ? config.filters : [] };
  const source = { arguments: args, current: args };
  const inspect = (value: unknown): void => {
    if (typeof value === 'string') for (const match of value.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)) {
      const path = match[1].trim();
      if (!/^(?:arguments|current)(?:\.[a-zA-Z0-9_-]+)*$/.test(path) || path.split('.').some((part) => ['__proto__', 'prototype', 'constructor'].includes(part))) throw new Error('A operação aprovada só pode usar argumentos explícitos da ferramenta.');
      if (readPath(source, path) === undefined) throw new Error('Um argumento necessário da operação de banco não foi informado.');
    } else if (Array.isArray(value)) value.forEach(inspect);
    else if (isRecord(value)) Object.values(value).forEach(inspect);
  };
  inspect(configured);
  const values = { ...materializeValue(configured.values, source) as Record<string, unknown>, ...parseDataArgument(args.data) };
  const filters = materializeValue(configured.filters, source) as unknown[];
  const filterColumn = String(args.filter_column || '').trim();
  if (filterColumn) filters.push({ column: filterColumn, operator: 'eq', value: args.filter_value });
  if (Array.isArray(args.filters)) filters.push(...args.filters.filter(isRecord));
  if (['update', 'delete'].includes(operation) && !filters.length) throw new Error('UPDATE e DELETE exigem ao menos um filtro.');
  const request = { ...config, operation, table, credentialId, values, filters };
  const proposal = { operation, table, credentialId, values, filters, returning: Array.isArray(config.returning) ? config.returning : [] };
  return { request, proposal };
}
