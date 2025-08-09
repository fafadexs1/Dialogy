
'use server';

import { db } from '@/lib/db';
import type { Role, Permission } from '@/lib/types';
import { revalidatePath } from 'next/cache';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';

// Helper function to check for admin permissions
async function hasPermission(userId: string, workspaceId: string, permission: string): Promise<boolean> {
    const res = await db.query(`
        SELECT 1
        FROM user_workspace_roles uwr
        JOIN role_permissions rp ON uwr.role_id = rp.role_id
        WHERE uwr.user_id = $1 AND uwr.workspace_id = $2 AND rp.permission_id = $3
    `, [userId, workspaceId, permission]);
    return res.rowCount > 0;
}

export async function getRolesAndPermissions(workspaceId: string): Promise<{ roles: Role[], permissions: Permission[] }> {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id || !await hasPermission(session.user.id, workspaceId, 'permissions:view')) {
        throw new Error("Acesso não autorizado.");
    }
    
    try {
        const rolesRes = await db.query('SELECT id, name, description FROM roles WHERE workspace_id = $1 ORDER BY name', [workspaceId]);
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
            ...role,
            permissions: rolePermissionsRes.rows
                .filter(rp => rp.role_id === role.id)
                .map(({ id, description, category }) => ({ id, description, category }))
        }));
        
        return { roles, permissions };
    } catch (error) {
        console.error("Erro ao buscar papéis e permissões:", error);
        throw new Error("Falha ao buscar dados do banco de dados.");
    }
}

export async function updateRolePermissions(roleId: string, permissionId: string, enabled: boolean): Promise<{ success: boolean; error?: string }> {
     const session = await getServerSession(authOptions);
     if (!session?.user?.id) return { success: false, error: "Usuário não autenticado." };

    try {
        // First, get the workspaceId from the role
        const roleRes = await db.query('SELECT workspace_id FROM roles WHERE id = $1', [roleId]);
        if (roleRes.rowCount === 0) {
            return { success: false, error: "Papel não encontrado." };
        }
        const workspaceId = roleRes.rows[0].workspace_id;
        
        if (!await hasPermission(session.user.id, workspaceId, 'permissions:edit')) {
            return { success: false, error: "Acesso não autorizado." };
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

    