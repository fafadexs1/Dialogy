import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { createSignedOAuthState, verifySignedOAuthState } from '@/lib/security/oauth-state';
export type AppProvider = 'github' | 'notion';
export type AppAccess = 'read' | 'write';
export function appProvider(value: string): AppProvider | null { return value === 'github' || value === 'notion' ? value : null; }
export function appAccess(value: string | null): AppAccess | null { return value === 'read' || value === 'write' ? value : null; }
export function appOAuthConfig(provider: AppProvider) {
  const clientId = (provider === 'github' ? process.env.GITHUB_APPS_CLIENT_ID : process.env.NOTION_CLIENT_ID)?.trim();
  const clientSecret = (provider === 'github' ? process.env.GITHUB_APPS_CLIENT_SECRET : process.env.NOTION_CLIENT_SECRET)?.trim();
  const origin = new URL(process.env.NEXTAUTH_URL || '');
  if (!clientId || !clientSecret || (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && ['localhost','127.0.0.1'].includes(origin.hostname))) || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('OAuth não configurado.');
  return { clientId, clientSecret, origin: origin.origin, redirectUri: `${origin.origin}/api/integrations/app-oauth/${provider}/callback` };
}
export function createAppAuthorization(input: { userId: string; workspaceId: string; provider: AppProvider; access: AppAccess; clientId: string; clientSecret: string; redirectUri: string }) {
  const verifier = randomBytes(32).toString('base64url');
  const state = createSignedOAuthState({userId: input.userId, workspaceId: input.workspaceId, issuedAt: Date.now(), nonce: `${input.provider}:${input.access}:${randomBytes(24).toString('base64url')}`}, input.clientSecret);
  const url = new URL(input.provider === 'github' ? 'https://github.com/login/oauth/authorize' : 'https://api.notion.com/v1/oauth/authorize');
  for (const [key,value] of Object.entries({client_id:input.clientId,redirect_uri:input.redirectUri,response_type:'code',state})) url.searchParams.set(key,value);
  if (input.provider === 'github') { url.searchParams.set('scope','repo'); url.searchParams.set('code_challenge_method','S256'); url.searchParams.set('code_challenge',createHash('sha256').update(verifier).digest('base64url')); }
  else url.searchParams.set('owner','user');
  return {url:url.toString(),state,verifier};
}
export function verifyAppAuthorization(state:string,cookieValue:string|undefined,secret:string,expected:AppProvider) {
  if (!cookieValue || cookieValue.length > 6000 || state.length > 4000) return null;
  let cookie:{state?:unknown;verifier?:unknown}; try {cookie=JSON.parse(Buffer.from(cookieValue,'base64url').toString('utf8'));} catch {return null;}
  if (cookie.state !== state || typeof cookie.verifier !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(cookie.verifier)) return null;
  const payload=verifySignedOAuthState(state,secret); if(!payload) return null;
  const [provider,accessValue,nonce,extra]=payload.nonce.split(':'); const access=appAccess(accessValue);
  if(provider!==expected || !access || !nonce || extra || !/^[A-Za-z0-9_-]{32}$/.test(nonce)) return null;
  return {...payload,provider:expected,access,verifier:cookie.verifier};
}
