import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { getCurrentUser } from '@/actions/user';
import { createSignedOAuthState } from '@/lib/security/oauth-state';
import { hasWorkspacePermission } from '@/lib/workspace-permissions';

export async function GET(request: Request) {
    const user = await getCurrentUser();

    if (!user) {
        return NextResponse.redirect(new URL('/login', request.url));
    }

    const appId = process.env.MERCADOLIVRE_APP_ID;
    const clientSecret = process.env.MERCADOLIVRE_CLIENT_SECRET;
    const redirectUri = `${process.env.NEXTAUTH_URL}/api/integrations/mercadolivre/callback`;

    if (!appId || !clientSecret) {
        return NextResponse.json({ error: 'Mercado Livre OAuth is not configured' }, { status: 500 });
    }

    const workspaceId = user.activeWorkspaceId;
    if (!workspaceId || !await hasWorkspacePermission(user.id, workspaceId, 'workspace:settings:edit')) {
        return NextResponse.json({ error: 'Workspace access denied' }, { status: 403 });
    }

    const state = createSignedOAuthState({
        userId: user.id,
        workspaceId,
        issuedAt: Date.now(),
        nonce: randomUUID(),
    }, clientSecret);

    const authUrl = `https://auth.mercadolivre.com.br/authorization?response_type=code&client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`;

    return NextResponse.redirect(authUrl);
}
