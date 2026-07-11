import 'server-only';

import { createHmac, timingSafeEqual } from 'crypto';

const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

function readKeyRing(): Record<string, string> {
  const raw = process.env.DIALOGY_INTERNAL_HMAC_KEYS;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].length >= 32),
    );
  } catch {
    return {};
  }
}

export function currentDialogySigningKey() {
  const keyId = process.env.DIALOGY_INTERNAL_HMAC_CURRENT_KEY_ID;
  const secret = keyId ? readKeyRing()[keyId] : undefined;
  if (!keyId || !secret) throw new Error('Dialogy internal HMAC key ring is not configured');
  return { keyId, secret };
}

export function signDialogyRequest(secret: string, timestamp: string, deliveryId: string, rawBody: string): string {
  return createHmac('sha256', secret)
    .update(`${timestamp}.${deliveryId}.${rawBody}`, 'utf8')
    .digest('hex');
}

export function verifyDialogyRequest(input: {
  keyId: string;
  timestamp: string;
  deliveryId: string;
  rawBody: string;
  signature: string;
}) {
  const timestampMs = Date.parse(input.timestamp);
  if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > MAX_CLOCK_SKEW_MS) {
    return { ok: false as const, reason: 'expired_timestamp' };
  }
  const secret = readKeyRing()[input.keyId];
  if (!secret) return { ok: false as const, reason: 'unknown_key' };
  const expected = signDialogyRequest(secret, input.timestamp, input.deliveryId, input.rawBody);
  try {
    const valid = timingSafeEqual(Buffer.from(input.signature, 'hex'), Buffer.from(expected, 'hex'));
    return valid ? { ok: true as const } : { ok: false as const, reason: 'invalid_signature' };
  } catch {
    return { ok: false as const, reason: 'invalid_signature' };
  }
}
