'use server';

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { updateUserOnlineStatus } from '@/actions/user';

export async function POST(request: Request) {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const { workspaceId, isOnline } = await request.json();

        if (!workspaceId || typeof isOnline !== 'boolean') {
            return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
        }

        await updateUserOnlineStatus(user.id, workspaceId, isOnline);

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('[API users/online-status] Error updating status:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
