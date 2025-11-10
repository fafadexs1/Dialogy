

'use server';

import { db } from '@/lib/db';
import type { Role, Permission } from '@/lib/types';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

// Helper function to check for admin permissions
async function hasPermission(userId: string, workspaceId: string, permission: string): Promise<boolean> {
    const res = await db.query(`
        SELECT 1 FROM user_workspace_roles WHERE user_id = $1 AND workspace_id = $2
    `, [userId, workspaceId]);
    return res.rowCount > 0;
}

export async function getRolesAndPermissions(workspaceId: string): Promise<{ roles: Role[], permissions: Permission[], error?: string }> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { roles: [], permissions: [], error: "Usuário não autenticado." };

    if (!await hasPermission(user.id, workspaceId, 'permissions:view')) {
         return { roles: [], permissions: [], error: "Acesso não autorizado." };
    }
    
    try {
        const rolesRes = await db.query('SELECT id, name, description, is_default FROM roles WHERE workspace_id = $1 ORDER BY name', [workspaceId]);
        const permissionsRes = await db.query('SELECT id, description, category FROM permissions ORDER BY category, id');
        const rolePermissionsRes = await db.query(`
            SELECT rp.role_id, p.id, p.description, p.category
            FROM role_permissions rp
            JOIN permissions p ON rp.permission_id = p.id
            JOIN roles r ON rp.role_id = r.id
            WHERE r.workspace_id = $1
        `, [workspaceId]);

        const permissions: Permission[] = permissionsRes.rows;

        const roles: Role[] = rolesRes.rows.map(role => ({
            id: role.id,
            name: role.name,
            description: role.description,
            is_default: role.is_default,
            permissions: rolePermissionsRes.rows
                .filter(rp => rp.role_id === role.id)
                .map(({ id, description, category }) => ({ id, description, category }))
        }));
        
        return { roles, permissions };
    } catch (error) {
        console.error("Erro ao buscar papéis e permissões:", error);
        return { roles: [], permissions: [], error: "Falha ao buscar dados do banco de dados." };
    }
}

export async function updateRolePermissionAction(roleId: string, permissionId: string, enabled: boolean): Promise<{ success: boolean; error?: string }> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: "Usuário não autenticado." };

    try {
        // First, get the workspaceId from the role
        const roleRes = await db.query('SELECT workspace_id, name, is_default FROM roles WHERE id = $1', [roleId]);
        if (roleRes.rowCount === 0) {
            return { success: false, error: "Papel não encontrado." };
        }
        const { workspace_id: workspaceId, name, is_default: isDefault } = roleRes.rows[0];
        
        if (!await hasPermission(user.id, workspaceId, 'permissions:edit')) {
            return { success: false, error: "Você não tem permissão para editar papéis." };
        }

        if (name === 'Administrador') {
            return { success: false, error: "Não é possível alterar as permissões do papel de Administrador." };
        }

        if (enabled) {
            await db.query('INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [roleId, permissionId]);
        } else {
            await db.query('DELETE FROM role_permissions WHERE role_id = $1 AND permission_id = $2', [roleId, permissionId]);
        }
        
        revalidatePath('/team/permissions');
        return { success: true };

    } catch (error) {
        console.error("Erro ao atualizar permissões do papel:", error);
        return { success: false, error: "Falha ao atualizar permissões no banco de dados." };
    }
}

export async function createRoleAction(prevState: any, formData: FormData): Promise<{ success: boolean; error?: string }> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: "Usuário não autenticado." };

    const name = formData.get('name') as string;
    const description = formData.get('description') as string;
    const workspaceId = formData.get('workspaceId') as string;

    if (!name || !workspaceId) {
        return { success: false, error: "Nome do papel e ID do workspace são obrigatórios." };
    }

    if (!await hasPermission(user.id, workspaceId, 'permissions:edit')) {
        return { success: false, error: "Você não tem permissão para criar papéis." };
    }
    
    try {
        await db.query(
            'INSERT INTO roles (workspace_id, name, description) VALUES ($1, $2, $3)',
            [workspaceId, name, description]
        );
        revalidatePath('/team/permissions');
        return { success: true };
    } catch (error) {
        console.error("Erro ao criar papel:", error);
        // @ts-ignore
        if (error.code === '23505') { // Unique constraint violation
            return { success: false, error: "Já existe um papel com este nome neste workspace."};
        }
        return { success: false, error: "Falha ao criar o papel no banco de dados." };
    }
}

export async function updateRoleAction(prevState: any, formData: FormData): Promise<{ success: boolean; error?: string }> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: "Usuário não autenticado." };

    const roleId = formData.get('roleId') as string;
    const name = formData.get('name') as string;
    const description = formData.get('description') as string;
    const workspaceId = formData.get('workspaceId') as string;

    if (!roleId || !name || !workspaceId) {
        return { success: false, error: "ID do papel, nome e ID do workspace são obrigatórios." };
    }

    if (!await hasPermission(user.id, workspaceId, 'permissions:edit')) {
        return { success: false, error: "Você não tem permissão para editar papéis." };
    }
    
    const roleCheck = await db.query('SELECT name FROM roles WHERE id = $1', [roleId]);
    if (roleCheck.rows[0]?.name === 'Administrador') {
        return { success: false, error: "Não é possível editar o papel de Administrador." };
    }

    try {
        await db.query(
            'UPDATE roles SET name = $1, description = $2 WHERE id = $3 AND workspace_id = $4',
            [name, description, roleId, workspaceId]
        );
        revalidatePath('/team/permissions');
        return { success: true };
    } catch (error) {
        console.error("Erro ao atualizar papel:", error);
        return { success: false, error: "Falha ao atualizar o papel no banco de dados." };
    }
}

export async function deleteRoleAction(roleId: string, workspaceId: string): Promise<{ success: boolean; error?: string }> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: "Usuário não autenticado." };

    if (!await hasPermission(user.id, workspaceId, 'permissions:edit')) {
        return { success: false, error: "Você não tem permissão para remover papéis." };
    }
    
    try {
        const roleCheck = await db.query('SELECT name, is_default FROM roles WHERE id = $1', [roleId]);
        if (roleCheck.rows[0]?.name === 'Administrador' || roleCheck.rows[0]?.is_default) {
            return { success: false, error: "Não é possível remover papéis padrão ou o papel de Administrador." };
        }

        // Check if role has users assigned
        const usersInRoleCheck = await db.query('SELECT 1 FROM user_workspace_roles WHERE role_id = $1 LIMIT 1', [roleId]);
        if (usersInRoleCheck.rowCount > 0) {
            return { success: false, error: "Não é possível remover um papel que ainda possui membros." };
        }

        // Check if role is assigned to a team
        const teamsWithRoleCheck = await db.query('SELECT 1 FROM teams WHERE role_id = $1 LIMIT 1', [roleId]);
        if (teamsWithRoleCheck.rowCount > 0) {
            return { success: false, error: "Não é possível remover um papel que está atribuído a uma equipe." };
        }


        await db.query('DELETE FROM roles WHERE id = $1', [roleId]);
        revalidatePath('/team/permissions');
        return { success: true };
    } catch (error) {
        console.error("Erro ao remover papel:", error);
        return { success: false, error: "Falha ao remover o papel no banco de dados." };
    }
}

    