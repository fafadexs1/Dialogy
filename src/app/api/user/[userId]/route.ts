
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
        const userRes = await db.query('SELECT id, full_name, avatar_url, email, last_active_workspace_id FROM users WHERE id = $1', [userId]);
        
        if (userRes.rows.length === 0) {
            console.log(`[API /user] Usuário com ID ${userId} não encontrado.`);
            return NextResponse.json({ error: 'User not found' }, { status: 404 });
        }
        const dbUser = userRes.rows[0];
        console.log(`[API /user] Usuário encontrado: ${dbUser.full_name}`);

        console.log(`[API /user] Buscando workspaces para o usuário...`);
        const uwRes = await db.query('SELECT workspace_id FROM user_workspaces WHERE user_id = $1', [userId]);
        const workspaceIds = uwRes.rows.map(r => r.workspace_id);
        console.log(`[API /user] IDs dos workspaces encontrados: ${workspaceIds.join(', ')}`);

        let workspaces: Workspace[] = [];
        if (workspaceIds.length > 0) {
            const wsRes = await db.query('SELECT id, name, avatar_url FROM workspaces WHERE id = ANY($1)', [workspaceIds]);
            workspaces = wsRes.rows.map(r => ({ id: r.id, name: r.name, avatar: r.avatar_url }));
            console.log(`[API /user] Detalhes dos workspaces carregados:`, workspaces.map(w=>w.name));
        }

        const user: User = {
            id: dbUser.id,
            name: dbUser.full_name,
            firstName: dbUser.full_name.split(' ')[0] || '',
            lastName: dbUser.full_name.split(' ').slice(1).join(' ') || '',
            avatar: dbUser.avatar_url,
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
