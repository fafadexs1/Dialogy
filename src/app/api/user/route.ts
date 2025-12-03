
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import type { User, Workspace } from '@/lib/types';
import { createClient } from '@/lib/supabase/server';


export async function GET(request: Request) {
    const supabase = await createClient();

    const { data: { user: authUser } } = await supabase.auth.getUser();

    if (!authUser) {
        console.log(`[API /user] Erro: Usuário não autenticado. UA: ${request.headers.get('user-agent')} | IP: ${request.headers.get('x-forwarded-for')}`);
        return NextResponse.json({ error: 'User not authenticated' }, { status: 401 });
    }
    const userId = authUser.id;
    console.log(`--- [API /user] Recebida requisição para o usuário autenticado ID: ${userId} ---`);


    try {
        console.log(`[API /user] Buscando usuário no DB...`);
        const userRes = await db.query('SELECT * FROM users WHERE id = $1', [userId]);

        if (userRes.rowCount === 0) {
            console.log(`[API /user] Usuário com ID ${userId} não encontrado no DB public.users.`);
            return NextResponse.json({ error: 'User not found' }, { status: 404 });
        }
        const dbUser = userRes.rows[0];
        console.log(`[API /user] Usuário encontrado: ${dbUser.full_name}`);

        console.log(`[API /user] Buscando workspaces para o usuário...`);
        const workspacesRes = await db.query(`
            SELECT 
              w.id, 
              w.name, 
              w.avatar_url, 
              w.timezone, 
              w.close_message_template, 
              w.transfer_team_message_template,
              w.marketing_auto_close_seconds,
              (w.owner_id = $1) AS is_owner
            FROM workspaces w
            JOIN user_workspace_roles uwr ON w.id = uwr.workspace_id
            WHERE uwr.user_id = $1
        `, [userId]);

        const workspaces: Workspace[] = workspacesRes.rows.map((r: any) => ({
            id: r.id,
            name: r.name,
            avatar: r.avatar_url || '',
            timezone: r.timezone || undefined,
            closeMessageTemplate: r.close_message_template || '',
            transferTeamMessageTemplate: r.transfer_team_message_template || '',
            marketingAutoCloseSeconds: r.marketing_auto_close_seconds ?? undefined,
            isOwner: !!r.is_owner,
        }));
        console.log(`[API /user] Detalhes dos workspaces carregados:`, workspaces.map(w => w.name));

        const user: User = {
            id: dbUser.id,
            name: dbUser.full_name,
            firstName: dbUser.full_name.split(' ')[0] || '',
            lastName: dbUser.full_name.split(' ').slice(1).join(' ') || '',
            avatar: dbUser.avatar_url || '',
            email: dbUser.email,
            workspaces,
            activeWorkspaceId: dbUser.last_active_workspace_id || workspaces[0]?.id,
            is_superadmin: dbUser.is_superadmin,
        };

        console.log('[API /user] Retornando objeto de usuário completo:', user);
        return NextResponse.json(user);

    } catch (error) {
        console.error('[API /user] Erro ao buscar dados do usuário:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}


