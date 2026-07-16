'use server';

import { resilientFetch } from '@/lib/http/resilient-fetch';

const META_GRAPH_VERSION = 'v25.0';

function metaGraphUrl(path: string): string {
    return `https://graph.facebook.com/${META_GRAPH_VERSION}/${path.replace(/^\//, '')}`;
}

function metaAuthHeaders(accessToken: string): HeadersInit {
    return { Authorization: `Bearer ${accessToken}` };
}

export type ExchangeMetaTokenResult = {
    success: boolean;
    accessToken?: string;
    wabaId?: string;
    phoneNumberId?: string;
    // Extra metadata for user visibility
    metaInfo?: {
        businessName?: string;
        wabaName?: string;
        displayPhoneNumber?: string;
        verifiedName?: string;
    };
    error?: string;
    debug?: any;
};

/**
 * Fetches WABA and Phone Number IDs from Graph API using the access token.
 * This is used when the embedded signup postMessage doesn't provide these IDs.
 */
async function fetchPhoneForWaba(
    accessToken: string,
    wabaId: string
): Promise<{ wabaId: string; phoneNumberId?: string; metaInfo?: ExchangeMetaTokenResult['metaInfo'] }> {
    const phoneResponse = await resilientFetch(
        metaGraphUrl(`${encodeURIComponent(wabaId)}/phone_numbers?fields=id,display_phone_number,verified_name`),
        { headers: metaAuthHeaders(accessToken) }
    );
    const phoneData = await phoneResponse.json().catch(() => ({}));
    const phone = phoneData.data?.[0];
    return {
        wabaId,
        phoneNumberId: phone?.id,
        metaInfo: phone ? {
            displayPhoneNumber: phone.display_phone_number,
            verifiedName: phone.verified_name,
        } : undefined,
    };
}

async function fetchWabaInfo(
    accessToken: string,
    wabaIdHint?: string
): Promise<{ wabaId?: string; phoneNumberId?: string; metaInfo?: ExchangeMetaTokenResult['metaInfo'] }> {
    try {
        if (wabaIdHint) {
            return await fetchPhoneForWaba(accessToken, wabaIdHint);
        }

        // Step 1: Get shared WABA accounts
        const wabaResponse = await resilientFetch(
            metaGraphUrl('me/businesses?fields=id,name,owned_whatsapp_business_accounts{id,name,phone_numbers{id,display_phone_number,verified_name}}'),
            { headers: metaAuthHeaders(accessToken) }
        );
        const wabaData = await wabaResponse.json().catch(() => ({}));

        // Try to find WABA from business data
        if (wabaData.data && wabaData.data.length > 0) {
            for (const business of wabaData.data) {
                const wabaAccounts = business.owned_whatsapp_business_accounts?.data;
                if (wabaAccounts && wabaAccounts.length > 0) {
                    const waba = wabaAccounts[0];
                    const phoneNumbers = waba.phone_numbers?.data;

                    const metaInfo: ExchangeMetaTokenResult['metaInfo'] = {
                        businessName: business.name,
                        wabaName: waba.name,
                    };

                    if (phoneNumbers && phoneNumbers.length > 0) {
                        const phone = phoneNumbers[0];
                        return {
                            wabaId: waba.id,
                            phoneNumberId: phone.id,
                            metaInfo: {
                                ...metaInfo,
                                displayPhoneNumber: phone.display_phone_number,
                                verifiedName: phone.verified_name
                            }
                        };
                    }
                    // WABA found but no phone numbers yet
                    return { wabaId: waba.id, metaInfo };
                }
            }
        }

        // Alternative: Try direct WABA query
        const directResponse = await resilientFetch(
            metaGraphUrl('me?fields=id,name'),
            { headers: metaAuthHeaders(accessToken) }
        );
        await directResponse.json().catch(() => ({}));

        // Try to fetch WABAs associated with the token
        const sharedWabaResponse = await resilientFetch(
            metaGraphUrl(`debug_token?input_token=${encodeURIComponent(accessToken)}`),
            { headers: metaAuthHeaders(accessToken) }
        );
        const debugData = await sharedWabaResponse.json().catch(() => ({}));

        // Check granular scopes for WABA info
        const granularScopes = debugData.data?.granular_scopes || [];
        for (const scope of granularScopes) {
            if (scope.scope === 'whatsapp_business_management' && scope.target_ids?.length > 0) {
                const wabaId = scope.target_ids[0];
                return await fetchPhoneForWaba(accessToken, wabaId);
            }
        }

        return {};
    } catch (error) {
        console.error('[META_AUTH] Error fetching WABA info:', error);
        return {};
    }
}

async function subscribeWabaToApp(accessToken: string, wabaId: string): Promise<void> {
    const response = await resilientFetch(metaGraphUrl(`${encodeURIComponent(wabaId)}/subscribed_apps`), {
        method: 'POST',
        headers: metaAuthHeaders(accessToken),
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok || json.success !== true) {
        throw new Error(json.error?.message || 'Não foi possível assinar os webhooks da conta do WhatsApp.');
    }
}

export async function exchangeMetaAuthCode(code: string, wabaIdHint?: string): Promise<ExchangeMetaTokenResult> {
    const appId = process.env.NEXT_PUBLIC_FACEBOOK_APP_ID || process.env.NEXT_PUBLIC_META_APP_ID;
    const appSecret = process.env.FACEBOOK_APP_SECRET || process.env.META_APP_SECRET;

    if (!appId || !appSecret) {
        return { success: false, error: 'Server configuration missing (App ID or Secret).' };
    }

    try {
        const url = metaGraphUrl('oauth/access_token');
        const body = {
            client_id: appId,
            client_secret: appSecret,
            code: code,
            grant_type: 'authorization_code',
        };

        const response = await resilientFetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });

        const json = await response.json().catch(() => ({}));

        if (!response.ok || !json.access_token) {
            console.error('[META_AUTH] Exchange failed.', { code: json.error?.code, type: json.error?.type });
            return { success: false, error: json.error?.message || 'Meta API Error' };
        }

        // After getting the token, fetch WABA info
        const wabaInfo = await fetchWabaInfo(json.access_token, wabaIdHint);
        if (!wabaInfo.wabaId) {
            return { success: false, error: 'A Meta não retornou uma conta do WhatsApp Business.' };
        }
        await subscribeWabaToApp(json.access_token, wabaInfo.wabaId);

        return {
            success: true,
            accessToken: json.access_token,
            wabaId: wabaInfo.wabaId,
            phoneNumberId: wabaInfo.phoneNumberId,
            metaInfo: wabaInfo.metaInfo
        };

    } catch (error: any) {
        console.error('[META_AUTH] Exception:', error);
        return { success: false, error: error.message };
    }
}

