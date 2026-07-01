import { createHash, createHmac } from 'node:crypto';

import type { AgentToolAction } from './types';

function stableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableJsonValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, stableJsonValue(nested)]),
  );
}

export function fingerprintToolAction(action: AgentToolAction) {
  return createHash('sha256')
    .update(JSON.stringify(stableJsonValue(action)))
    .digest('hex');
}

export function fingerprintToolOperation(action: AgentToolAction) {
  return createHash('sha256')
    .update(JSON.stringify(stableJsonValue({
      type: action.type,
      payload: action.payload || {},
    })))
    .digest('hex');
}

export function fingerprintAuditedToolOperation(action: AgentToolAction) {
  const secret = String(
    process.env.DIALOGY_INTERNAL_SECRET
    || process.env.SUPABASE_JWT_SECRET
    || 'dialogy-local-audit-fingerprint',
  );
  return createHmac('sha256', secret)
    .update(JSON.stringify(stableJsonValue({
      type: action.type,
      payload: action.payload || {},
    })))
    .digest('hex');
}
