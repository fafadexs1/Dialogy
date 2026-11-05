import 'server-only';
import { db } from '@/lib/db';

export type StudioMigrationInventory = {
  conversations: number;
  systemAgents: number;
  webchatWidgets: number;
  publishedWorkflowReferences: number;
};

/** Counts consumers only; it never reads messages, secrets or contact payloads. */
export async function readStudioMigrationInventory(workspaceId: string, agentId: string): Promise<StudioMigrationInventory> {
  const result = await db.query(`SELECT
    (SELECT count(*)::int FROM chats WHERE workspace_id = $1 AND autopilot_config_id = $2) AS conversations,
    (SELECT count(*)::int FROM system_agents WHERE workspace_id = $1 AND autopilot_config_id = $2) AS "systemAgents",
    (SELECT count(*)::int FROM webchat_widgets WHERE workspace_id = $1 AND autopilot_config_id = $2) AS "webchatWidgets",
    ((SELECT count(*)::int FROM workflow_definitions WHERE workspace_id = $1 AND status = 'published'
       AND jsonb_path_exists(definition, '$.** ? (@.agentId == $agent)', jsonb_build_object('agent', to_jsonb($2::text))))
     + (SELECT count(*)::int FROM nexus_workflow_versions WHERE workspace_id = $1 AND published_revision IS NOT NULL
       AND jsonb_path_exists(definition, '$.** ? (@.agentId == $agent)', jsonb_build_object('agent', to_jsonb($2::text))))) AS "publishedWorkflowReferences"`, [workspaceId, agentId]);
  const row = result.rows[0] || {};
  return { conversations: Number(row.conversations || 0), systemAgents: Number(row.systemAgents || 0),
    webchatWidgets: Number(row.webchatWidgets || 0), publishedWorkflowReferences: Number(row.publishedWorkflowReferences || 0) };
}
