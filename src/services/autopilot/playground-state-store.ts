import { db } from '@/lib/db';

export type AutopilotPlaygroundState = {
  sessionId: string;
  workspaceId: string;
  autopilotConfigId: string | null;
  activeNodeId: string | null;
};

type StateRow = {
  session_id: string;
  workspace_id: string;
  autopilot_config_id: string | null;
  active_node_id: string | null;
};

export async function getAutopilotPlaygroundState(
  sessionId: string,
  workspaceId: string,
): Promise<AutopilotPlaygroundState | null> {
  const result = await db.query<StateRow>(
    `SELECT session_id, workspace_id, autopilot_config_id, active_node_id
       FROM autopilot_playground_states
      WHERE session_id = $1 AND workspace_id = $2
      LIMIT 1`,
    [sessionId, workspaceId],
  );
  const row = result.rows[0];
  return row
    ? {
        sessionId: row.session_id,
        workspaceId: row.workspace_id,
        autopilotConfigId: row.autopilot_config_id,
        activeNodeId: row.active_node_id,
      }
    : null;
}

export async function saveAutopilotPlaygroundState(input: {
  sessionId: string;
  workspaceId: string;
  autopilotConfigId?: string | null;
  activeNodeId?: string | null;
}) {
  await db.query(
    `INSERT INTO autopilot_playground_states (
       session_id, workspace_id, autopilot_config_id, active_node_id, updated_at
     ) VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (session_id, workspace_id) DO UPDATE SET
       autopilot_config_id = EXCLUDED.autopilot_config_id,
       active_node_id = EXCLUDED.active_node_id,
       updated_at = NOW()`,
    [input.sessionId, input.workspaceId, input.autopilotConfigId ?? null, input.activeNodeId ?? null],
  );
}
