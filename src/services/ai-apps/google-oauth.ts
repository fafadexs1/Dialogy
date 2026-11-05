import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { createSignedOAuthState, verifySignedOAuthState } from '@/lib/security/oauth-state';

export const GOOGLE_APPS = {
  calendar: { name: 'Google Agenda', origin: 'https://www.googleapis.com', read: ['https://www.googleapis.com/auth/calendar.events.readonly', 'https://www.googleapis.com/auth/calendar.events.freebusy'], write: ['https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/calendar.events.freebusy'] },
  gmail: { name: 'Gmail', origin: 'https://gmail.googleapis.com', read: ['https://www.googleapis.com/auth/gmail.readonly'], write: ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.send'] },
  tasks: { name: 'Google Tasks', origin: 'https://tasks.googleapis.com', read: ['https://www.googleapis.com/auth/tasks.readonly'], write: ['https://www.googleapis.com/auth/tasks'] },
  drive: { name: 'Google Drive', origin: 'https://www.googleapis.com', read: ['https://www.googleapis.com/auth/drive.readonly'], write: ['https://www.googleapis.com/auth/drive'] },
  docs: { name: 'Google Docs', origin: 'https://docs.googleapis.com', read: ['https://www.googleapis.com/auth/documents.readonly'], write: ['https://www.googleapis.com/auth/documents'] },
  sheets: { name: 'Google Sheets', origin: 'https://sheets.googleapis.com', read: ['https://www.googleapis.com/auth/spreadsheets.readonly'], write: ['https://www.googleapis.com/auth/spreadsheets'] },
  slides: { name: 'Google Slides', origin: 'https://slides.googleapis.com', read: ['https://www.googleapis.com/auth/presentations.readonly'], write: ['https://www.googleapis.com/auth/presentations'] },
} as const;
export type GoogleApp = keyof typeof GOOGLE_APPS;
export type GoogleAccess = 'read' | 'write';
export function googleApp(value: string | null): GoogleApp | null { return value && Object.hasOwn(GOOGLE_APPS, value) ? value as GoogleApp : null; }
export function googleAccess(value: string | null): GoogleAccess | null { return value === 'read' || value === 'write' ? value : null; }
export function googleOAuthConfig() {
  const clientId = process.env.GOOGLE_WORKSPACE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_WORKSPACE_CLIENT_SECRET?.trim();
  const origin = process.env.NEXTAUTH_URL?.trim();
  if (!clientId || !clientSecret || !origin) throw new Error('Configure GOOGLE_WORKSPACE_CLIENT_ID, GOOGLE_WORKSPACE_CLIENT_SECRET e NEXTAUTH_URL.');
  const parsed = new URL(origin);
  if ((parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['localhost','127.0.0.1'].includes(parsed.hostname))) || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) throw new Error('NEXTAUTH_URL deve ser uma origem HTTPS confiável.');
  return { clientId, clientSecret, origin: parsed.origin, redirectUri: `${parsed.origin}/api/integrations/google-workspace/callback` };
}
export function createGoogleAuthorization(input: { userId: string; workspaceId: string; app: GoogleApp; access: GoogleAccess; clientId: string; clientSecret: string; redirectUri: string }) {
  const verifier = randomBytes(32).toString('base64url');
  const state = createSignedOAuthState({ userId: input.userId, workspaceId: input.workspaceId, issuedAt: Date.now(), nonce: `${input.app}:${input.access}:${randomBytes(24).toString('base64url')}` }, input.clientSecret);
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  for (const [key,value] of Object.entries({ client_id: input.clientId, redirect_uri: input.redirectUri, response_type: 'code', access_type: 'offline', prompt: 'consent', scope: GOOGLE_APPS[input.app][input.access].join(' '), state, code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url') })) url.searchParams.set(key,value);
  return { url: url.toString(), state, verifier };
}
export function verifyGoogleAuthorization(state: string, cookieValue: string | undefined, secret: string) {
  if (!cookieValue || cookieValue.length > 6000 || state.length > 4000) return null;
  let cookie: { state?: unknown; verifier?: unknown };
  try { cookie = JSON.parse(Buffer.from(cookieValue, 'base64url').toString('utf8')); } catch { return null; }
  if (cookie.state !== state || typeof cookie.verifier !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(cookie.verifier)) return null;
  const payload = verifySignedOAuthState(state, secret);
  if (!payload) return null;
  const [appValue, accessValue, nonce, extra] = payload.nonce.split(':');
  const app = googleApp(appValue), access = googleAccess(accessValue);
  if (!app || !access || !nonce || extra || !/^[A-Za-z0-9_-]{32}$/.test(nonce)) return null;
  return { ...payload, app, access, verifier: cookie.verifier };
}
