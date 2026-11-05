import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { createClient } from '@/lib/supabase/server';
import { verifySignedOAuthState } from '@/lib/security/oauth-state';
import { hasWorkspacePermission } from '@/lib/workspace-permissions';

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const error = searchParams.get('error');

    if (error) {
        return NextResponse.json({ error: `Mercado Livre Error: ${error}` }, { status: 400 });
    }

    if (!code || !state) {
        return NextResponse.json({ error: 'Missing code or state' }, { status: 400 });
    }

    const appId = process.env.MERCADOLIVRE_APP_ID;
    const clientSecret = process.env.MERCADOLIVRE_CLIENT_SECRET;
    const redirectUri = `${process.env.NEXTAUTH_URL}/api/integrations/mercadolivre/callback`;

    if (!clientSecret) {
        return NextResponse.json({ error: 'Mercado Livre OAuth is not configured' }, { status: 500 });
    }

    const statePayload = verifySignedOAuthState(state, clientSecret);
    if (!statePayload) {
        return NextResponse.json({ error: 'Invalid or expired OAuth state' }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || user.id !== statePayload.userId) {
        return NextResponse.json({ error: 'OAuth session mismatch' }, { status: 403 });
    }
    if (!await hasWorkspacePermission(user.id, statePayload.workspaceId, 'workspace:settings:edit')) {
        return NextResponse.json({ error: 'Workspace access denied' }, { status: 403 });
    }
    const workspaceId = statePayload.workspaceId;

    try {
        // 1. Exchange code for token
        const tokenRes = await fetch('https://api.mercadolibre.com/oauth/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                client_id: appId!,
                client_secret: clientSecret!,
                code,
                redirect_uri: redirectUri,
            }),
        });

        const tokenData = await tokenRes.json();

        if (!tokenRes.ok) {
            console.error('ML Token Exchange Error:', tokenData);
            return NextResponse.json({ error: 'Failed to exchange token', details: tokenData }, { status: 500 });
        }

        const { access_token, refresh_token, expires_in, user_id } = tokenData;
        const expiresAt = new Date(Date.now() + expires_in * 1000);

        // 2. Fetch User Info (Nickname)
        const userRes = await fetch(`https://api.mercadolibre.com/users/me`, {
            headers: { Authorization: `Bearer ${access_token}` }
        });

        const userData = await userRes.json();
        const nickname = userData.nickname || `Vendedor ${user_id}`;

        // 3. Save to DB
        // Upsert logic: if user_id exists for this workspace, update tokens
        const checkRes = await db.query(
            'SELECT id FROM mercadolivre_accounts WHERE user_id = $1 AND workspace_id = $2',
            [user_id, workspaceId]
        );

        if ((checkRes.rowCount ?? 0) > 0) {
            await db.query(
                'UPDATE mercadolivre_accounts SET access_token = $1, refresh_token = $2, expires_at = $3, nickname = $4, updated_at = now() WHERE id = $5',
                [access_token, refresh_token, expiresAt, nickname, checkRes.rows[0].id]
            );
        } else {
            await db.query(
                'INSERT INTO mercadolivre_accounts (workspace_id, nickname, user_id, access_token, refresh_token, expires_at) VALUES ($1, $2, $3, $4, $5, $6)',
                [workspaceId, nickname, user_id, access_token, refresh_token, expiresAt]
            );
        }

        // 4. Redirect back to settings
        return NextResponse.redirect(`${process.env.NEXTAUTH_URL}/integrations/mercadolivre?success=true`);

    } catch (err: any) {
        console.error('Callback Handler Error:', err);
        return NextResponse.json({ error: 'Internal Server Error', details: err.message }, { status: 500 });
    }
}
