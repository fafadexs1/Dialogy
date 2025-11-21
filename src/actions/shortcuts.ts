

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
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { shortcuts: null, error: "Usuário não autenticado." };
    const userId = user.id;

    try {
        // Fetch shortcuts:
        // 1. Global shortcuts (visible to all)
        // 2. Private shortcuts (visible only to creator)
        // 3. Team shortcuts (visible to members of the team)
        const res = await db.query(`
            SELECT DISTINCT
                s.*,
                u.full_name as user_name,
                t.name as team_name
            FROM shortcuts s
            JOIN users u ON s.user_id = u.id
            LEFT JOIN teams t ON s.team_id = t.id
            LEFT JOIN team_members tm ON t.id = tm.team_id AND tm.user_id = $2
            WHERE s.workspace_id = $1 
            AND (
                s.type = 'global' 
                OR (s.type = 'private' AND s.user_id = $2)
                OR (s.type = 'team' AND tm.user_id IS NOT NULL)
            )
            ORDER BY s.type, s.name
        `, [workspaceId, userId]);

        return { shortcuts: res.rows };
    } catch (error) {
        console.error("[GET_SHORTCUTS] Error:", error);
        return { shortcuts: null, error: "Falha ao buscar atalhos." };
    }
}


export async function saveShortcut(prevState: any, formData: FormData): Promise<{ success: boolean; error?: string | null; }> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: "Usuário não autenticado." };
    const userId = user.id;

    const id = formData.get('id') as string | null;
    // Garante que o nome seja salvo em minúsculas e sem a barra inicial
    const name = (formData.get('name') as string)?.trim().replace(/^\//, '').toLowerCase();
    const message = formData.get('message') as string;
    const type = formData.get('type') as 'global' | 'private' | 'team';
    const workspaceId = formData.get('workspaceId') as string;
    const teamId = formData.get('teamId') as string | null;

    if (!name || !message || !type || !workspaceId) {
        return { success: false, error: "Todos os campos são obrigatórios." };
    }

    if (type === 'team' && !teamId) {
        return { success: false, error: "Selecione uma equipe para o atalho de equipe." };
    }

    try {
        if (id) {
            // Update
            const shortcutRes = await db.query('SELECT user_id, type FROM shortcuts WHERE id = $1', [id]);
            if (shortcutRes.rowCount === 0) return { success: false, error: "Atalho não encontrado." };
            const { user_id: ownerId } = shortcutRes.rows[0];

            // Permission check: 
            // - Global: Anyone can edit
            // - Private: Only owner or admin
            // - Team: Only owner or admin (or maybe team members? sticking to owner/admin for now for safety, or maybe just anyone in the team? Requirement says "Global... qualquer pessoa consegue editar". Doesn't explicitly say about Team. Let's keep Team restricted to owner/admin for now to avoid chaos, or maybe allow team members. Let's stick to owner/admin for non-global for now, unless it's Global).

            const isAdmin = await hasAdminPermission(userId, workspaceId);
            const isGlobal = type === 'global'; // New type
            const wasGlobal = shortcutRes.rows[0].type === 'global'; // Old type

            // If it IS global or WAS global, anyone can edit it (based on "qualquer pessoa consegue editar... um atalho global"). 
            // Actually, if it WAS global, anyone should be able to edit it. If it IS becoming global, maybe restricted? 
            // The requirement says "qualquer pessoa consegue editar ou remover um atalho global criado pelo usuário". 
            // This implies if it's global, it's open.

            if (!isGlobal && !wasGlobal) {
                if (userId !== ownerId && !isAdmin) {
                    return { success: false, error: "Você não tem permissão para editar este atalho." };
                }
            }

            await db.query(
                `UPDATE shortcuts 
                 SET name = $1, message = $2, type = $3, team_id = $4, updated_at = NOW() 
                 WHERE id = $5 AND workspace_id = $6`,
                [name, message, type, type === 'team' ? teamId : null, id, workspaceId]
            );

        } else {
            // Create
            // Anyone can create any type now? 
            // "Atalhos Globais agora podem ser por equipe, privado ou para todos"
            // Doesn't say only admins can create global. So removing the check.

            await db.query(
                'INSERT INTO shortcuts (workspace_id, user_id, name, message, type, team_id, updated_at) VALUES ($1, $2, $3, $4, $5, $6, NOW())',
                [workspaceId, userId, name, message, type, type === 'team' ? teamId : null]
            );
        }

        revalidatePath('/settings/shortcuts');
        return { success: true, error: null };
    } catch (error: any) {
        console.error("[SAVE_SHORTCUT] Detailed Error:", error);
        if (error.code === '23505') { // unique_violation
            return { success: false, error: "Já existe um atalho com este nome. Os atalhos devem ter nomes únicos." };
        }
        return { success: false, error: `Falha ao salvar atalho no banco de dados. Detalhe: ${error.message}` };
    }
}


export async function deleteShortcut(shortcutId: string): Promise<{ success: boolean; error?: string }> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: "Usuário não autenticado." };
    const userId = user.id;

    try {
        const shortcutRes = await db.query('SELECT user_id, workspace_id, type FROM shortcuts WHERE id = $1', [shortcutId]);
        if (shortcutRes.rowCount === 0) return { success: false, error: "Atalho não encontrado." };

        const { user_id: ownerId, workspace_id: workspaceId, type } = shortcutRes.rows[0];

        // Permission check: 
        // - Global: Anyone can delete
        // - Others: Only owner or admin
        const isAdmin = await hasAdminPermission(userId, workspaceId);

        if (type !== 'global') {
            if (userId !== ownerId && !isAdmin) {
                return { success: false, error: "Você não tem permissão para remover este atalho." };
            }
        }

        await db.query('DELETE FROM shortcuts WHERE id = $1', [shortcutId]);
        revalidatePath('/settings/shortcuts');
        return { success: true };
    } catch (error) {
        console.error("[DELETE_SHORTCUT] Error:", error);
        return { success: false, error: "Falha ao excluir o atalho." };
    }
}
