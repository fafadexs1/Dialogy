import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import type { OnlineAgent } from '@/lib/types';

export async function GET() {
  try {
    const res = await db.query(
      `SELECT id, full_name, avatar_url, email
       FROM users WHERE online = true`
    );

    const onlineAgents: OnlineAgent[] = res.rows.map(user => ({
      user: {
        id: user.id,
        name: user.full_name,
        firstName: user.full_name.split(' ')[0] || '',
        lastName: user.full_name.split(' ').slice(1).join(' ') || '',
        avatar: user.avatar_url,
        email: user.email,
      },
      // Em um sistema real, o 'joined_at' viria de um timestamp de login/presença.
      // Aqui, usamos o tempo atual como uma aproximação.
      joined_at: new Date().toISOString(), 
    }));

    return NextResponse.json(onlineAgents);
  } catch (error) {
    console.error('[API /users/online] Erro ao buscar usuários online:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
