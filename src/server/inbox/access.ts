import 'server-only';

import { db } from '@/lib/db';
import { hasWorkspacePermission } from '@/lib/workspace-permissions';

export type InboxAccessResult =
  | { ok: true }
  | { ok: false; error: string };

export async function hasWorkspaceAccess(userId: string, workspaceId: string): Promise<boolean> {
  return hasWorkspacePermission(userId, workspaceId, 'inbox:access');
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
  const result = await db.query('SELECT workspace_id FROM chats WHERE id = $1', [chatId]);
  const workspaceId = result.rows[0]?.workspace_id;
  return Boolean(workspaceId) && hasWorkspacePermission(userId, workspaceId, 'inbox:access');
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
