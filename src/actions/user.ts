

'use server';

import { createClient } from '@/lib/supabase/server';
import { cookies } from 'next/headers';
import { db } from '@/lib/db';
import type { OnlineAgent, User } from '@/lib/types';

export async function updateUserOnlineStatus(userId: string, isOnline: boolean) {
  if (!userId) {
    console.error('[UPDATE_USER_STATUS] User ID não fornecido.');
    return;
  }
  
  const supabase = createClient(cookies());

  try {
    const { error } = await supabase
      .from('users')
      .update({
        online: isOnline,
        online_since: isOnline ? new Date().toISOString() : null,
      })
      .eq('id', userId);

    if (error) {
      throw error;
    }

    console.log(
      `[UPDATE_USER_STATUS] Status do usuário ${userId} atualizado para: ${isOnline ? 'Online' : 'Offline'}`,
    );
  } catch (error) {
    console.error('[UPDATE_USER_STATUS] Erro ao atualizar status do usuário:', error);
  }
}


export async function getOnlineAgents(workspaceId: string): Promise<OnlineAgent[]> {
    if (!workspaceId) {
        console.error('[GET_ONLINE_AGENTS] Workspace ID não fornecido.');
        return [];
    }

    try {
        const res = await db.query(
          `SELECT u.id, u.full_name, u.avatar_url, u.email, u.online_since
           FROM users u
           JOIN user_workspace_roles uwr ON u.id = uwr.user_id
           WHERE u.online = TRUE AND uwr.workspace_id = $1`,
          [workspaceId]
        );

        const onlineAgents: OnlineAgent[] = (res.rows || []).map(user => ({
          user: {
            id: user.id,
            name: user.full_name,
            firstName: user.full_name.split(' ')[0] || '',
            lastName: user.full_name.split(' ').slice(1).join(' ') || '',
            avatar: user.avatar_url,
            email: user.email,
          } as User,
          joined_at: new Date(user.online_since).toISOString(),
        }));

        return onlineAgents;

    } catch (error) {
        console.error(`[GET_ONLINE_AGENTS] Erro ao buscar agentes online para o workspace ${workspaceId}:`, error);
        return [];
    }
}

    