import type { Chat, Contact, NexusFlowInstance } from '@/lib/types';

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
  const url = new URL(interpolateTemplate(action.url, context));
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
  const requestInit: RequestInit = { method, headers };
  if (method !== 'GET' && method !== 'DELETE') {
    if (action.bodyType === 'form-data') {
      const formData = new FormData();
      for (const [key, value] of Object.entries(bodyPayload)) {
        formData.append(key, value == null ? '' : String(value));
      }
      requestInit.body = formData;
    } else {
      headers['Content-Type'] = headers['Content-Type'] || 'application/json';
      requestInit.body = JSON.stringify(bodyPayload);
    }
  }

  const response = await fetch(url.toString(), requestInit);
  const text = await response.text();
  let parsed: any = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }

  if (!response.ok) {
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
