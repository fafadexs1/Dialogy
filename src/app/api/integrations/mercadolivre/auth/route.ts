import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/actions/user';

export async function GET(request: Request) {
    const user = await getCurrentUser();

    if (!user) {
        return NextResponse.redirect(new URL('/login', request.url));
    }

    const appId = process.env.MERCADOLIVRE_APP_ID;
    const redirectUri = `${process.env.NEXTAUTH_URL}/api/integrations/mercadolivre/callback`;

    if (!appId) {
        return NextResponse.json({ error: 'MERCADOLIVRE_APP_ID not configured' }, { status: 500 });
    }

    // State can be used to pass workspace ID securely, or we rely on session in callback
    const state = user.activeWorkspaceId;

    const authUrl = `https://auth.mercadolivre.com.br/authorization?response_type=code&client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`;

    return NextResponse.redirect(authUrl);
}
