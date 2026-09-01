import type { HttpRequestStepConfig, McpToolStepConfig } from './types';

export type StudioDataContext = {
  values: Record<string, unknown>;
  contact?: Record<string, unknown>;
  input?: Record<string, unknown>;
};

const forbiddenSegments = new Set(['__proto__', 'prototype', 'constructor']);

function pathSegments(path: string): string[] {
  if (path === '$') return [];
  const normalized = path.replace(/^\$\./, '').replace(/\[(\d+)\]/g, '.$1');
  const segments = normalized.split('.');
  if (!normalized || segments.some((part) => !/^[\p{L}\p{N}_-]+$/u.test(part) || forbiddenSegments.has(part))) {
    throw new Error('Selecione um caminho de dados válido.');
  }
  return segments;
}

/** Only own properties: external payloads cannot read or write prototypes. */
export function readStudioValue(value: unknown, path: string): unknown {
  return pathSegments(path).reduce<unknown>((current, segment) => {
    if (current === null || typeof current !== 'object' || !Object.hasOwn(current, segment)) return undefined;
    return (current as Record<string, unknown>)[segment];
  }, value);
}

function writeValue(target: Record<string, unknown>, path: string, value: unknown) {
  const segments = pathSegments(path);
  if (!segments.length) throw new Error('Informe o nome do campo de destino.');
  let cursor = target;
  for (const segment of segments.slice(0, -1)) {
    const existing = cursor[segment];
    if (existing !== undefined && (existing === null || typeof existing !== 'object' || Array.isArray(existing))) {
      throw new Error('Dois campos usam caminhos de destino incompatíveis.');
    }
    if (existing === undefined) cursor[segment] = {};
    cursor = cursor[segment] as Record<string, unknown>;
  }
  const last = segments.at(-1)!;
  if (Object.hasOwn(cursor, last)) throw new Error('O mesmo campo de destino foi configurado mais de uma vez.');
  cursor[last] = value;
}

export { writeValue as writeStudioValue };

export function resolveStudioMapping(input: {
  sourceType?: string;
  sourceValue: string;
  valueType?: string;
}, context: StudioDataContext): unknown {
  const value = input.sourceType === 'static_value'
    ? input.sourceValue
    : readStudioValue(input.sourceType === 'contact_property' ? context.contact || {}
      : input.sourceType === 'flow_input' ? context.input || {} : context.values, input.sourceValue);
  if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) {
    throw new Error('Um dado necessário ainda não foi informado. Preencha os dados de entrada.');
  }
  if (!input.valueType) return value;
  if (input.valueType === 'text') {
    if (typeof value === 'object') throw new Error('Este campo precisa de texto, mas recebeu um objeto ou lista.');
    return String(value);
  }
  if (input.valueType === 'number') {
    if (!['number', 'string'].includes(typeof value) || !Number.isFinite(Number(value))) {
      throw new Error('Este campo precisa de um número válido.');
    }
    return Number(value);
  }
  if (input.valueType === 'boolean') {
    if (value === true || value === 'true') return true;
    if (value === false || value === 'false') return false;
    throw new Error('Este campo precisa ser verdadeiro ou falso.');
  }
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value) as unknown; }
  catch { throw new Error('O valor estruturado informado não é um JSON válido.'); }
}

export function resolveStudioEndpoint(endpoint: string, baseUrl?: string): URL {
  if (/[\\\r\n\t]/.test(endpoint) || endpoint.trim().startsWith('//')) {
    throw new Error('O caminho da API não pode trocar o servidor da conexão.');
  }
  const url = baseUrl ? new URL(endpoint, baseUrl) : new URL(endpoint);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
    throw new Error('Use HTTPS, sem senha, usuário ou fragmento na URL.');
  }
  if (baseUrl && url.origin !== new URL(baseUrl).origin) {
    throw new Error('A chamada precisa usar o mesmo servidor da conexão selecionada.');
  }
  return url;
}

export function buildStudioHttpRequest(config: HttpRequestStepConfig, context: StudioDataContext, baseUrl?: string) {
  let endpoint = config.url;
  const query: Record<string, unknown> = { ...config.queryParams };
  const headers: Record<string, unknown> = { ...config.headers };
  let body: Record<string, unknown> = {};
  if (config.bodyJson?.trim()) {
    try { body = JSON.parse(config.bodyJson) as Record<string, unknown>; }
    catch { throw new Error('O corpo da API não é um JSON válido.'); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('O corpo precisa ser um objeto JSON.');
  }
  for (const mapping of config.sentDataMappings) {
    const value = resolveStudioMapping(mapping, context);
    const location = mapping.location || (config.method === 'GET' ? 'query' : 'body');
    if (location === 'path') {
      if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(mapping.apiField)) throw new Error('Parâmetro de caminho inválido.');
      const placeholder = `{${mapping.apiField}}`;
      if (!endpoint.includes(placeholder)) throw new Error('O parâmetro não foi encontrado no caminho da API.');
      endpoint = endpoint.split(placeholder).join(encodeURIComponent(String(value)));
    } else if (location === 'body') {
      if (config.method === 'GET') throw new Error('Use parâmetros de consulta em chamadas GET.');
      writeValue(body, mapping.apiField, value);
    } else {
      if (typeof value === 'object') throw new Error('Parâmetros de consulta e cabeçalhos precisam de valores simples.');
      const target = location === 'header' ? headers : query;
      if (Object.hasOwn(target, mapping.apiField)) throw new Error('Parâmetro de consulta ou cabeçalho duplicado.');
      target[mapping.apiField] = value;
    }
  }
  if (/[{}]/.test(endpoint)) throw new Error('Preencha todos os parâmetros do caminho da API.');
  for (const [name, value] of Object.entries(headers)) {
    if (/^(authorization|proxy-authorization|cookie|host|connection|content-length|transfer-encoding)$/i.test(name)) {
      throw new Error('Configure autenticação na conexão segura, não nos cabeçalhos da etapa.');
    }
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || /[\r\n]/.test(String(value))) throw new Error('Cabeçalho inválido.');
  }
  return { url: resolveStudioEndpoint(endpoint, baseUrl).toString(), query, headers, body };
}

export function buildStudioMcpArguments(config: McpToolStepConfig, context: StudioDataContext) {
  const args: Record<string, unknown> = {};
  for (const mapping of config.argumentMappings) {
    writeValue(args, mapping.argumentName, resolveStudioMapping({
      sourceType: mapping.sourceType,
      sourceValue: mapping.sourceChipKey,
      valueType: mapping.valueType,
    }, context));
  }
  return args;
}

export function mapStudioOutputs(data: unknown, mappings: HttpRequestStepConfig['outputMappings']) {
  const values: Record<string, unknown> = {};
  for (const mapping of mappings) {
    if (!mapping.chipKey || forbiddenSegments.has(mapping.chipKey) || mapping.chipKey.includes('.')) {
      throw new Error('O identificador do resultado é inválido.');
    }
    const value = readStudioValue(data, mapping.jsonPath);
    if (value === undefined && mapping.required !== false) throw new Error(`O resultado “${mapping.chipLabel}” não foi retornado pela integração.`);
    if (Object.hasOwn(values, mapping.chipKey)) throw new Error('Dois resultados usam o mesmo identificador.');
    // Explicit null clears an optional result from an earlier invocation.
    values[mapping.chipKey] = value ?? null;
  }
  return values;
}
