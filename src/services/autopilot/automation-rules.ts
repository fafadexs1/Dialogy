import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

import type { Action, NexusFlowInstance } from '@/lib/types';

export type InvalidAutopilotRule = {
  id: string;
  name: string;
  reason: string;
};

export type SanitizedAutopilotRules = {
  rules: NexusFlowInstance[];
  invalid: InvalidAutopilotRule[];
};

export type ResolvedAutopilotWebhookTarget = {
  url: URL;
  addresses: string[];
};

type UnknownRecord = Record<string, unknown>;
type WebhookAction = Extract<Action, { type: 'webhook' }>;

const HTTP_METHODS = new Set<WebhookAction['method']>([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
]);

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function stringRecord(value: unknown): Record<string, string> | undefined {
  const record = asRecord(value);
  if (!record) return undefined;

  const entries = Object.entries(record)
    .filter(([, item]) => typeof item === 'string')
    .map(([key, item]) => [key, item as string] as const);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function normalizeHostname(value: string): string {
  return value.trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
}

function isBlockedIpv4Address(value: string): boolean {
  const octets = value.split('.').map((part) => Number(part));
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }

  const [first, second] = octets;
  return first === 0
    || first === 10
    || first === 127
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && (second === 0 || second === 168))
    || (first === 198 && (second === 18 || second === 19 || second === 51))
    || (first === 203 && second === 0)
    || first >= 224;
}

function isBlockedIpv6Address(value: string): boolean {
  const normalized = normalizeHostname(value);
  if (normalized === '::' || normalized === '::1') return true;
  if (/^(fc|fd|fe[89ab]|ff)/i.test(normalized) || /^2001:db8:/i.test(normalized)) return true;

  const mappedIpv4 = normalized.match(/^::ffff:(.+)$/i)?.[1];
  if (!mappedIpv4) return false;

  if (mappedIpv4.includes('.')) return isBlockedIpv4Address(mappedIpv4);

  const mappedParts = mappedIpv4.split(':');
  if (mappedParts.length !== 2 || mappedParts.some((part) => !/^[0-9a-f]{1,4}$/i.test(part))) {
    return true;
  }
  const high = Number.parseInt(mappedParts[0], 16);
  const low = Number.parseInt(mappedParts[1], 16);
  return isBlockedIpv4Address([
    high >> 8,
    high & 0xff,
    low >> 8,
    low & 0xff,
  ].join('.'));
}

function isBlockedNetworkAddress(value: string): boolean {
  const normalized = normalizeHostname(value);
  const version = isIP(normalized);
  if (version === 4) return isBlockedIpv4Address(normalized);
  if (version === 6) return isBlockedIpv6Address(normalized);
  return false;
}

function isPrivateHostname(value: string): boolean {
  const hostname = normalizeHostname(value);
  if (!hostname) return true;
  if (
    hostname === 'localhost'
    || hostname.endsWith('.localhost')
    || hostname.endsWith('.local')
    || hostname === 'metadata.google.internal'
  ) {
    return true;
  }
  return isBlockedNetworkAddress(hostname);
}

function parseWebhookUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/**
 * Webhooks run from our server, so their endpoint must be a public HTTPS URL.
 * This blocks the common SSRF paths before a rule can reach the runtime.
 */
export function isSafeAutopilotWebhookUrl(value: string): boolean {
  const parsed = parseWebhookUrl(value);
  return Boolean(
    parsed
    && parsed.protocol === 'https:'
    && !parsed.username
    && !parsed.password
    && !isPrivateHostname(parsed.hostname),
  );
}

/**
 * Resolves an interpolated URL immediately before it is requested. The caller
 * must connect to one of these validated addresses rather than resolve the
 * hostname again, preventing a DNS-rebinding request to an internal address.
 */
export async function resolveSafeAutopilotWebhookTarget(
  value: URL | string,
): Promise<ResolvedAutopilotWebhookTarget> {
  const parsed = value instanceof URL ? value : parseWebhookUrl(value);
  if (!parsed || !isSafeAutopilotWebhookUrl(parsed.toString())) {
    throw new Error('Webhook URL must use HTTPS and target a public host.');
  }

  const hostname = normalizeHostname(parsed.hostname);
  if (isIP(hostname)) {
    return { url: parsed, addresses: [hostname] };
  }

  let resolvedAddresses: Array<{ address: string }>;
  try {
    resolvedAddresses = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new Error('Webhook host could not be resolved.');
  }

  const addresses = Array.from(new Set(resolvedAddresses.map(({ address }) => normalizeHostname(address))));
  if (addresses.length === 0 || addresses.some((address) => isBlockedNetworkAddress(address))) {
    throw new Error('Webhook URL resolved to a private or reserved network address.');
  }

  return { url: parsed, addresses };
}

/**
 * Validates the target for callers that only need a save-time safety check.
 */
export async function assertSafeAutopilotWebhookUrl(value: URL | string): Promise<URL> {
  return (await resolveSafeAutopilotWebhookTarget(value)).url;
}

function normalizeAction(value: unknown): Action | null {
  const action = asRecord(value);
  const type = nonEmptyString(action?.type);

  if (type === 'reply') {
    const legacyPayload = asRecord(action?.payload);
    const response = nonEmptyString(action?.value)
      || nonEmptyString(legacyPayload?.message)
      || nonEmptyString(legacyPayload?.value)
      || nonEmptyString(legacyPayload?.response);
    return response ? { type: 'reply', value: response } : null;
  }

  if (type !== 'webhook') return null;

  const url = nonEmptyString(action?.url);
  if (!url || !isSafeAutopilotWebhookUrl(url)) return null;

  const method = nonEmptyString(action?.method)?.toUpperCase() || 'POST';
  if (!HTTP_METHODS.has(method as WebhookAction['method'])) {
    return null;
  }

  const rawAuth = asRecord(action?.auth);
  const authType = nonEmptyString(rawAuth?.type);
  const placement: 'header' | 'query' | undefined = rawAuth?.placement === 'header' || rawAuth?.placement === 'query'
    ? rawAuth.placement
    : undefined;
  const auth: WebhookAction['auth'] = authType && ['none', 'bearer', 'basic', 'api_key'].includes(authType)
    ? {
      type: authType as NonNullable<WebhookAction['auth']>['type'],
      ...(nonEmptyString(rawAuth?.token) ? { token: nonEmptyString(rawAuth?.token)! } : {}),
      ...(nonEmptyString(rawAuth?.username) ? { username: nonEmptyString(rawAuth?.username)! } : {}),
      ...(nonEmptyString(rawAuth?.password) ? { password: nonEmptyString(rawAuth?.password)! } : {}),
      ...(nonEmptyString(rawAuth?.key) ? { key: nonEmptyString(rawAuth?.key)! } : {}),
      ...(nonEmptyString(rawAuth?.value) ? { value: nonEmptyString(rawAuth?.value)! } : {}),
      ...(placement ? { placement } : {}),
    }
    : undefined;
  const body = asRecord(action?.body) || undefined;

  const normalized: WebhookAction = {
    type: 'webhook',
    url,
    method: method as WebhookAction['method'],
    ...(nonEmptyString(action?.description) ? { description: nonEmptyString(action?.description)! } : {}),
    ...(auth ? { auth } : {}),
    ...(stringRecord(action?.headers) ? { headers: stringRecord(action?.headers) } : {}),
    ...(stringRecord(action?.query) ? { query: stringRecord(action?.query) } : {}),
    ...(action?.bodyType === 'json' || action?.bodyType === 'form-data' ? { bodyType: action.bodyType } : {}),
    ...(body ? { body } : {}),
  };
  return normalized;
}

/**
 * Converts legacy or malformed database rows into the only two automation
 * contracts the runtime can safely execute. A bad row must never abort an AI
 * turn for the whole chat.
 */
export function sanitizeAutopilotRules(value: unknown): SanitizedAutopilotRules {
  const rawRules = Array.isArray(value) ? value : [];
  const rules: NexusFlowInstance[] = [];
  const invalid: InvalidAutopilotRule[] = [];

  rawRules.forEach((raw, index) => {
    const rule = asRecord(raw);
    const id = nonEmptyString(rule?.id) || `invalid-rule-${index + 1}`;
    const name = nonEmptyString(rule?.name) || `Regra ${index + 1}`;
    const trigger = nonEmptyString(rule?.trigger);
    const action = normalizeAction(rule?.action);

    if (!trigger) {
      invalid.push({ id, name, reason: 'trigger_missing' });
      return;
    }
    if (!action) {
      invalid.push({ id, name, reason: 'unsupported_or_invalid_action' });
      return;
    }

    rules.push({
      id,
      name,
      trigger,
      action,
      enabled: rule?.enabled !== false,
      ...(nonEmptyString(rule?.model) ? { model: nonEmptyString(rule?.model)! } : {}),
    });
  });

  return { rules, invalid };
}

/**
 * Strips credentials and URLs before an automation rule is inserted into an
 * LLM prompt. The rule name is enough for the runtime to execute it later.
 */
export function toPromptSafeAutopilotRules(rules: NexusFlowInstance[]) {
  return rules.map((rule) => ({
    name: rule.name,
    trigger: rule.trigger,
    action: rule.action.type === 'reply'
      ? { type: 'reply', value: rule.action.value }
      : {
        type: 'webhook',
        method: rule.action.method,
        ...(rule.action.description ? { description: rule.action.description } : {}),
      },
  }));
}
