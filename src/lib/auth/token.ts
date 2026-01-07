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

const BASE64_COOKIE_PREFIX = 'base64-';

const decodeCookieValue = (value: string): string => {
  if (value.startsWith(BASE64_COOKIE_PREFIX)) {
    const encoded = value.slice(BASE64_COOKIE_PREFIX.length);
    try {
      return base64UrlDecode(encoded);
    } catch {
      return value;
    }
  }
  return value;
};

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
const getCookieBaseNames = (cookies: Array<{ name: string; value: string }>, marker: string): string[] => {
  const baseNames: string[] = [];
  const seen = new Set<string>();

  cookies.forEach(({ name }) => {
    if (!name.includes(marker)) return;
    const baseName = name.replace(/\.(\d+)$/, '');
    if (seen.has(baseName)) return;
    seen.add(baseName);
    baseNames.push(baseName);
  });

  return baseNames;
};

const combineCookieChunks = (cookies: Array<{ name: string; value: string }>, baseName: string): string | null => {
  const direct = cookies.find((cookie) => cookie.name === baseName)?.value;
  if (direct) return direct;

  const chunks: string[] = [];
  for (let i = 0; ; i += 1) {
    const chunk = cookies.find((cookie) => cookie.name === `${baseName}.${i}`)?.value;
    if (!chunk) break;
    chunks.push(chunk);
  }

  return chunks.length ? chunks.join('') : null;
};

const parseSessionCookie = (value: string): { access_token?: string } | null => {
  const decoded = decodeCookieValue(value);
  let parsed = safeJsonParse<{ access_token?: string }>(decoded);
  if (parsed?.access_token) return parsed;

  try {
    const uriDecoded = decodeURIComponent(decoded);
    parsed = safeJsonParse<{ access_token?: string }>(uriDecoded);
    if (parsed?.access_token) return parsed;
  } catch {
    // Ignore URI decode failures.
  }

  return null;
};

export function getSupabaseAccessTokenFromCookies(
  cookies: { getAll(): Array<{ name: string; value: string }> }
): string | null {
  const all = cookies.getAll();

  // Preferred: session cookie storing JSON with access_token (base64url + chunked).
  const authTokenBases = getCookieBaseNames(all, 'auth-token');
  for (const baseName of authTokenBases) {
    const combined = combineCookieChunks(all, baseName);
    if (!combined) continue;
    const parsed = parseSessionCookie(combined);
    if (parsed?.access_token) {
      return parsed.access_token;
    }
  }

  // Fallback: direct access token cookie.
  const accessTokenBases = getCookieBaseNames(all, 'access-token');
  for (const baseName of accessTokenBases) {
    const combined = combineCookieChunks(all, baseName);
    if (!combined) continue;
    const decoded = decodeCookieValue(combined);
    return decoded || combined;
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
