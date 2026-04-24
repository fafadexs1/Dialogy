import 'server-only';

import { db } from '@/lib/db';

export type InboxAccessResult =
  | { ok: true }
  | { ok: false; error: string };

export async function hasWorkspaceAccess(userId: string, workspaceId: string): Promise<boolean> {
  const res = await db.query(
    `SELECT 1
     FROM user_workspace_roles
     WHERE user_id = $1
       AND workspace_id = $2
     LIMIT 1`,
    [userId, workspaceId]
  );

  return (res.rowCount ?? 0) > 0;
}

export async function requireWorkspaceAccess(
  userId: string | null | undefined,
  workspaceId: string,
): Promise<InboxAccessResult> {
  if (!userId) {
    return { ok: false, error: 'Usuário não autenticado.' };
  }

  const allowed = await hasWorkspaceAccess(userId, workspaceId);
  if (!allowed) {
    return { ok: false, error: 'Sem permissão para este workspace.' };
  }

  return { ok: true };
}

export async function hasChatAccess(userId: string, chatId: string): Promise<boolean> {
  const res = await db.query(
    `SELECT 1
     FROM chats c
     JOIN user_workspace_roles uwr
       ON uwr.workspace_id = c.workspace_id
      AND uwr.user_id = $2
     WHERE c.id = $1
     LIMIT 1`,
    [chatId, userId]
  );

  return (res.rowCount ?? 0) > 0;
}

export async function requireChatAccess(
  userId: string | null | undefined,
  chatId: string,
): Promise<InboxAccessResult> {
  if (!userId) {
    return { ok: false, error: 'Usuário não autenticado.' };
  }

  const allowed = await hasChatAccess(userId, chatId);
  if (!allowed) {
    return { ok: false, error: 'Sem permissão para esta conversa.' };
  }

  return { ok: true };
}
