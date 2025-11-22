
'use server';

import { NextResponse } from 'next/server';

/**
 * Endpoint para ser chamado via navigator.sendBeacon()
 * para garantir que o status offline seja definido quando o usuário fecha a página.
 * DEPRECATED: Esta lógica agora é tratada pela presença em tempo real do Supabase.
 */
export async function POST(request: Request) {
  try {
    const { userId } = await request.json();

    if (!userId) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
    }
    
    // A chamada para a ação do servidor foi removida, pois foi descontinuada.
    // O endpoint é mantido para evitar que clientes antigos quebrem.

    // Retorna uma resposta 204 No Content, que é apropriada para sendBeacon.
    return new Response(null, { status: 204 });

  } catch (error: any) {
    console.error('[OFFLINE_API] Error:', error);
    // Retorna um erro, embora o sendBeacon não processe a resposta.
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
