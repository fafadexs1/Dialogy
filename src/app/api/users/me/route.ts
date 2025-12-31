import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/actions/user';

export async function GET(request: NextRequest) {
    try {
        const user = await getCurrentUser();

        if (!user) {
            return NextResponse.json({ user: null }, { status: 200 });
        }

        return NextResponse.json({ user });
    } catch (error) {
        console.error('[API_USERS_ME] Error:', error);
        return NextResponse.json({ error: 'Failed to fetch user' }, { status: 500 });
    }
}
