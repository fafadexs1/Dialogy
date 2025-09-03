

'use server';

import { db } from '@/lib/db';
import type { Shortcut } from '@/lib/types';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

async function hasAdminPermission(userId: string, workspaceId: string): Promise<boolean> {
    const res = await db.query(`
        SELECT 1
        FROM user_workspace_roles uwr
        JOIN roles r ON uwr.role_id = r.id
        WHERE uwr.user_id = $1 AND uwr.workspace_id = $2 AND r.name = 'Administrador'
    `, [userId, workspaceId]);
    return res.rowCount > 0;
}

export async function getShortcuts(workspaceId: string): Promise<{ shortcuts: Shortcut[] | null, error?: string }> {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { shortcuts: null, error: "Usuário não autenticado." };
    const userId = user.id;

    try {
        const res = await db.query(`
            SELECT 
                s.*,
                u.full_name as user_name
            FROM shortcuts s
            JOIN users u ON s.user_id = u.id
            WHERE s.workspace_id = $1 AND (s.type = 'global' OR s.user_id = $2)
            ORDER BY s.type, s.name
        `, [workspaceId, userId]);
        
        return { shortcuts: res.rows };
    } catch (error) {
        console.error("[GET_SHORTCUTS] Error:", error);
        return { shortcuts: null, error: "Falha ao buscar atalhos." };
    }
}


export async function saveShortcut(prevState: any, formData: FormData): Promise<{ success: boolean; error?: string | null; }> {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: "Usuário não autenticado." };
    const userId = user.id;

    const id = formData.get('id') as string | null;
    // Garante que o nome seja salvo em minúsculas e sem a barra inicial
    const name = (formData.get('name') as string)?.trim().replace(/^\//, '').toLowerCase(); 
    const message = formData.get('message') as string;
    const type = formData.get('type') as 'global' | 'private';
    const workspaceId = formData.get('workspaceId') as string;

    if (!name || !message || !type || !workspaceId) {
        return { success: false, error: "Todos os campos são obrigatórios." };
    }

    try {
        if (id) {
            // Update
            const shortcutRes = await db.query('SELECT user_id, type FROM shortcuts WHERE id = $1', [id]);
            if (shortcutRes.rowCount === 0) return { success: false, error: "Atalho não encontrado."};
            const { user_id: ownerId, type: oldType } = shortcutRes.rows[0];

            // Permission check: only owner or admin can edit
            const isAdmin = await hasAdminPermission(userId, workspaceId);
            if (userId !== ownerId && !isAdmin) {
                 return { success: false, error: "Você não tem permissão para editar este atalho." };
            }
             // Admins can change type, but owners of private shortcuts can't make them global
            if (type === 'global' && userId === ownerId && !isAdmin && oldType === 'private') {
                return { success: false, error: 'Apenas administradores podem criar atalhos globais.' };
            }

            await db.query(
                `UPDATE shortcuts 
                 SET name = $1, message = $2, type = $3, updated_at = NOW() 
                 WHERE id = $4 AND workspace_id = $5`,
                [name, message, type, id, workspaceId]
            );

        } else {
            // Create
            if (type === 'global' && !await hasAdminPermission(userId, workspaceId)) {
                return { success: false, error: 'Apenas administradores podem criar atalhos globais.' };
            }
            
            await db.query(
                'INSERT INTO shortcuts (workspace_id, user_id, name, message, type, updated_at) VALUES ($1, $2, $3, $4, $5, NOW())',
                [workspaceId, userId, name, message, type]
            );
        }

        revalidatePath('/settings/shortcuts');
        return { success: true, error: null };
    } catch (error: any) {
        console.error("[SAVE_SHORTCUT] Detailed Error:", error);
         if (error.code === '23505') { // unique_violation
            return { success: false, error: "Já existe um atalho com este nome. Os atalhos devem ter nomes únicos (seja global ou privado)." };
        }
        return { success: false, error: `Falha ao salvar atalho no banco de dados. Detalhe: ${error.message}` };
    }
}


export async function deleteShortcut(shortcutId: string): Promise<{ success: boolean; error?: string }> {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: "Usuário não autenticado." };
    const userId = user.id;
    
    try {
        const shortcutRes = await db.query('SELECT user_id, workspace_id FROM shortcuts WHERE id = $1', [shortcutId]);
        if (shortcutRes.rowCount === 0) return { success: false, error: "Atalho não encontrado."};
        
        const { user_id: ownerId, workspace_id: workspaceId } = shortcutRes.rows[0];
        
        // Permission check: only owner or admin can delete
        const isAdmin = await hasAdminPermission(userId, workspaceId);
        if (userId !== ownerId && !isAdmin) {
             return { success: false, error: "Você não tem permissão para remover este atalho." };
        }

        await db.query('DELETE FROM shortcuts WHERE id = $1', [shortcutId]);
        revalidatePath('/settings/shortcuts');
        return { success: true };
    } catch(error) {
        console.error("[DELETE_SHORTCUT] Error:", error);
        return { success: false, error: "Falha ao excluir o atalho." };
    }
}
