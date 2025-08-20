
'use server';

import { NextResponse } from 'next/server';
import { updateUserOnlineStatus } from '@/actions/user';

/**
 * Endpoint para ser chamado via navigator.sendBeacon()
 * para garantir que o status offline seja definido quando o usuário fecha a página.
 */
export async function POST(request: Request) {
  try {
    const { userId } = await request.json();

    if (!userId) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
    }
    
    // Chama a server action para atualizar o status no banco de dados.
    await updateUserOnlineStatus(userId, false);

    // Retorna uma resposta 204 No Content, que é apropriada para sendBeacon.
    return new Response(null, { status: 204 });

  } catch (error: any) {
    console.error('[OFFLINE_API] Error:', error);
    // Retorna um erro, embora o sendBeacon não processe a resposta.
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

    