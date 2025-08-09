
'use server';

import { db } from '@/lib/db';
import type { WorkspaceMember } from '@/lib/types';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { revalidatePath } from 'next/cache';

async function hasPermission(userId: string, workspaceId: string, permission: string): Promise<boolean> {
    const res = await db.query(`
        SELECT 1
        FROM user_workspace_roles uwr
        JOIN role_permissions rp ON uwr.role_id = rp.role_id
        WHERE uwr.user_id = $1 AND uwr.workspace_id = $2 AND rp.permission_id = $3
    `, [userId, workspaceId, permission]);
    return res.rowCount > 0;
}

export async function getWorkspaceMembers(workspaceId: string): Promise<{ members: WorkspaceMember[], error?: string }> {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return { members: [], error: "Usuário não autenticado." };
    
    // Check if the user has permission to view members
    if (!await hasPermission(session.user.id, workspaceId, 'members:view')) {
         return { members: [], error: "Acesso não autorizado." };
    }

    try {
        const res = await db.query(`
            SELECT
                u.id,
                u.full_name,
                u.email,
                u.avatar_url,
                u.online,
                r.name as role_name,
                uwr.created_at
            FROM users u
            JOIN user_workspace_roles uwr ON u.id = uwr.user_id
            JOIN roles r ON uwr.role_id = r.id
            WHERE uwr.workspace_id = $1
            ORDER BY u.full_name
        `, [workspaceId]);

        const members: WorkspaceMember[] = res.rows.map(row => ({
            id: row.id,
            name: row.full_name,
            email: row.email,
            avatar: row.avatar_url,
            online: row.online,
            role: row.role_name,
            memberSince: new Date(row.created_at).toLocaleDateString('pt-BR', { year: 'numeric', month: 'short' }),
            // This is a placeholder value. In a real app, this would come from usage tracking.
            autopilotUsage: parseFloat((Math.random() * 25).toFixed(2)),
        }));

        return { members };
    } catch (error) {
        console.error("Erro ao buscar membros do workspace:", error);
        return { members: [], error: "Falha ao buscar dados do banco de dados." };
    }
}

export async function removeMemberAction(memberId: string, workspaceId: string): Promise<{ success: boolean; error?: string }> {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return { success: false, error: "Usuário não autenticado." };

    if (!await hasPermission(session.user.id, workspaceId, 'members:remove')) {
        return { success: false, error: "Você não tem permissão para remover membros." };
    }
    
    // Prevent user from removing themselves
    if (session.user.id === memberId) {
        return { success: false, error: "Você não pode remover a si mesmo do workspace." };
    }

    try {
        // Check if the user to be removed is the owner of the workspace
        const workspaceOwnerCheck = await db.query('SELECT owner_id FROM workspaces WHERE id = $1', [workspaceId]);
        if (workspaceOwnerCheck.rows[0]?.owner_id === memberId) {
            return { success: false, error: "Não é possível remover o proprietário do workspace." };
        }

        await db.query('DELETE FROM user_workspace_roles WHERE user_id = $1 AND workspace_id = $2', [memberId, workspaceId]);
        
        revalidatePath('/team/members');
        return { success: true };
    } catch (error) {
        console.error("Erro ao remover membro:", error);
        return { success: false, error: "Falha ao remover o membro do banco de dados." };
    }
}

    
