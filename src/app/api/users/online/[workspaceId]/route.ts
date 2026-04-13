
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getOnlineAgents } from '@/lib/presence-server';

export async function GET(
  request: Request,
  props: { params: Promise<{ workspaceId: string }> }
) {
  const params = await props.params;
  const supabase = await createClient();

  const { data: { user: authUser } } = await supabase.auth.getUser();
  if (!authUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const workspaceId = params.workspaceId;
  if (!workspaceId) {
    return NextResponse.json({ error: 'Workspace ID is required' }, { status: 400 });
  }

  try {
    const onlineAgents = await getOnlineAgents(workspaceId);
    return NextResponse.json(onlineAgents);
  } catch (error) {
    console.error(`[API /users/online/${workspaceId}] Error fetching users:`, error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
