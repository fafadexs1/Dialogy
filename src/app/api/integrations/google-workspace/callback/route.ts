import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentUser } from '@/actions/user';
import { hasWorkspacePermission } from '@/lib/workspace-permissions';
import { saveNexusCredential } from '@/modules/nexus/services/credentials';
import { requestPublicHttps } from '@/modules/nexus/services/public-http';
import { GOOGLE_APPS, googleOAuthConfig, verifyGoogleAuthorization } from '@/services/ai-apps/google-oauth';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  let origin: string;
  try { origin = googleOAuthConfig().origin; } catch { return NextResponse.json({ error: 'Autorização Google não configurada.' }, { status: 503 }); }
  const redirect = (status: string) => { const url = new URL('/integrations/ai-apps', origin); url.searchParams.set('google', status); const response = NextResponse.redirect(url); response.cookies.set('dialogy_google_oauth', '', { httpOnly: true, sameSite: 'lax', secure: origin.startsWith('https:'), path: '/api/integrations/google-workspace/callback', maxAge: 0 }); response.headers.set('Cache-Control', 'no-store'); return response; };
  const code = request.nextUrl.searchParams.get('code'), state = request.nextUrl.searchParams.get('state');
  if (request.nextUrl.searchParams.has('error')) return redirect('cancelado');
  if (!code || code.length > 4096 || !state) return redirect('invalido');
  const config = googleOAuthConfig();
  const verified = verifyGoogleAuthorization(state, request.cookies.get('dialogy_google_oauth')?.value, config.clientSecret);
  if (!verified) return redirect('invalido');
  const user = await getCurrentUser();
  if (!user || user.id !== verified.userId || user.activeWorkspaceId !== verified.workspaceId || !await hasWorkspacePermission(user.id, verified.workspaceId, 'workspace:settings:edit')) return redirect('sem_permissao');
  try {
    const response = await requestPublicHttps({ url: 'https://oauth2.googleapis.com/token', method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, code, code_verifier: verified.verifier, grant_type: 'authorization_code', redirect_uri: config.redirectUri }).toString(), timeoutMs: 15000, maxResponseBytes: 64000, signal: AbortSignal.timeout(15000) });
    const data = JSON.parse(response.body.toString('utf8')) as Record<string, unknown>;
    const required = GOOGLE_APPS[verified.app][verified.access];
    const granted = typeof data.scope === 'string' ? data.scope.split(/\s+/) : [];
    if (typeof data.refresh_token !== 'string' || !data.refresh_token || data.refresh_token.length > 10000 || !required.every(scope => granted.includes(scope))) return redirect('escopo_ou_token_ausente');
    await saveNexusCredential({ workspaceId: verified.workspaceId, userId: user.id, name: `${GOOGLE_APPS[verified.app].name} · ${verified.access === 'read' ? 'leitura' : 'leitura e escrita'}`, type: 'oauth2',
      payload: { tokenUrl: 'https://oauth2.googleapis.com/token', allowedOrigin: GOOGLE_APPS[verified.app].origin, clientId: config.clientId, clientSecret: config.clientSecret, refreshToken: data.refresh_token, grantType: 'refresh_token' },
      metadata: { kind: 'agent_http', provider: 'google_workspace', app: verified.app, access: verified.access, baseUrl: GOOGLE_APPS[verified.app].origin, authType: 'oauth2' }, });
    return redirect('conectado');
  } catch { return redirect('falha'); }
}
