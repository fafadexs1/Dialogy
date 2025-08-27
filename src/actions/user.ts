
'use server';

import { db } from '@/lib/db';
import { supabaseAdmin } from '@/lib/supabase';

export async function updateUserOnlineStatus(userId: string, isOnline: boolean) {
  if (!userId) {
    console.error('[UPDATE_USER_STATUS] User ID não fornecido.');
    return;
  }
  try {
    const { error } = await supabaseAdmin
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
