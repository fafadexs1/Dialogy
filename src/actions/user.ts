
'use server';

import { db } from '@/lib/db';

export async function updateUserOnlineStatus(userId: string, isOnline: boolean) {
  if (!userId) {
    console.error('[UPDATE_USER_STATUS] User ID não fornecido.');
    return;
  }
  try {
    // Ao ficar online, atualiza o timestamp. Ao ficar offline, define como NULL.
    const query = isOnline
      ? 'UPDATE users SET online = $1, online_since = NOW() WHERE id = $2'
      : "UPDATE users SET online = $1, online_since = NULL WHERE id = $2";

    await db.query(query, [isOnline, userId]);
    console.log(`[UPDATE_USER_STATUS] Status do usuário ${userId} atualizado para: ${isOnline ? 'Online' : 'Offline'}`);
  } catch (error) {
    console.error('[UPDATE_USER_STATUS] Erro ao atualizar status do usuário:', error);
  }
}

    