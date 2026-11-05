import 'server-only';
import { db } from '@/lib/db';

/** Server adapters restore the original preconditions on a durable retry. */
export async function transferSnapshot(workspaceId: string, actorId: string, operationId: string, chatId: string) {
  const previous = await db.query(`SELECT preconditions FROM chat_transfer_operations
    WHERE workspace_id=$1 AND actor_id=$2 AND operation_id=$3 AND chat_id=$4`, [workspaceId,actorId,operationId,chatId]);
  if (previous.rows[0]) return previous.rows[0].preconditions as {
    expectedAgentId: string | null; expectedTeamId: string | null; expectedSystemAgentId: string | null;
  };
  const current = await db.query(`SELECT agent_id,team_id,assigned_system_agent_id FROM chats WHERE id=$1 AND workspace_id=$2`, [chatId,workspaceId]);
  if (!current.rows[0]) throw new Error('Conversa indisponível neste workspace.');
  return {expectedAgentId:current.rows[0].agent_id ?? null,expectedTeamId:current.rows[0].team_id ?? null,
    expectedSystemAgentId:current.rows[0].assigned_system_agent_id ?? null};
}
