
import { NextResponse } from 'next/server';
import type { OnlineAgent, User } from '@/lib/types';
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';

/**
 * DEPRECATED: This route is no longer the primary source for online status.
 * Presence is handled in real-time by the Supabase client via the usePresence hook.
 * This route is kept for potential compatibility or fallback but should not be relied upon.
 */
export async function GET(
  request: Request,
  { params }: { params: { workspaceId: string } }
) {
  const supabase = createClient();
  
  const { data: { user: authUser } } = await supabase.auth.getUser();
  if (!authUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const workspaceId = params.workspaceId;
  if (!workspaceId) {
    return NextResponse.json({ error: 'Workspace ID is required' }, { status: 400 });
  }

  try {
    // This query is simplified to just get all users, as the 'online' column is gone.
     const res = await db.query(
          `SELECT u.id, u.full_name, u.avatar_url, u.email
           FROM users u
           JOIN user_workspace_roles uwr ON u.id = uwr.user_id
           WHERE uwr.workspace_id = $1`,
          [workspaceId]
        );

    // Returns an empty array, as the client will populate this list via real-time presence.
    const onlineAgents: OnlineAgent[] = [];

    return NextResponse.json(onlineAgents);
  } catch (error) {
    console.error(`[API /users/online/${workspaceId}] Error fetching users:`, error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
