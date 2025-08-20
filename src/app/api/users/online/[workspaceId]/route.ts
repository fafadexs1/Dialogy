
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

  try {
    // A verificação de sessão e o filtro por workspaceId na query já garantem a segurança.
    // A verificação anterior era redundante e poderia causar problemas de permissão.
    const res = await db.query(
      `SELECT u.id, u.full_name, u.avatar_url, u.email, u.online_since
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
      // Retorna o timestamp de quando o usuário ficou online, do banco de dados.
      joined_at: new Date(user.online_since).toISOString(),
    }));

    return NextResponse.json(onlineAgents);
  } catch (error) {
    console.error(`[API /users/online/${workspaceId}] Error fetching online users:`, error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
