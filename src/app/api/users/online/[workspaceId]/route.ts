
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import type { OnlineAgent, User } from '@/lib/types';
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
    const { data, error } = await supabase
      .from('users')
      .select(
        'id, full_name, avatar_url, email, online_since, user_workspace_roles!inner(workspace_id)'
      )
      .eq('online', true)
      .eq('user_workspace_roles.workspace_id', workspaceId);

    if (error) {
      throw error;
    }

    const onlineAgents: OnlineAgent[] = (data || []).map(user => ({
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
