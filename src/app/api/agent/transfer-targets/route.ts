'use server';

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET(request: Request) {
  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '').trim();

  if (!token) {
    return NextResponse.json({ error: 'Authorization token is required.' }, { status: 401 });
  }

  try {
    const agentResult = await db.query(
      `SELECT sa.id, sa.workspace_id, sa.is_active, w.name AS workspace_name
       FROM system_agents sa
       LEFT JOIN workspaces w ON w.id = sa.workspace_id
       WHERE sa.token = $1
       LIMIT 1`,
      [token]
    );

    if ((agentResult.rowCount ?? 0) === 0) {
      return NextResponse.json({ error: 'Invalid token.' }, { status: 403 });
    }

    const agent = agentResult.rows[0];
    if (!agent.is_active) {
      return NextResponse.json({ error: 'Agent is not active.' }, { status: 403 });
    }

    const [teamsResult, intelligentAgentsResult] = await Promise.all([
      db.query(
        `SELECT id, name
         FROM teams
         WHERE workspace_id = $1
         ORDER BY name ASC`,
        [agent.workspace_id]
      ),
      db.query(
        `SELECT id, name
         FROM system_agents
         WHERE workspace_id = $1
           AND type = 'intelligent_attendant'
           AND is_active = TRUE
         ORDER BY name ASC`,
        [agent.workspace_id]
      ),
    ]);

    return NextResponse.json({
      workspace: {
        id: agent.workspace_id,
        name: agent.workspace_name || 'Workspace Dialogy',
      },
      teams: teamsResult.rows,
      intelligentAgents: intelligentAgentsResult.rows,
    });
  } catch (error) {
    console.error('[AGENT_TRANSFER_TARGETS_API] Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
