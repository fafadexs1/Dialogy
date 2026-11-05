import { randomBytes } from 'node:crypto';

import type { NodeRuntimeInput } from '@/services/workflow-runtime';
import { executeJsonataTransform } from '@/services/workflow-runtime/jsonata-runtime';
import { isRecord, materializeValue, readPath, renderTemplate } from '@/services/workflow-runtime/utils';
import { loadNexusCredentialPayload } from './credentials';

import { requestPublicHttps } from './public-http';
import { saveWorkflowFile, loadWorkflowFile } from './workflow-files';
import { WorkflowFileReferenceSchema } from '@/services/workflow-runtime/file-reference';
import { resolveNexusOAuthToken } from './oauth-credentials';
import { assertAutomationToolboxEnabled } from './toolbox-policy';

export type NexusHttpOperationInput = {
  workspaceId: string;
  config: Record<string, unknown>;
  runtimeSource: Record<string, unknown>;
  signal: AbortSignal;
  /** Server-side approved request whose templates have already been resolved. */
  preResolved?: boolean;
};

function sourceContext(input: NodeRuntimeInput) {
  return {
    ...input.execution.variables,
    input: input.execution.input,
    current: input.input,
    variables: input.execution.variables,
    context: input.execution.context,
    nodeResults: input.execution.nodeResults,
    sessionId: input.execution.sessionId,
    conversationId: input.execution.conversationId,
  };
}

function materializedRecord(value: unknown, source: Record<string, unknown>): Record<string, unknown> {
  const materialized = materializeValue(value || {}, source);
  return isRecord(materialized) ? materialized : {};
}

async function multipartBody(values: Record<string, unknown>, workspaceId: string) {
  if (Object.keys(values).length > 100) throw new Error('Use até 100 campos no formulário.');
  const boundary = `----DialogyNexus${randomBytes(12).toString('hex')}`;
  const chunks: Buffer[] = [];
  for (const [key, value] of Object.entries(values)) {
    if (chunks.reduce((sum, chunk) => sum + chunk.length, 0) > 5_000_000) throw new Error('O formulário excede 5 MB.');
    const safeName = key.replace(/[\r\n"]/g, '');
    if (WorkflowFileReferenceSchema.safeParse(value).success) {
      const { file, data } = await loadWorkflowFile(workspaceId, value);
      const name = file.name.replace(/[\r\n"\\]/g, '_');
      chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${safeName}"; filename="${name}"\r\nContent-Type: ${file.mimeType}\r\n\r\n`), data, Buffer.from('\r\n'));
      continue;
    }
    const serialized = typeof value === 'string' ? value : JSON.stringify(value);
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${safeName}"\r\n\r\n${serialized ?? ''}\r\n`));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { boundary, body: Buffer.concat(chunks) };
}

function setStatePath(target: Record<string, unknown>, path: string, value: unknown) {
  const segments = path
    .replace(/^\{\{\s*|\s*\}\}$/g, '')
    .replace(/^(?:flow_variables|variables)\./, '')
    .split('.')
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (segments.length === 0 || segments.some((segment) => ['__proto__', 'prototype', 'constructor'].includes(segment))) return;
  let current = target;
  for (const segment of segments.slice(0, -1)) {
    if (!isRecord(current[segment])) current[segment] = {};
    current = current[segment] as Record<string, unknown>;
  }
  current[segments.at(-1)!] = value;
}

export async function executeNexusHttpOperation(input: NexusHttpOperationInput): Promise<Record<string, unknown>> {
  if (['file', 'microsoft_file'].includes(String(input.config.responseFormat)) || input.config.bodyType === 'binary' || (isRecord(input.config.pagination) && ['page', 'cursor'].includes(String(input.config.pagination.mode)))) assertAutomationToolboxEnabled(input.workspaceId);
  const source = input.runtimeSource;
  const method = String(input.config.method || 'GET').toUpperCase();
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].includes(method)) {
    throw Object.assign(new Error('O método HTTP configurado não é permitido.'), { code: 'HTTP_METHOD_NOT_ALLOWED', retryable: false });
  }
  const rawUrl = String(input.config.url || '');
  const encodedPaths = new Set(Array.isArray(input.config.encodedPathArguments) ? input.config.encodedPathArguments.filter((value): value is string => typeof value === 'string' && /^arguments\.[A-Za-z][A-Za-z0-9_]*$/.test(value)) : []);
  const renderedUrl = input.preResolved ? rawUrl : rawUrl.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_.-]*)\s*\}\}/g, (match, path: string) => {
    if (!encodedPaths.has(path)) return renderTemplate(match, source);
    const value = readPath(source, path);
    if (typeof value !== 'string' || !value) throw new Error('Parâmetro de caminho ausente ou inválido.');
    return encodeURIComponent(value);
  });
  if (renderedUrl.length > 8_192) throw Object.assign(new Error('A URL HTTP ultrapassa o limite permitido.'), { code: 'HTTP_URL_TOO_LARGE', retryable: false });
  const url = new URL(renderedUrl);
  if (input.config.credentialId && !input.preResolved) {
    let origin: string;
    try { origin = new URL(rawUrl).origin; } catch { throw new Error('A origem da URL autenticada deve ser fixa.'); }
    if (/[{}]/.test(origin) || origin !== url.origin) throw new Error('A origem da URL autenticada deve ser fixa.');
  }
  const headersValue = input.preResolved && isRecord(input.config.headers) ? input.config.headers : materializedRecord(input.config.headers, source);
  const queryValue = input.preResolved && isRecord(input.config.query) ? input.config.query : materializedRecord(input.config.query, source);
  if (Object.keys(headersValue).length > 100) throw Object.assign(new Error('A requisição possui headers demais.'), { code: 'HTTP_HEADERS_LIMIT', retryable: false });
  const headers = Object.fromEntries(Object.entries(headersValue).map(([key, value]) => {
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(key) || /[\r\n]/.test(String(value))) {
      throw Object.assign(new Error(`O header "${key}" é inválido.`), { code: 'HTTP_HEADER_INVALID', retryable: false });
    }
    return [key, String(value)];
  }));
  for (const [key, value] of Object.entries(queryValue)) url.searchParams.set(key, String(value));

  const credentialId = String(input.config.credentialId || '').trim();
  if (credentialId) {
    const credential = await loadNexusCredentialPayload({
      workspaceId: input.workspaceId,
      credentialId,
      allowedTypes: ['bearer', 'api_key', 'basic', 'oauth2'],
    });
    if (credential.metadata?.allowedOrigin && credential.metadata.allowedOrigin !== url.origin) throw new Error('Esta credencial não autoriza a origem solicitada.');
    const notionSearch = credential.metadata?.provider === 'notion' && method === 'POST' && url.origin === 'https://api.notion.com' && url.pathname === '/v1/search';
    const calendarFreebusy = credential.metadata?.provider === 'google_workspace' && credential.metadata?.app === 'calendar' && method === 'POST' && url.origin === 'https://www.googleapis.com' && url.pathname === '/calendar/v3/freeBusy';
    if (['google_workspace', 'github', 'notion'].includes(String(credential.metadata?.provider)) && credential.metadata.access === 'read' && !['GET', 'HEAD'].includes(method) && !notionSearch && !calendarFreebusy) throw new Error('Esta conexão permite apenas leitura.');
    if (credential.type === 'oauth2') headers.Authorization = `Bearer ${await resolveNexusOAuthToken(input.workspaceId, credentialId, url.origin, input.signal)}`;
    if (credential.type === 'bearer') headers.Authorization = `Bearer ${String(credential.payload.token || '')}`;
    if (credential.type === 'basic') {
      headers.Authorization = `Basic ${Buffer.from(`${String(credential.payload.username || '')}:${String(credential.payload.password || '')}`).toString('base64')}`;
    }
    if (credential.type === 'api_key') {
      const name = String(credential.payload.name || 'X-API-Key');
      const value = String(credential.payload.value || '');
      if (credential.payload.placement === 'query') url.searchParams.set(name, value);
      else headers[name] = value;
    }
  }

  let body: string | Buffer | undefined;
  const bodyType = String(input.config.bodyType || 'none');
  if (!['GET', 'HEAD'].includes(method) && bodyType !== 'none') {
    const materialized = input.preResolved ? input.config.body ?? {} : materializeValue(input.config.body ?? {}, source);
    if (bodyType === 'raw' || bodyType === 'text') {
      body = typeof materialized === 'string' ? materialized : JSON.stringify(materialized);
    } else if (bodyType === 'form-data') {
      const form = await multipartBody(isRecord(materialized) ? materialized : {}, input.workspaceId);
      body = form.body;
      for (const name of Object.keys(headers)) if (name.toLowerCase() === 'content-type') delete headers[name];
      headers['Content-Type'] = `multipart/form-data; boundary=${form.boundary}`;
    } else if (bodyType === 'binary') {
      const loaded = await loadWorkflowFile(input.workspaceId, materialized);
      body = loaded.data;
      headers['Content-Type'] = loaded.file.mimeType;
    } else if (bodyType === 'urlencoded') {
      body = new URLSearchParams(Object.entries(isRecord(materialized) ? materialized : {}).map(([key, value]) => [key, String(value)])).toString();
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
    } else {
      if (typeof materialized === 'string') {
        try { JSON.parse(materialized); } catch {
          throw Object.assign(new Error('O corpo configurado como JSON não é válido depois de preencher os argumentos.'), { code: 'HTTP_BODY_INVALID_JSON', retryable: false });
        }
        body = materialized;
      } else {
        body = JSON.stringify(materialized);
      }
      if (!Object.keys(headers).some((name) => name.toLowerCase() === 'content-type')) headers['Content-Type'] = 'application/json';
    }
  }
  const maxRequestBytes = Math.max(1_024, Math.min(5_000_000, Number(input.config.maxRequestBytes || 1_000_000)));
  if (body && Buffer.byteLength(body) > maxRequestBytes) {
    throw Object.assign(new Error('O corpo HTTP ultrapassa o limite configurado.'), { code: 'HTTP_REQUEST_TOO_LARGE', retryable: false });
  }

  for (const [name, value] of Object.entries(headers)) {
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || /[\r\n]/.test(value)) throw new Error('Header de autenticação inválido.');
    if (['host', 'connection', 'transfer-encoding', 'content-length'].includes(name.toLowerCase())) throw new Error(`O header ${name} é gerenciado pelo transporte.`);
  }
  if (input.config.responseFormat === 'microsoft_file') {
    const fileName = String(input.config.fileName || '');
    const mimeTypes: Record<string, string> = { docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation' };
    const extension = fileName.split('.').at(-1) || '';
    if (method !== 'GET' || url.origin !== 'https://graph.microsoft.com' || !/^\/v1\.0\/me\/drive\/items\/[^/]+\/content$/.test(url.pathname) || url.search || !credentialId || !mimeTypes[extension] || !/^[A-Za-z0-9_.-]+$/.test(fileName) || Object.keys(headers).some(name => name.toLowerCase() !== 'authorization') || !/^Bearer [^\s]+$/.test(headers.Authorization || '')) throw new Error('Configuração de download Microsoft inválida.');
    try {
      const signal = AbortSignal.any([input.signal, AbortSignal.timeout(30000)]);
      const first = await requestPublicHttps({ url:url.toString(), method:'GET', headers:{Authorization:headers.Authorization}, timeoutMs:15000, maxResponseBytes:64000, signal, allowRedirectResponse:true });
      const location = first.headers.location;
      if (first.status !== 302 || typeof location !== 'string' || location.length > 8192) throw new Error('Redirecionamento ausente.');
      const target = new URL(location);
      if (target.protocol !== 'https:' || target.username || target.password || target.hash) throw new Error('Redirecionamento inválido.');
      const download = await requestPublicHttps({ url:target.toString(), method:'GET', headers:{Accept:'application/octet-stream'}, timeoutMs:15000, maxResponseBytes:5000000, signal });
      const file = await saveWorkflowFile({workspaceId:input.workspaceId,name:fileName,mimeType:mimeTypes[extension]!,data:download.body});
      return {status:download.status,headers:{},data:file,selected:file};
    } catch { throw new Error('Não foi possível baixar o arquivo Microsoft de forma segura.'); }
  }
  const pagination = isRecord(input.config.pagination) ? input.config.pagination : {};
  for (const name of ['maxPages', 'maxItems', 'timeoutMs', 'startPage']) if (pagination[name] !== undefined && !Number.isFinite(Number(pagination[name]))) throw new Error('Limite de paginação inválido.');
  for (const name of ['maxRequestBytes', 'maxResponseBytes', 'timeoutMs']) if (input.config[name] !== undefined && !Number.isFinite(Number(input.config[name]))) throw new Error('Limite HTTP inválido.');
  const paginated = ['page', 'cursor'].includes(String(pagination.mode));
  if (paginated && (method !== 'GET' || input.config.responseFormat === 'file')) throw new Error('Paginação exige GET com resposta JSON.');
  const maxPages = Math.min(100, Math.max(1, Number(pagination.maxPages || 10)));
  const maxItems = Math.min(10000, Math.max(1, Number(pagination.maxItems || 1000)));
  const deadline = Date.now() + Math.min(120000, Math.max(100, Number(pagination.timeoutMs || 60000)));
  const maxResponseBytes = Math.max(1024, Math.min(10_000_000, Number(input.config.maxResponseBytes || 1_000_000)));
  const items: unknown[] = [];
  let totalBytes = 0, pages = 0, hasMore = false;
  let finalResult: Record<string, unknown> = {};
  const cursors = new Set<string>();
  do {
    input.signal.throwIfAborted();
    if (paginated && Date.now() >= deadline) throw new Error('A paginação excedeu o tempo limite.');
    if (paginated && pagination.mode === 'page') url.searchParams.set(String(pagination.parameter || 'page'), String(Number(pagination.startPage || 1) + pages));
    const response = await requestPublicHttps({
    url: url.toString(),
    method,
    headers,
    body,
    timeoutMs: Math.max(1, Math.min(120_000, Number(input.config.timeoutMs || 15_000), paginated ? deadline - Date.now() : 120000)),
    maxResponseBytes: maxResponseBytes - totalBytes,
    signal: input.signal,
  });
    totalBytes += response.body.length;
    pages++;
    const contentType = String(response.headers['content-type'] || '').split(';')[0]!;
    const format = String(input.config.responseFormat || 'legacy');
    let data: unknown;
    if (format === 'file' || (format === 'auto' && contentType && !/json|text|xml|javascript|x-www-form-urlencoded/.test(contentType))) {
      assertAutomationToolboxEnabled(input.workspaceId);
      if (paginated) throw new Error('A paginação recebeu um arquivo em vez de JSON.');
      data = await saveWorkflowFile({ workspaceId: input.workspaceId, name: String(input.config.fileName || 'resposta.bin'), mimeType: contentType || 'application/octet-stream', data: response.body });
    } else {
      const raw = response.body.toString('utf8');
      data = raw;
      if (format === 'json' || (format !== 'text' && (contentType.includes('json') || /^[\[{]/.test(raw.trim())))) {
        try { data = JSON.parse(raw); } catch { if (format === 'json' || paginated) throw new Error('A API não retornou JSON válido.'); }
      }
    }
    const responsePath = String(input.config.responsePath || '').trim();
    const selected = (responsePath ? readPath(data, responsePath) : data) ?? null;
    finalResult = { status: response.status, headers: response.headers, data, selected };
    if (!paginated) break;
    const pageItems = pagination.itemsPath ? readPath(data, String(pagination.itemsPath)) : selected;
    if (!Array.isArray(pageItems)) throw new Error('O caminho de itens da paginação precisa retornar uma lista.');
    if (items.length + pageItems.length > maxItems) throw new Error('A paginação excedeu o limite de itens.');
    items.push(...pageItems);
    const cursor = pagination.nextCursorPath ? readPath(data, String(pagination.nextCursorPath)) : undefined;
    hasMore = pagination.mode === 'cursor' ? cursor !== undefined && cursor !== null && cursor !== '' : pageItems.length > 0;
    if (hasMore && pagination.mode === 'cursor') {
      const next = String(cursor);
      if (cursors.has(next)) throw new Error('A API repetiu o cursor de paginação.');
      cursors.add(next);
      url.searchParams.set(String(pagination.parameter || 'cursor'), next);
    }
  } while (hasMore && pages < maxPages);
  return paginated ? { ...finalResult, data: items, selected: items, pagination: { pages, items: items.length, hasMore, bytes: totalBytes } } : finalResult;
}

export async function executeNexusHttpRequest(input: NodeRuntimeInput): Promise<Record<string, unknown>> {
  const workspaceId = input.workflow.workspaceId;
  if (!workspaceId) throw new Error('O workflow HTTP precisa pertencer a um workspace.');
  const result = await executeNexusHttpOperation({
    workspaceId,
    config: input.node.config,
    runtimeSource: sourceContext(input),
    signal: input.signal,
  });
  const outputKey = String(input.node.config.outputKey || 'response').trim();
  const statePatch: Record<string, unknown> = {};
  if (outputKey) setStatePath(statePatch, outputKey, result.selected);
  const responseMappings = Array.isArray(input.node.config.responseMappings)
    ? input.node.config.responseMappings.filter(isRecord)
    : [];
  for (const mapping of responseMappings) {
    const expression = String(mapping.jsonPath || '').trim();
    const flowVariable = String(mapping.flowVariable || '').trim();
    if (!expression || !flowVariable) continue;
    let extracted = await executeJsonataTransform({
      expression,
      source: result.data,
      context: sourceContext(input),
      current: isRecord(result.data) ? result.data : { value: result.data },
      timeoutMs: 250,
    });
    if (mapping.extractAs === 'list') {
      const list = Array.isArray(extracted)
        ? extracted
        : extracted === undefined || extracted === null
          ? []
          : [extracted];
      const itemField = String(mapping.itemField || '').trim();
      extracted = itemField
        ? list.map((item) => readPath(item, itemField)).filter((item) => item !== undefined && item !== null)
        : list;
    }
    setStatePath(statePatch, flowVariable, extracted);
  }
  return {
    ...result,
    ...(Object.keys(statePatch).length ? { statePatch } : {}),
  };
}
