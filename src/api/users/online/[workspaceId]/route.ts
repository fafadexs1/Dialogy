
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import type { OnlineAgent, User } from '@/lib/types';
import { createClient } from '@/lib/supabase/server';
import { cookies } from 'next/headers';

export async function GET(
  request: Request,
  { params }: { params: { workspaceId: string } }
) {
  const cookieStore = cookies();
  const supabase = createClient(cookieStore);
  
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const workspaceId = params.workspaceId;
  if (!workspaceId) {
    return NextResponse.json({ error: 'Workspace ID is required' }, { status: 400 });
  }

  try {
    const res = await db.query(
      `SELECT u.id, u.full_name, u.avatar_url, u.email, u.online_since
       FROM users u
       JOIN user_workspace_roles uwr ON u.id = uwr.user_id
       WHERE u.online = TRUE AND uwr.workspace_id = $1`,
      [workspaceId]
    );

    const onlineAgents: OnlineAgent[] = (res.rows || []).map(user => ({
      user: {
        id: user.id,
        name: user.full_name,
        firstName: user.full_name.split(' ')[0] || '',
        lastName: user.full_name.split(' ').slice(1).join(' ') || '',
        avatar: user.avatar_url,
        email: user.email,
      } as User,
      joined_at: new Date(user.online_since).toISOString(),
    }));

    return NextResponse.json(onlineAgents);
  } catch (error) {
    console.error(`[API /users/online/${workspaceId}] Error fetching online users:`, error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
