'use server';

import { NextResponse } from 'next/server';
import { updateUserOnlineStatus } from '@/actions/user';

/**
 * Endpoint para ser chamado via navigator.sendBeacon()
 * para garantir que o status offline seja definido quando o usuário fecha a página.
 */
export async function POST(request: Request) {
    try {
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

        const { userId, workspaceId } = payload;

        if (!userId || !workspaceId) {
            return NextResponse.json({ error: 'User ID and workspaceId are required' }, { status: 400 });
        }

        await updateUserOnlineStatus(userId, workspaceId, false);

        // Retorna uma resposta 204 No Content, que é apropriada para sendBeacon.
        return new Response(null, { status: 204 });

    } catch (error: any) {
        console.error('[OFFLINE_API] Error:', error);
        // Retorna um erro, embora o sendBeacon não processe a resposta.
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
