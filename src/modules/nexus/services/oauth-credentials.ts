import 'server-only';
import { z } from 'zod';
import { db } from '@/lib/db';
import { decryptPayload, encryptPayload } from './credentials';
import { requestPublicHttps } from './public-http';

export const OAuthCredentialSchema = z.object({
  provider: z.enum(['generic', 'notion']).default('generic'),
  tokenUrl: z.string().url().refine((url) => new URL(url).protocol === 'https:', 'Use HTTPS.'),
  allowedOrigin: z.string().url().refine((url) => new URL(url).origin === url && new URL(url).protocol === 'https:', 'Informe a origem HTTPS sem caminho.'),
  clientId: z.string().min(1).max(2000),
  clientSecret: z.string().min(1).max(10000),
  refreshToken: z.string().max(10000).optional(),
  grantType: z.enum(['refresh_token', 'client_credentials']).default('refresh_token'),
  scope: z.string().max(2000).optional(),
  accessToken: z.string().max(16000).optional(),
  expiresAt: z.number().optional(),
}).superRefine((value, ctx) => { if (value.grantType === 'refresh_token' && !value.refreshToken) ctx.addIssue({ code: 'custom', path: ['refreshToken'], message: 'Informe o refresh token.' }); if (value.provider === 'notion' && (value.tokenUrl !== 'https://api.notion.com/v1/oauth/token' || value.allowedOrigin !== 'https://api.notion.com' || value.grantType !== 'refresh_token')) ctx.addIssue({ code: 'custom', message: 'Configuração Notion inválida.' }); });

export async function resolveNexusOAuthToken(workspaceId: string, credentialId: string, origin: string, signal: AbortSignal): Promise<string> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '20s'");
    const { rows } = await client.query(`SELECT encrypted_payload FROM nexus_credentials WHERE workspace_id=$1 AND id=$2 AND credential_type='oauth2' FOR UPDATE`, [workspaceId, credentialId]);
    if (!rows[0]) throw new Error('Credencial OAuth2 indisponível neste workspace.');
    const payload = OAuthCredentialSchema.parse(decryptPayload(String(rows[0].encrypted_payload)));
    if (payload.allowedOrigin !== origin) throw new Error('Esta credencial OAuth2 não autoriza a origem solicitada.');
    if (payload.accessToken && (payload.expiresAt || 0) > Date.now() + 60000) {
      await client.query('COMMIT');
      return payload.accessToken;
    }
    const parameters = new URLSearchParams({ grant_type: payload.grantType, client_id: payload.clientId, client_secret: payload.clientSecret });
    if (payload.grantType === 'refresh_token') parameters.set('refresh_token', payload.refreshToken!);
    if (payload.scope) parameters.set('scope', payload.scope);
    const notion = payload.provider === 'notion';
    const headers: Record<string, string> = notion ? { 'Content-Type': 'application/json', 'Notion-Version': '2025-09-03', Authorization: `Basic ${Buffer.from(`${payload.clientId}:${payload.clientSecret}`).toString('base64')}` } : { 'Content-Type': 'application/x-www-form-urlencoded' };
    const body = notion ? JSON.stringify({ grant_type: 'refresh_token', refresh_token: payload.refreshToken }) : parameters.toString();
    const response = await requestPublicHttps({ url: payload.tokenUrl, method: 'POST', headers, body, timeoutMs: 15000, maxResponseBytes: 64000, signal });
    const token = z.object({ access_token: z.string().min(1).max(16000).refine((value) => !/[\r\n]/.test(value)), expires_in: z.coerce.number().positive().max(31536000).optional(), refresh_token: z.string().min(1).max(10000).optional(), token_type: z.string().optional() }).parse(JSON.parse(response.body.toString('utf8')));
    if ((!notion && !token.expires_in) || (notion && !token.refresh_token)) throw new Error('Resposta de token incompleta.');
    if (token.token_type && token.token_type.toLowerCase() !== 'bearer') throw new Error('O provedor retornou um tipo de token incompatível.');
    const next = { ...payload, accessToken: token.access_token, expiresAt: Date.now() + (token.expires_in || 3600) * 1000, ...(token.refresh_token ? { refreshToken: token.refresh_token } : {}) };
    await client.query(`UPDATE nexus_credentials SET encrypted_payload=$3,updated_at=clock_timestamp() WHERE workspace_id=$1 AND id=$2`, [workspaceId, credentialId, encryptPayload(next)]);
    await client.query('COMMIT');
    return token.access_token;
  } catch (error) {
    await client.query('ROLLBACK');
    // No token response, submitted secret, or Zod input is surfaced to events.
    throw new Error(error instanceof Error && error.message.includes('origem') ? error.message : 'Não foi possível renovar a credencial OAuth2. Revise a configuração.');
  } finally { client.release(); }
}
