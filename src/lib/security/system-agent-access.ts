import 'server-only';

import { db } from '@/lib/db';

export async function chatBelongsToWorkspace(chatId: string, workspaceId: string): Promise<boolean> {
  if (!chatId || !workspaceId) return false;

  const result = await db.query(
    'SELECT 1 FROM chats WHERE id = $1 AND workspace_id = $2 LIMIT 1',
    [chatId, workspaceId],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function automatedActorCanAccessChat(input: {
  chatId: string;
  actorId: string;
  isSystemAgent: boolean;
}): Promise<boolean> {
  const actorJoin = input.isSystemAgent
    ? `EXISTS (
         SELECT 1
           FROM system_agents sa
          WHERE sa.id = $2
            AND sa.workspace_id = c.workspace_id
            AND sa.is_active = TRUE
       )`
    : `EXISTS (
         SELECT 1
           FROM workspaces w
           LEFT JOIN users u ON u.id = $2
           LEFT JOIN user_workspace_roles uwr
             ON uwr.user_id = $2
            AND uwr.workspace_id = w.id
          WHERE w.id = c.workspace_id
            AND (
              w.owner_id = $2
              OR COALESCE(u.is_superadmin, FALSE) = TRUE
              OR uwr.user_id IS NOT NULL
            )
       )`;

  const result = await db.query(
    `SELECT 1
       FROM chats c
      WHERE c.id = $1
        AND ${actorJoin}
      LIMIT 1`,
    [input.chatId, input.actorId],
  );
  return (result.rowCount ?? 0) > 0;
}
