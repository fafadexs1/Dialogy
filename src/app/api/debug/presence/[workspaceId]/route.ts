import { NextResponse } from 'next/server';

import { db } from '@/lib/db';
import { getPresenceDiagnostics } from '@/lib/presence-server';
import { createClient } from '@/lib/supabase/server';

export async function GET(
  request: Request,
  props: { params: Promise<{ workspaceId: string }> }
) {
  const params = await props.params;
  const workspaceId = params.workspaceId;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!workspaceId) {
    return NextResponse.json({ error: 'Workspace ID is required' }, { status: 400 });
  }

  const membershipRes = await db.query(
    `
      SELECT 1
      FROM user_workspace_roles
      WHERE user_id = $1
        AND workspace_id = $2
      LIMIT 1
    `,
    [user.id, workspaceId]
  );

  if ((membershipRes.rowCount ?? 0) === 0) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const diagnostics = await getPresenceDiagnostics(workspaceId);
  return NextResponse.json(diagnostics);
}
