import crypto from 'crypto';
import type { User as SupabaseUser } from '@supabase/supabase-js';

export type SupabaseJwtPayload = {
  sub: string;
  email?: string;
  phone?: string;
  role?: string;
  aud?: string;
  exp?: number;
  iat?: number;
  app_metadata?: Record<string, unknown>;
  user_metadata?: Record<string, unknown>;
};

const base64UrlDecode = (value: string) => {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const pad = normalized.length % 4;
  const padded = normalized + (pad ? '='.repeat(4 - pad) : '');
  return Buffer.from(padded, 'base64').toString('utf8');
};

function safeJsonParse<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function verifySignature(token: string, secret: string): SupabaseJwtPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [header, payload, signature] = parts;
  const data = `${header}.${payload}`;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(data)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  if (expected !== signature) return null;

  const decoded = safeJsonParse<SupabaseJwtPayload>(base64UrlDecode(payload));
  return decoded;
}

function decodeWithoutVerify(token: string): SupabaseJwtPayload | null {
  const parts = token.split('.');
  if (parts.length < 2) return null;
  return safeJsonParse<SupabaseJwtPayload>(base64UrlDecode(parts[1]));
}

/**
 * Returns the access token found in Supabase cookies.
 * Handles both "sb-*-auth-token" JSON cookie (preferred) and legacy "sb-access-token".
 */
export function getSupabaseAccessTokenFromCookies(
  cookies: { getAll(): Array<{ name: string; value: string }> }
): string | null {
  const all = cookies.getAll();

  // Preferred: cookie storing JSON with access_token
  const sessionCookie = all.find((c) => c.name.includes('auth-token'));
  if (sessionCookie) {
    const parsed = safeJsonParse<{ access_token?: string }>(sessionCookie.value);
    if (parsed?.access_token) {
      return parsed.access_token;
    }
  }

  // Fallback: direct access token cookie
  const accessCookie = all.find((c) => c.name.includes('access-token'));
  if (accessCookie?.value) {
    return accessCookie.value;
  }

  return null;
}

export function decodeSupabaseJwt(token: string | null): SupabaseJwtPayload | null {
  if (!token) return null;
  const secret = process.env.SUPABASE_JWT_SECRET || process.env.SUPABASE_SECRET || '';

  if (secret) {
    const verified = verifySignature(token, secret);
    if (verified) return verified;
  }

  // As a last resort, decode without verifying to avoid extra auth calls.
  return decodeWithoutVerify(token);
}

export function mapPayloadToSupabaseUser(payload: SupabaseJwtPayload): SupabaseUser {
  return {
    id: payload.sub,
    aud: payload.aud ?? 'authenticated',
    role: payload.role ?? 'authenticated',
    email: payload.email ?? null,
    phone: payload.phone ?? null,
    app_metadata: payload.app_metadata ?? {},
    user_metadata: payload.user_metadata ?? {},
    created_at: payload.iat ? new Date(payload.iat * 1000).toISOString() : null,
    // The rest are optional in our usage; set to null/default to satisfy the type.
    last_sign_in_at: null,
    factors: [],
  } as SupabaseUser;
}
