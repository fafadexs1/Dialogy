import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';

type OAuthStatePayload = {
  userId: string;
  workspaceId: string;
  issuedAt: number;
  nonce: string;
};

const MAX_STATE_AGE_MS = 10 * 60 * 1000;

function sign(encodedPayload: string, secret: string): string {
  return createHmac('sha256', secret).update(encodedPayload).digest('base64url');
}

export function createSignedOAuthState(
  payload: OAuthStatePayload,
  secret: string,
): string {
  if (!secret) throw new Error('OAuth state secret is not configured.');
  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${encodedPayload}.${sign(encodedPayload, secret)}`;
}

export function verifySignedOAuthState(
  state: string,
  secret: string,
  now: number = Date.now(),
): OAuthStatePayload | null {
  if (!state || !secret) return null;
  const [encodedPayload, providedSignature, extra] = state.split('.');
  if (!encodedPayload || !providedSignature || extra) return null;

  const expectedSignature = sign(encodedPayload, secret);
  const provided = Buffer.from(providedSignature);
  const expected = Buffer.from(expectedSignature);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as OAuthStatePayload;
    if (!parsed.userId || !parsed.workspaceId || !parsed.nonce || !Number.isFinite(parsed.issuedAt)) return null;
    if (parsed.issuedAt > now + 30_000 || now - parsed.issuedAt > MAX_STATE_AGE_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}
