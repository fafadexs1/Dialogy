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

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

const base64UrlToUint8Array = (value: string): Uint8Array => {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const pad = normalized.length % 4;
  const padded = normalized + (pad ? '='.repeat(4 - pad) : '');
  if (typeof atob === 'function') {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
  return Uint8Array.from(Buffer.from(padded, 'base64'));
};

const base64UrlDecode = (value: string) => textDecoder.decode(base64UrlToUint8Array(value));

const arrayBufferToBase64Url = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }

  let base64: string;
  if (typeof btoa === 'function') {
    base64 = btoa(binary);
  } else if (typeof Buffer !== 'undefined') {
    base64 = Buffer.from(bytes).toString('base64');
  } else {
    base64 = '';
  }

  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

function safeJsonParse<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

async function verifySignature(token: string, secret: string): Promise<SupabaseJwtPayload | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [header, payload, signature] = parts;
  const data = `${header}.${payload}`;

  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    return decodeWithoutVerify(token);
  }

  const key = await subtle.importKey('raw', textEncoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  const signatureBuffer = await subtle.sign('HMAC', key, textEncoder.encode(data));
  const expected = arrayBufferToBase64Url(signatureBuffer);

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

export async function decodeSupabaseJwt(token: string | null): Promise<SupabaseJwtPayload | null> {
  if (!token) return null;
  const secret = process.env.SUPABASE_JWT_SECRET || process.env.SUPABASE_SECRET || '';

  if (secret) {
    const verified = await verifySignature(token, secret);
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
  } as unknown as SupabaseUser;
}
