
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import type { User, Workspace } from '@/lib/types';


export async function GET(
    request: Request,
    { params }: { params: { userId: string } }
) {
    const userId = params.userId;

    if (!userId) {
        return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
    }

    try {
        const userRes = await db.query('SELECT id, full_name, avatar_url, email, last_active_workspace_id FROM users WHERE id = $1', [userId]);
        if (userRes.rows.length === 0) {
            return NextResponse.json({ error: 'User not found' }, { status: 404 });
        }
        const dbUser = userRes.rows[0];

        const uwRes = await db.query('SELECT workspace_id FROM user_workspaces WHERE user_id = $1', [userId]);
        const workspaceIds = uwRes.rows.map(r => r.workspace_id);

        let workspaces: Workspace[] = [];
        if (workspaceIds.length > 0) {
            const wsRes = await db.query('SELECT id, name, avatar_url FROM workspaces WHERE id = ANY($1)', [workspaceIds]);
            workspaces = wsRes.rows.map(r => ({ id: r.id, name: r.name, avatar: r.avatar_url }));
        }

        const user: User = {
            id: dbUser.id,
            name: dbUser.full_name,
            firstName: dbUser.full_name.split(' ')[0] || '',
            lastName: dbUser.full_name.split(' ').slice(1).join(' ') || '',
            avatar: dbUser.avatar_url,
            email: dbUser.email,
            workspaces,
            activeWorkspaceId: dbUser.last_active_workspace_id || workspaces[0]?.id,
        };

        return NextResponse.json(user);

    } catch (error) {
        console.error('API Error fetching user:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
