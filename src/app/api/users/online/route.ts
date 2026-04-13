'use server';

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import type { PresenceEventSource } from '@/lib/presence';
import { updateUserOnlineStatus } from '@/lib/presence-server';

/**
 * Endpoint para ser chamado via navigator.sendBeacon()
 * para garantir que o status offline seja definido quando o usuário fecha a página.
 */
export async function POST(request: Request) {
    try {
        const supabase = await createClient();
        const { data: { user: authUser } } = await supabase.auth.getUser();
        const contentType = request.headers.get('content-type') || '';
        let payload: { userId?: string; workspaceId?: string } = {};

        if (contentType.includes('application/json')) {
            payload = await request.json();
        } else {
            const rawBody = await request.text();
            if (rawBody) {
                try {
                    payload = JSON.parse(rawBody);
                } catch {
                    console.warn('[OFFLINE_API] Failed to parse payload sent via sendBeacon.');
                }
            }
        }

        const { userId, workspaceId, tabId, forceOffline, source } = payload as {
            userId?: string;
            workspaceId?: string;
            tabId?: string;
            forceOffline?: boolean;
            source?: PresenceEventSource;
        };
        const effectiveUserId = authUser?.id ?? userId;

        if (!effectiveUserId || !workspaceId) {
            return NextResponse.json({ error: 'User ID and workspaceId are required' }, { status: 400 });
        }

        await updateUserOnlineStatus(
            effectiveUserId,
            workspaceId,
            false,
            tabId,
            Boolean(forceOffline),
            source ?? 'legacy_beacon'
        );

        // Retorna uma resposta 204 No Content, que é apropriada para sendBeacon.
        return new Response(null, { status: 204 });

    } catch (error: any) {
        console.error('[OFFLINE_API] Error:', error);
        // Retorna um erro, embora o sendBeacon não processe a resposta.
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
