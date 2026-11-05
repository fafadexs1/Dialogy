

'use server';

import { db } from '@/lib/db';
import type { Role, WorkspaceMember } from '@/lib/types';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { buildPresenceAvailabilitySql, getPresenceRecentActivitySeconds, getPresenceTtlSeconds } from '@/lib/presence';
import { hasWorkspacePermission } from '@/lib/workspace-permissions';

export async function getWorkspaceMembers(workspaceId: string): Promise<{ members: WorkspaceMember[], error?: string }> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { members: [], error: "Usuário não autenticado." };

    // Check if the user has permission to view members
    if (!await hasWorkspacePermission(user.id, workspaceId, 'members:view')) {
        return { members: [], error: "Acesso não autorizado." };
    }

    try {
        const ttlSeconds = getPresenceTtlSeconds();
        const recentActivitySeconds = getPresenceRecentActivitySeconds();
        const availabilitySql = buildPresenceAvailabilitySql('uwp', '$2', '$3');
        const res = await db.query(`
            SELECT
                u.id,
                u.full_name,
                u.email,
                u.avatar_url,
                r.id as role_id,
                r.name as role_name,
                uwr.created_at,
                t.name as team_name,
                CASE
                    WHEN ${availabilitySql} THEN TRUE
                    ELSE FALSE
                END as is_online
            FROM users u
            JOIN user_workspace_roles uwr ON u.id = uwr.user_id
            LEFT JOIN user_workspace_presence uwp ON uwp.user_id = u.id AND uwp.workspace_id = uwr.workspace_id
            LEFT JOIN roles r ON uwr.role_id = r.id
            LEFT JOIN team_members tm ON u.id = tm.user_id
            LEFT JOIN teams t ON tm.team_id = t.id AND t.workspace_id = uwr.workspace_id
            WHERE uwr.workspace_id = $1
            ORDER BY u.full_name
        `, [workspaceId, ttlSeconds, recentActivitySeconds]);

        const members: WorkspaceMember[] = res.rows.map(row => ({
            id: row.id,
            name: row.full_name,
            email: row.email,
            avatar: row.avatar_url,
            online: row.is_online,
            roleId: row.role_id,
            role: row.role_name || 'N/A',
            team: row.team_name || 'Nenhuma',
            memberSince: row.created_at ? new Date(row.created_at).toLocaleDateString('pt-BR', { year: 'numeric', month: 'short' }) : 'N/A',
            autopilotUsage: parseFloat((Math.random() * 25).toFixed(2)),
        }));

        return { members };
    } catch (error) {
        console.error("Erro ao buscar membros do workspace:", error);
        return { members: [], error: "Falha ao buscar dados do banco de dados." };
    }
}

export async function removeMemberAction(memberId: string, workspaceId: string): Promise<{ success: boolean; error?: string }> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: "Usuário não autenticado." };

    if (!await hasWorkspacePermission(user.id, workspaceId, 'members:remove')) {
        return { success: false, error: "Você não tem permissão para remover membros." };
    }

    // Prevent user from removing themselves
    if (user.id === memberId) {
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

export async function updateMemberRoleAction(
    prevState: any,
    formData: FormData
): Promise<{ success: boolean; error?: string }> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: "Usuário não autenticado." };

    const memberId = formData.get('memberId') as string;
    const workspaceId = formData.get('workspaceId') as string;
    const newRoleId = formData.get('roleId') as string;

    if (!memberId || !workspaceId || !newRoleId) {
        return { success: false, error: "Dados insuficientes para atualizar a função." };
    }

    if (!await hasWorkspacePermission(user.id, workspaceId, 'permissions:edit')) {
        return { success: false, error: "Você não tem permissão para alterar funções de membros." };
    }

    // Prevent changing role of the workspace owner
    const workspaceOwnerCheck = await db.query('SELECT owner_id FROM workspaces WHERE id = $1', [workspaceId]);
    if (workspaceOwnerCheck.rows[0]?.owner_id === memberId) {
        return { success: false, error: "Não é possível alterar a função do proprietário do workspace." };
    }

    try {
        const updateResult = await db.query(
            `UPDATE user_workspace_roles uwr
                SET role_id = r.id
               FROM roles r
              WHERE r.id = $1
                AND r.workspace_id = $3
                AND uwr.user_id = $2
                AND uwr.workspace_id = $3
              RETURNING uwr.user_id`,
            [newRoleId, memberId, workspaceId]
        );
        if ((updateResult.rowCount ?? 0) === 0) {
            return { success: false, error: "Função ou membro não encontrado neste workspace." };
        }
        revalidatePath('/team/members');
        return { success: true };
    } catch (error) {
        console.error("Erro ao atualizar função do membro:", error);
        return { success: false, error: "Falha ao atualizar a função no banco de dados." };
    }
}
