'use server';

import { resilientFetch } from '@/lib/http/resilient-fetch';

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
async function fetchWabaInfo(accessToken: string): Promise<{ wabaId?: string; phoneNumberId?: string; metaInfo?: ExchangeMetaTokenResult['metaInfo'] }> {
    try {
        // Step 1: Get shared WABA accounts
        const wabaResponse = await resilientFetch(
            `https://graph.facebook.com/v24.0/me/businesses?fields=id,name,owned_whatsapp_business_accounts{id,name,phone_numbers{id,display_phone_number,verified_name}}&access_token=${accessToken}`
        );
        const wabaData = await wabaResponse.json().catch(() => ({}));
        console.log('[META_AUTH] WABA fetch response:', JSON.stringify(wabaData, null, 2));

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
            `https://graph.facebook.com/v24.0/me?fields=id,name&access_token=${accessToken}`
        );
        const directData = await directResponse.json().catch(() => ({}));
        console.log('[META_AUTH] Direct me query:', JSON.stringify(directData, null, 2));

        // Try to fetch WABAs associated with the token
        const sharedWabaResponse = await resilientFetch(
            `https://graph.facebook.com/v24.0/debug_token?input_token=${accessToken}&access_token=${accessToken}`
        );
        const debugData = await sharedWabaResponse.json().catch(() => ({}));
        console.log('[META_AUTH] Token debug:', JSON.stringify(debugData, null, 2));

        // Check granular scopes for WABA info
        const granularScopes = debugData.data?.granular_scopes || [];
        for (const scope of granularScopes) {
            if (scope.scope === 'whatsapp_business_management' && scope.target_ids?.length > 0) {
                const wabaId = scope.target_ids[0];
                // Try to get phone numbers for this WABA
                const phoneResponse = await resilientFetch(
                    `https://graph.facebook.com/v24.0/${wabaId}/phone_numbers?access_token=${accessToken}`
                );
                const phoneData = await phoneResponse.json().catch(() => ({}));
                console.log('[META_AUTH] Phone numbers for WABA:', JSON.stringify(phoneData, null, 2));

                if (phoneData.data && phoneData.data.length > 0) {
                    return {
                        wabaId: wabaId,
                        phoneNumberId: phoneData.data[0].id,
                        metaInfo: {
                            displayPhoneNumber: phoneData.data[0].display_phone_number,
                            verifiedName: phoneData.data[0].verified_name
                        }
                    };
                }
                return { wabaId: wabaId };
            }
        }

        return {};
    } catch (error) {
        console.error('[META_AUTH] Error fetching WABA info:', error);
        return {};
    }
}

export async function exchangeMetaAuthCode(code: string): Promise<ExchangeMetaTokenResult> {
    const appId = process.env.NEXT_PUBLIC_FACEBOOK_APP_ID || process.env.NEXT_PUBLIC_META_APP_ID;
    const appSecret = process.env.FACEBOOK_APP_SECRET || process.env.META_APP_SECRET;

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

        // After getting the token, fetch WABA info
        const wabaInfo = await fetchWabaInfo(json.access_token);
        console.log('[META_AUTH] WABA Info fetched:', wabaInfo);

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

