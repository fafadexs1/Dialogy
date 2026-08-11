import { randomUUID } from 'node:crypto';

import { NextResponse } from 'next/server';

import { getCurrentUser } from '@/actions/user';
import { createSignedOAuthState } from '@/lib/security/oauth-state';
import { hasWorkspacePermission } from '@/lib/workspace-permissions';

export const dynamic = 'force-dynamic';

const GOOGLE_ADS_SCOPE = 'https://www.googleapis.com/auth/adwords';

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  const clientId = process.env.GOOGLE_ADS_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    return NextResponse.json({ error: 'Google Ads OAuth nao configurado no servidor.' }, { status: 500 });
  }

  const workspaceId = user.activeWorkspaceId;
  if (!workspaceId || !await hasWorkspacePermission(user.id, workspaceId, 'workspace:settings:edit')) {
    return NextResponse.json({ error: 'Acesso negado ao workspace.' }, { status: 403 });
  }

  const redirectUri = `${process.env.NEXTAUTH_URL}/api/integrations/google-ads/callback`;
  const state = createSignedOAuthState(
    { userId: user.id, workspaceId, issuedAt: Date.now(), nonce: randomUUID() },
    clientSecret
  );

  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', GOOGLE_ADS_SCOPE);
  // offline + consent sao obrigatorios: sem os dois o Google devolve apenas um
  // access token de uma hora e nunca o refresh token de que o worker precisa.
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('prompt', 'consent');
  authUrl.searchParams.set('include_granted_scopes', 'true');
  authUrl.searchParams.set('state', state);

  return NextResponse.redirect(authUrl.toString());
}
