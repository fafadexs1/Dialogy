'use server';

import { db } from '@/lib/db';
import { revalidatePath } from 'next/cache';

export async function updateUserOnlineStatus(userId: string, isOnline: boolean) {
  if (!userId) {
    console.error('[UPDATE_USER_STATUS] User ID não fornecido.');
    return;
  }
  try {
    await db.query('UPDATE users SET online = $1 WHERE id = $2', [isOnline, userId]);
    console.log(`[UPDATE_USER_STATUS] Status do usuário ${userId} atualizado para: ${isOnline ? 'Online' : 'Offline'}`);
  } catch (error) {
    console.error('[UPDATE_USER_STATUS] Erro ao atualizar status do usuário:', error);
  }
  // A revalidação foi removida daqui, pois estava sendo chamada durante a renderização, o que é proibido.
  // A atualização da lista de usuários online é feita por polling no lado do cliente.
}
