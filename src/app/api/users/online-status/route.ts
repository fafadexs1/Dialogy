'use server';

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import type { PresenceEventSource } from '@/lib/presence';
import { updateUserOnlineStatus } from '@/lib/presence-server';

export async function POST(request: Request) {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const { workspaceId, isOnline, tabId, forceOffline, source } = await request.json();

        if (!workspaceId || typeof isOnline !== 'boolean') {
            return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
        }

        await updateUserOnlineStatus(
            user.id,
            workspaceId,
            isOnline,
            tabId,
            Boolean(forceOffline),
            (source as PresenceEventSource | undefined) ?? 'api'
        );

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('[API users/online-status] Error updating status:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
