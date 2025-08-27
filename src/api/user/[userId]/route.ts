
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import type { User, Workspace } from '@/lib/types';


export async function GET(
    request: Request,
    { params }: { params: { userId: string } }
) {
    const userId = params.userId;
    console.log(`--- [API /user] Recebida requisição para o usuário ID: ${userId} ---`);

    if (!userId) {
        console.log('[API /user] Erro: User ID é obrigatório.');
        return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
    }

    try {
        console.log(`[API /user] Buscando usuário no DB...`);
        const userRes = await db.query(`SELECT * FROM users WHERE id = $1`, [userId]);
        
        if (userRes.rowCount === 0) {
            console.log(`[API /user] Usuário com ID ${userId} não encontrado.`);
            return NextResponse.json({ error: 'User not found' }, { status: 404 });
        }
        const dbUser = userRes.rows[0];
        console.log(`[API /user] Usuário encontrado: ${dbUser.full_name}`);

        console.log(`[API /user] Buscando workspaces para o usuário na tabela user_workspace_roles...`);
        const workspacesRes = await db.query(`
            SELECT w.id, w.name, w.avatar_url
            FROM workspaces w
            JOIN user_workspace_roles uwr ON w.id = uwr.workspace_id
            WHERE uwr.user_id = $1
        `, [userId]);
        console.log(`[API /user] Encontrados ${workspacesRes.rowCount} workspaces.`);

        const workspaces: Workspace[] = workspacesRes.rows.map(r => ({ 
            id: r.id, 
            name: r.name, 
            avatar: r.avatar_url || ''
        }));

        const user: User = {
            id: dbUser.id,
            name: dbUser.full_name,
            firstName: dbUser.full_name.split(' ')[0] || '',
            lastName: dbUser.full_name.split(' ').slice(1).join(' ') || '',
            avatar: dbUser.avatar_url || '',
            email: dbUser.email,
            workspaces,
            activeWorkspaceId: dbUser.last_active_workspace_id || workspaces[0]?.id,
        };
        
        console.log('[API /user] Retornando objeto de usuário completo:', user);
        return NextResponse.json(user);

    } catch (error) {
        console.error('[API /user] Erro ao buscar dados do usuário:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
