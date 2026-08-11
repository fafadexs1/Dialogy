import { NextResponse } from 'next/server';

import { db } from '@/lib/db';
import { verifySignedOAuthState } from '@/lib/security/oauth-state';
import { ensureWorkspaceIntegrationsTable } from '@/lib/workspace-integrations';
import { encryptGoogleAdsSecret } from '@/services/google-ads/credentials';

export const dynamic = 'force-dynamic';

function redirectToIntegration(request: Request, params: Record<string, string>) {
  const target = new URL('/integrations/gads', process.env.NEXTAUTH_URL || request.url);
  for (const [key, value] of Object.entries(params)) {
    target.searchParams.set(key, value);
  }
  return NextResponse.redirect(target.toString());
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const oauthError = url.searchParams.get('error');

  if (oauthError) {
    return redirectToIntegration(request, { gads_error: oauthError });
  }

  const clientId = process.env.GOOGLE_ADS_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    return redirectToIntegration(request, { gads_error: 'oauth_nao_configurado' });
  }

  if (!code || !state) {
    return redirectToIntegration(request, { gads_error: 'resposta_incompleta' });
  }

  const payload = verifySignedOAuthState(state, clientSecret);
  if (!payload) {
    return redirectToIntegration(request, { gads_error: 'state_invalido' });
  }

  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: `${process.env.NEXTAUTH_URL}/api/integrations/google-ads/callback`,
    }),
  });

  const tokenPayload = await tokenResponse.json().catch(() => ({}));
  const refreshToken = typeof tokenPayload.refresh_token === 'string' ? tokenPayload.refresh_token : '';

  if (!tokenResponse.ok || !refreshToken) {
    console.error('[GADS_OAUTH] Troca de code falhou:', tokenResponse.status, tokenPayload?.error);
    return redirectToIntegration(request, { gads_error: 'token_nao_emitido' });
  }

  try {
    await ensureWorkspaceIntegrationsTable();
    // Mescla no config existente para nao apagar destinos e acoes ja configurados.
    await db.query(
      `
      INSERT INTO workspace_integrations (workspace_id, provider, config, is_active, updated_at)
      VALUES ($1, 'gads', jsonb_build_object('refreshToken', $2::text), true, timezone('utc', now()))
      ON CONFLICT (workspace_id, provider)
      DO UPDATE SET config = COALESCE(workspace_integrations.config, '{}'::jsonb)
                               || jsonb_build_object('refreshToken', $2::text),
                    is_active = true,
                    updated_at = timezone('utc', now())
      `,
      [payload.workspaceId, encryptGoogleAdsSecret(refreshToken)]
    );
  } catch (error) {
    console.error('[GADS_OAUTH] Falha ao gravar credencial:', error);
    return redirectToIntegration(request, { gads_error: 'falha_ao_salvar' });
  }

  return redirectToIntegration(request, { gads_connected: '1' });
}
