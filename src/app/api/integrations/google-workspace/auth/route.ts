import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentUser } from '@/actions/user';
import { hasWorkspacePermission } from '@/lib/workspace-permissions';
import { createGoogleAuthorization, googleAccess, googleApp, googleOAuthConfig } from '@/services/ai-apps/google-oauth';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user?.activeWorkspaceId) return NextResponse.json({ error: 'Usuário não autenticado no workspace.' }, { status: 401 });
  if (!await hasWorkspacePermission(user.id, user.activeWorkspaceId, 'workspace:settings:edit')) return NextResponse.json({ error: 'Acesso negado ao workspace.' }, { status: 403 });
  const app = googleApp(request.nextUrl.searchParams.get('app')), access = googleAccess(request.nextUrl.searchParams.get('access'));
  if (!app || !access) return NextResponse.json({ error: 'Selecione um aplicativo e nível de acesso válidos.' }, { status: 400 });
  try {
    const config = googleOAuthConfig();
    const authorization = createGoogleAuthorization({ ...config, userId: user.id, workspaceId: user.activeWorkspaceId, app, access });
    const response = NextResponse.redirect(authorization.url);
    response.cookies.set('dialogy_google_oauth', Buffer.from(JSON.stringify({ state: authorization.state, verifier: authorization.verifier })).toString('base64url'), { httpOnly: true, secure: config.origin.startsWith('https:'), sameSite: 'lax', path: '/api/integrations/google-workspace/callback', maxAge: 600 });
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch { return NextResponse.json({ error: 'Autorização Google não configurada no servidor.' }, { status: 503 }); }
}
