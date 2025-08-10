
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import type { OnlineAgent, User } from '@/lib/types';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../auth/[...nextauth]/route';

export async function GET(
  request: Request,
  { params }: { params: { workspaceId: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const workspaceId = params.workspaceId;
  if (!workspaceId) {
    return NextResponse.json({ error: 'Workspace ID is required' }, { status: 400 });
  }

  // Verify the user is a member of the requested workspace to prevent data leakage
  const memberCheck = await db.query(
    'SELECT 1 FROM user_workspace_roles WHERE user_id = $1 AND workspace_id = $2',
    [session.user.id, workspaceId]
  );
  if (memberCheck.rowCount === 0) {
     return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const res = await db.query(
      `SELECT u.id, u.full_name, u.avatar_url, u.email
       FROM users u
       JOIN user_workspace_roles uwr ON u.id = uwr.user_id
       WHERE u.online = true AND uwr.workspace_id = $1`,
      [workspaceId]
    );

    const onlineAgents: OnlineAgent[] = res.rows.map(user => ({
      user: {
        id: user.id,
        name: user.full_name,
        firstName: user.full_name.split(' ')[0] || '',
        lastName: user.full_name.split(' ').slice(1).join(' ') || '',
        avatar: user.avatar_url,
        email: user.email,
      } as User,
      // In a real system, 'joined_at' would come from a login/presence timestamp.
      // Here, we use the current time as an approximation.
      joined_at: new Date().toISOString(), 
    }));

    return NextResponse.json(onlineAgents);
  } catch (error) {
    console.error(`[API /users/online/${workspaceId}] Error fetching online users:`, error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
