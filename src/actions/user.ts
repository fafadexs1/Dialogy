
'use server';

import { createClient } from '@/lib/supabase/server';
import { cookies } from 'next/headers';

export async function updateUserOnlineStatus(userId: string, isOnline: boolean) {
  if (!userId) {
    console.error('[UPDATE_USER_STATUS] User ID não fornecido.');
    return;
  }
  
  const cookieStore = cookies()
  const supabase = createClient(cookieStore);

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
