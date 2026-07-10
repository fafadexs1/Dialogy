import { request as httpsRequest, type RequestOptions } from 'node:https';

import type { Chat, Contact, NexusFlowInstance } from '@/lib/types';
import {
  resolveSafeAutopilotWebhookTarget,
  type ResolvedAutopilotWebhookTarget,
} from '@/services/autopilot/automation-rules';

const WEBHOOK_TIMEOUT_MS = 10_000;

function interpolateTemplate(value: string, context: Record<string, any>): string {
  return value.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path: string) => {
    const resolved = path.split('.').reduce((acc, key) => acc?.[key], context);
    return resolved == null ? '' : String(resolved);
  });
}

function interpolatePayload(value: any, context: Record<string, any>): any {
  if (typeof value === 'string') return interpolateTemplate(value, context);
  if (Array.isArray(value)) return value.map((item) => interpolatePayload(item, context));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, interpolatePayload(item, context)]));
  }
  return value;
}

function interpolateRecord(value: Record<string, string> | undefined, context: Record<string, any>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(value || {})
      .filter(([key]) => key.trim())
      .map(([key, item]) => [key, interpolateTemplate(String(item ?? ''), context)]),
  );
}

function withoutUnsafeTransportHeaders(headers: Record<string, string>): Record<string, string> {
  const unsafe = new Set(['host', 'content-length', 'connection', 'transfer-encoding']);
  return Object.fromEntries(
    Object.entries(headers).filter(([key]) => !unsafe.has(key.trim().toLowerCase())),
  );
}

function encodeFormData(payload: Record<string, unknown>): { body: Buffer; contentType: string } {
  const boundary = `----DialogyWebhook${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  const chunks: Buffer[] = [];

  for (const [key, value] of Object.entries(payload)) {
    const serializedValue = value == null
      ? ''
      : typeof value === 'string'
        ? value
        : JSON.stringify(value);
    chunks.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${key.replace(/[\r\n"]/g, '')}"\r\n\r\n${serializedValue}\r\n`,
      'utf8',
    ));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));

  return {
    body: Buffer.concat(chunks),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

export function buildPinnedWebhookRequestOptions(input: {
  url: URL;
  address: string;
  method: string;
  headers: Record<string, string>;
  body?: Buffer;
}): RequestOptions {
  const headers = withoutUnsafeTransportHeaders(input.headers);
  headers.Host = input.url.host;
  if (input.body) {
    headers['Content-Length'] = String(input.body.byteLength);
  }

  return {
    protocol: 'https:',
    hostname: input.address,
    port: input.url.port ? Number(input.url.port) : 443,
    path: `${input.url.pathname || '/'}${input.url.search}`,
    method: input.method,
    headers,
    // Preserve the original hostname for TLS SNI/certificate validation while
    // the TCP connection is pinned to the already-validated public IP.
    servername: input.url.hostname.replace(/^\[|\]$/g, ''),
  };
}

function sendPinnedHttpsWebhookRequest(input: {
  url: URL;
  address: string;
  method: string;
  headers: Record<string, string>;
  body?: Buffer;
}): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const request = httpsRequest(buildPinnedWebhookRequestOptions(input), (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      response.once('error', reject);
      response.once('end', () => {
        resolve({
          status: response.statusCode || 0,
          text: Buffer.concat(chunks).toString('utf8'),
        });
      });
    });

    request.once('error', reject);
    request.setTimeout(WEBHOOK_TIMEOUT_MS, () => {
      request.destroy(new Error(`Webhook request timed out after ${WEBHOOK_TIMEOUT_MS}ms.`));
    });
    if (input.body) request.write(input.body);
    request.end();
  });
}

async function sendPinnedWebhookRequest(input: {
  target: ResolvedAutopilotWebhookTarget;
  method: string;
  headers: Record<string, string>;
  body?: Buffer;
}): Promise<{ status: number; text: string }> {
  let lastError: unknown = null;
  for (const address of input.target.addresses) {
    try {
      return await sendPinnedHttpsWebhookRequest({
        url: input.target.url,
        address,
        method: input.method,
        headers: input.headers,
        body: input.body,
      });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('Webhook request could not be started.');
}

export async function executeTriggeredWebhookRule(input: {
  rule: NexusFlowInstance;
  chat: Chat;
  contact: Contact;
  message: string;
  agentResponse?: string | null;
}) {
  if (input.rule.action?.type !== 'webhook') {
    return null;
  }

  const action = input.rule.action;
  const method = action.method || 'POST';
  const context = {
    chat: { id: input.chat.id, workspace_id: input.chat.workspace_id, status: input.chat.status },
    contact: input.contact,
    message: input.message,
    resposta_agente: input.agentResponse || '',
    agent: {
      response: input.agentResponse || '',
    },
  };
  const target = await resolveSafeAutopilotWebhookTarget(new URL(interpolateTemplate(action.url, context)));
  const url = target.url;
  const query = interpolateRecord(action.query, context);
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }

  const headers = interpolateRecord(action.headers, context);
  const auth = action.auth;
  if (auth?.type === 'bearer' && auth.token) {
    headers.Authorization = `Bearer ${interpolateTemplate(auth.token, context)}`;
  } else if (auth?.type === 'basic' && (auth.username || auth.password)) {
    const username = interpolateTemplate(auth.username || '', context);
    const password = interpolateTemplate(auth.password || '', context);
    headers.Authorization = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
  } else if (auth?.type === 'api_key' && auth.key && auth.value) {
    const key = interpolateTemplate(auth.key, context);
    const value = interpolateTemplate(auth.value, context);
    if (auth.placement === 'query') {
      url.searchParams.set(key, value);
    } else {
      headers[key] = value;
    }
  }

  const bodyPayload = interpolatePayload(action.body || {}, context);
  let body: Buffer | undefined;
  if (method !== 'GET' && method !== 'DELETE') {
    if (action.bodyType === 'form-data') {
      const encoded = encodeFormData(bodyPayload);
      headers['Content-Type'] = headers['Content-Type'] || encoded.contentType;
      body = encoded.body;
    } else {
      headers['Content-Type'] = headers['Content-Type'] || 'application/json';
      body = Buffer.from(JSON.stringify(bodyPayload), 'utf8');
    }
  }

  const response = await sendPinnedWebhookRequest({
    target,
    method,
    headers,
    body,
  });
  const text = response.text;
  let parsed: any = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Webhook ${input.rule.name} retornou HTTP ${response.status}: ${text.slice(0, 300)}`);
  }

  const reply =
    parsed?.reply ||
    parsed?.message ||
    parsed?.response ||
    parsed?.content ||
    (typeof parsed === 'string' ? parsed : null);

  return {
    reply: typeof reply === 'string' && reply.trim() ? reply.trim() : null,
    response: parsed ?? text,
  };
}
