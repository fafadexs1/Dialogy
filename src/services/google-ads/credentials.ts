import { createHash } from 'crypto';

import { decryptWithKey, encryptWithKey, looksEncrypted } from '@/lib/security/secret-box';

const GOOGLE_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DEDICATED_ENV = 'GOOGLE_ADS_SECRET_ENCRYPTION_KEY';
const FALLBACK_ENV = 'META_PAYLOAD_ENCRYPTION_KEY';

export type GoogleAdsCredentials = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  developerToken: string;
  apiVersion: string;
};

/**
 * Chave dedicada quando existir; senao cai na chave de integracao ja provisionada,
 * para que a criptografia entre em vigor sem exigir nova variavel de ambiente.
 */
function encryptionSecret(): { secret: string | undefined; envName: string } {
  const dedicated = process.env[DEDICATED_ENV]?.trim();
  if (dedicated) return { secret: dedicated, envName: DEDICATED_ENV };
  return { secret: process.env[FALLBACK_ENV], envName: FALLBACK_ENV };
}

export function encryptGoogleAdsSecret(plaintext: string): string {
  const { secret, envName } = encryptionSecret();
  return encryptWithKey(plaintext, secret, envName);
}

/**
 * Le um segredo do config do workspace. Valores gravados antes da criptografia
 * ficaram em texto puro e continuam sendo aceitos ate serem regravados.
 */
export function readGoogleAdsSecret(stored: unknown): string {
  const value = String(stored ?? '').trim();
  if (!value) return '';
  if (!looksEncrypted(value)) return value;

  const { secret, envName } = encryptionSecret();
  return decryptWithKey(value, secret, envName);
}

export function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Variavel de ambiente obrigatoria ausente: ${name}`);
  return value;
}

export function resolveGoogleAdsCredentials(
  gadsConfig: Record<string, unknown> | null | undefined,
  workspaceId: string
): GoogleAdsCredentials {
  const refreshToken = readGoogleAdsSecret(gadsConfig?.refreshToken);
  if (!refreshToken) {
    throw new Error(`Credencial Google Ads ausente no workspace ${workspaceId}: refreshToken.`);
  }

  return {
    clientId: requiredEnv('GOOGLE_ADS_CLIENT_ID'),
    clientSecret: requiredEnv('GOOGLE_ADS_CLIENT_SECRET'),
    refreshToken,
    developerToken: requiredEnv('GOOGLE_ADS_DEVELOPER_TOKEN'),
    apiVersion: process.env.GOOGLE_ADS_API_VERSION?.trim() || 'v24',
  };
}

type CachedToken = { accessToken: string; expiresAt: number };

const accessTokenCache = new Map<string, CachedToken>();

function tokenCacheKey(credentials: GoogleAdsCredentials): string {
  return createHash('sha256')
    .update(`${credentials.clientId}:${credentials.clientSecret}:${credentials.refreshToken}`)
    .digest('hex');
}

/**
 * O access token do Google vale ~1h. Cachear com margem evita um round-trip de
 * OAuth por conversao quando a fila drena varios itens do mesmo workspace.
 */
export async function getGoogleAccessToken(credentials: GoogleAdsCredentials): Promise<string> {
  const cacheKey = tokenCacheKey(credentials);
  const cached = accessTokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.accessToken;
  }

  const response = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      refresh_token: credentials.refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || typeof payload.access_token !== 'string') {
    // Nunca ecoar o corpo inteiro: ele pode devolver o refresh token enviado.
    throw new Error(
      `Falha ao obter access token Google Ads (${response.status}): ${String(payload.error || 'desconhecido')}`
    );
  }

  const expiresInSeconds = Number(payload.expires_in) || 3600;
  accessTokenCache.set(cacheKey, {
    accessToken: payload.access_token,
    expiresAt: Date.now() + Math.max(60, expiresInSeconds - 120) * 1000,
  });

  return payload.access_token;
}

export function clearGoogleAdsTokenCache(): void {
  accessTokenCache.clear();
}

export function normalizeGoogleAdsCustomerId(value: string | null | undefined): string | null {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits || null;
}
