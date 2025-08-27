
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
        const dbUser = await db.user.findUnique({ where: { id: userId }});
        
        if (!dbUser) {
            console.log(`[API /user] Usuário com ID ${userId} não encontrado.`);
            return NextResponse.json({ error: 'User not found' }, { status: 404 });
        }
        console.log(`[API /user] Usuário encontrado: ${dbUser.fullName}`);

        console.log(`[API /user] Buscando workspaces para o usuário na tabela user_workspace_roles...`);
        const userWorkspaceRoles = await db.userWorkspaceRole.findMany({
            where: { userId: userId },
            include: { workspace: { select: { id: true, name: true, avatarUrl: true }}}
        });
        const workspaceIds = userWorkspaceRoles.map(r => r.workspace.id);
        console.log(`[API /user] IDs dos workspaces encontrados: ${workspaceIds.join(', ')}`);

        const workspaces: Workspace[] = userWorkspaceRoles.map(r => ({ 
            id: r.workspace.id, 
            name: r.workspace.name, 
            avatar: r.workspace.avatarUrl || ''
        }));
        console.log(`[API /user] Detalhes dos workspaces carregados:`, workspaces.map(w=>w.name));

        const user: User = {
            id: dbUser.id,
            name: dbUser.fullName,
            firstName: dbUser.fullName.split(' ')[0] || '',
            lastName: dbUser.fullName.split(' ').slice(1).join(' ') || '',
            avatar: dbUser.avatarUrl || '',
            email: dbUser.email,
            workspaces,
            activeWorkspaceId: dbUser.lastActiveWorkspaceId || workspaces[0]?.id,
        };
        
        console.log('[API /user] Retornando objeto de usuário completo:', user);
        return NextResponse.json(user);

    } catch (error) {
        console.error('[API /user] Erro ao buscar dados do usuário:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
