import https from 'node:https';
import { randomBytes } from 'node:crypto';
import { isIP } from 'node:net';

import type { NodeRuntimeInput } from '@/services/workflow-runtime';
import { resolveSafeAutopilotWebhookTarget } from '@/services/autopilot/automation-rules';
import { executeJsonataTransform } from '@/services/workflow-runtime/jsonata-runtime';
import { isRecord, materializeValue, readPath, renderTemplate } from '@/services/workflow-runtime/utils';
import { loadNexusCredentialPayload } from './credentials';

type HttpResult = {
  status: number;
  headers: Record<string, string | string[]>;
  data: unknown;
};

export type NexusHttpOperationInput = {
  workspaceId: string;
  config: Record<string, unknown>;
  runtimeSource: Record<string, unknown>;
  signal: AbortSignal;
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

async function requestPublicHttps(input: {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  timeoutMs: number;
  maxResponseBytes: number;
  signal: AbortSignal;
}): Promise<HttpResult> {
  const target = await resolveSafeAutopilotWebhookTarget(input.url);
  const address = target.addresses[0]!;
  return new Promise((resolve, reject) => {
    const request = https.request(target.url, {
      method: input.method,
      headers: input.headers,
      servername: target.url.hostname,
      lookup: (_hostname, _options, callback) => callback(null, address, isIP(address)),
      timeout: input.timeoutMs,
    }, (response) => {
      const chunks: Buffer[] = [];
      let total = 0;
      response.on('data', (chunk: Buffer) => {
        total += chunk.length;
        if (total > input.maxResponseBytes) {
          request.destroy(new Error('A resposta HTTP excedeu o limite configurado.'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        const contentType = String(response.headers['content-type'] || '');
        let data: unknown = raw;
        if (contentType.includes('json') || /^[\[{]/.test(raw.trim())) {
          try { data = JSON.parse(raw); } catch { data = raw; }
        }
        const status = response.statusCode || 0;
        const result = { status, headers: response.headers as Record<string, string | string[]>, data };
        if (status < 200 || status >= 300) {
          const error = new Error(`A API respondeu com status ${status}.`) as Error & { code?: string; retryable?: boolean; details?: Record<string, unknown> };
          error.code = status === 429 ? 'RATE_LIMITED' : status >= 500 ? 'UPSTREAM_UNAVAILABLE' : 'HTTP_REQUEST_FAILED';
          error.retryable = status === 429 || status >= 500;
          error.details = { status, response: typeof data === 'string' ? data.slice(0, 2_000) : data };
          reject(error);
          return;
        }
        resolve(result);
      });
    });
    request.on('timeout', () => request.destroy(Object.assign(new Error('A requisição HTTP excedeu o tempo limite.'), { code: 'TIMEOUT', retryable: true })));
    request.on('error', reject);
    const abort = () => request.destroy(input.signal.reason instanceof Error ? input.signal.reason : new Error('Requisição cancelada.'));
    if (input.signal.aborted) abort();
    else input.signal.addEventListener('abort', abort, { once: true });
    request.on('close', () => input.signal.removeEventListener('abort', abort));
    if (input.body) request.write(input.body);
    request.end();
  });
}

function materializedRecord(value: unknown, source: Record<string, unknown>): Record<string, unknown> {
  const materialized = materializeValue(value || {}, source);
  return isRecord(materialized) ? materialized : {};
}

function multipartBody(values: Record<string, unknown>) {
  const boundary = `----DialogyNexus${randomBytes(12).toString('hex')}`;
  const chunks = Object.entries(values).map(([key, value]) => {
    const safeName = key.replace(/[\r\n"]/g, '');
    const serialized = typeof value === 'string' ? value : JSON.stringify(value);
    return `--${boundary}\r\nContent-Disposition: form-data; name="${safeName}"\r\n\r\n${serialized ?? ''}\r\n`;
  });
  return { boundary, body: `${chunks.join('')}--${boundary}--\r\n` };
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
  const source = input.runtimeSource;
  const method = String(input.config.method || 'GET').toUpperCase();
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].includes(method)) {
    throw Object.assign(new Error('O método HTTP configurado não é permitido.'), { code: 'HTTP_METHOD_NOT_ALLOWED', retryable: false });
  }
  const renderedUrl = renderTemplate(String(input.config.url || ''), source);
  if (renderedUrl.length > 8_192) throw Object.assign(new Error('A URL HTTP ultrapassa o limite permitido.'), { code: 'HTTP_URL_TOO_LARGE', retryable: false });
  const url = new URL(renderedUrl);
  const headersValue = materializedRecord(input.config.headers, source);
  const queryValue = materializedRecord(input.config.query, source);
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
      allowedTypes: ['bearer', 'api_key', 'basic'],
    });
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

  let body: string | undefined;
  const bodyType = String(input.config.bodyType || 'none');
  if (!['GET', 'HEAD'].includes(method) && bodyType !== 'none') {
    const materialized = materializeValue(input.config.body ?? {}, source);
    if (bodyType === 'raw' || bodyType === 'text') {
      body = typeof materialized === 'string' ? materialized : JSON.stringify(materialized);
    } else if (bodyType === 'form-data') {
      const form = multipartBody(isRecord(materialized) ? materialized : {});
      body = form.body;
      if (!Object.keys(headers).some((name) => name.toLowerCase() === 'content-type')) headers['Content-Type'] = `multipart/form-data; boundary=${form.boundary}`;
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
  if (body && Buffer.byteLength(body, 'utf8') > maxRequestBytes) {
    throw Object.assign(new Error('O corpo HTTP ultrapassa o limite configurado.'), { code: 'HTTP_REQUEST_TOO_LARGE', retryable: false });
  }

  const response = await requestPublicHttps({
    url: url.toString(),
    method,
    headers,
    body,
    timeoutMs: Math.max(100, Math.min(120_000, Number(input.config.timeoutMs || 15_000))),
    maxResponseBytes: Math.max(1_024, Math.min(10_000_000, Number(input.config.maxResponseBytes || 1_000_000))),
    signal: input.signal,
  });
  const responsePath = String(input.config.responsePath || '').trim();
  const selected = (responsePath ? readPath(response.data, responsePath) : response.data) ?? null;
  return { status: response.status, headers: response.headers, data: response.data, selected };
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
