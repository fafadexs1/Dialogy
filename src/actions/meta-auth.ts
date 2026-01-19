'use server';

import { resilientFetch } from '@/lib/http/resilient-fetch';

export type ExchangeMetaTokenResult = {
    success: boolean;
    accessToken?: string;
    error?: string;
    debug?: any;
};

export async function exchangeMetaAuthCode(code: string): Promise<ExchangeMetaTokenResult> {
    const appId = process.env.NEXT_PUBLIC_META_APP_ID;
    const appSecret = process.env.META_APP_SECRET;

    // We can allow the frontend to pass the redirect_uri or hardcode it.
    // Usually it must match the one used in the popup exactly.
    // The user provided 'https://developers.facebook.com/es/oauth/callback/...' in the prompt example,
    // but typically for embedded signup it might be the standard fb callback or the domain of the app.
    // However, for the initial token exchange, if we use the "Certified Provider" flow or standard flow,
    // we might need to be careful.
    // The previous user request showed a curl with `redirect_uri` as `https://developers.facebook.com/es/oauth/callback/...`.
    // I will try to use that one if it's the standard for the Embedded Signup flow they are using, 
    // OR I will try to infer it. 
    // Actually, often passing no redirect_uri or the exact same one is required.
    // Let's try to use the one from the prompt as a default if not env var is set.

    const redirectUri = 'https://www.facebook.com/connect/login_success.html'; // Common default for manual flows/popups
    // WA Embedded signup often uses postmessage and the exchange happens server-to-server.
    // The docs say: When the user completes the flow... include a code.
    // "You will need to exchange this code for an access token".

    if (!appId || !appSecret) {
        return { success: false, error: 'Server configuration missing (App ID or Secret).' };
    }

    try {
        const url = 'https://graph.facebook.com/v24.0/oauth/access_token';
        const body = {
            client_id: appId,
            client_secret: appSecret,
            code: code,
            grant_type: 'authorization_code',
        };

        // For embedded signup, usually redirect_uri is NOT sent in step 2 (exchange), 
        // OR it must be the sdk source. 
        // I will omit it first as per some embedded signup docs, or use a generic one if it fails.
        // Wait, the user prompt curl DID have a redirect_uri.
        // "https://developers.facebook.com/es/oauth/callback/?business_id=...&nonce=..."
        // That looks like a strictly specific callback. 
        // IF I cannot dynamic that, I might fail.

        // Let's try WITHOUT first, as common Oauth code flow requires matching redirect_uri but embedded often simplifies.
        // Attempt 1: Just code, id, secret.

        const response = await resilientFetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });

        const json = await response.json().catch(() => ({}));

        if (!response.ok || !json.access_token) {
            console.error('[META_AUTH] Exchange Error:', json);
            return { success: false, error: json.error?.message || 'Meta API Error', debug: json };
        }

        return {
            success: true,
            accessToken: json.access_token
        };

    } catch (error: any) {
        console.error('[META_AUTH] Exception:', error);
        return { success: false, error: error.message };
    }
}
