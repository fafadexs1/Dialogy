

'use server';

import { db } from '@/lib/db';
import { randomBytes } from 'crypto';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { WorkspaceInvite } from '@/lib/types';
import { createClient } from '@/lib/supabase/server';
import { cookies } from 'next/headers';


async function hasPermission(userId: string, workspaceId: string, permission: string): Promise<boolean> {
    const res = await db.query(`
        SELECT 1 FROM user_workspace_roles WHERE user_id = $1 AND workspace_id = $2
    `, [userId, workspaceId]);
    return res.rowCount > 0;
}


export async function createWorkspaceInvite(prevState: any, formData: FormData): Promise<string | null> {
    const supabase = createClient(cookies());
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return "Usuário não autenticado.";
    
    const workspaceId = formData.get('workspaceId') as string;
    const expiresInSeconds = Number(formData.get('expiresIn'));
    const maxUses = formData.get('maxUses') ? Number(formData.get('maxUses')) : null;

    if (!workspaceId || !expiresInSeconds) return "Parâmetros inválidos.";
    
    if (!await hasPermission(user.id, workspaceId, 'workspace:invites:manage')) {
        return "Você não tem permissão para criar convites.";
    }

    try {
        const code = randomBytes(4).toString('hex').toUpperCase();
        const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);

        await db.query(
            'INSERT INTO workspace_invites (workspace_id, code, created_by, expires_at, max_uses) VALUES ($1, $2, $3, $4, $5)',
            [workspaceId, code, user.id, expiresAt, maxUses]
        );
        
        revalidatePath('/settings/workspace');
        return null; // Success
    } catch (error) {
        console.error("[CREATE_INVITE] Error:", error);
        return "Falha no servidor ao criar o convite.";
    }
}

export async function getWorkspaceInvites(workspaceId: string): Promise<{invites: WorkspaceInvite[] | null, error?: string}> {
    const supabase = createClient(cookies());
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { invites: null, error: "Usuário não autenticado."};
    
    if (!await hasPermission(user.id, workspaceId, 'workspace:invites:manage')) {
        return { invites: null, error: "Acesso não autorizado." };
    }
    
    try {
        const res = await db.query(`
            SELECT 
                wi.id, 
                wi.code, 
                wi.expires_at, 
                wi.max_uses, 
                wi.is_revoked,
                COUNT(ui.invite_id) as use_count
            FROM workspace_invites wi
            LEFT JOIN user_invites ui ON wi.id = ui.invite_id
            WHERE wi.workspace_id = $1 AND wi.is_revoked = FALSE AND wi.expires_at > NOW()
            GROUP BY wi.id
            ORDER BY wi.created_at DESC
        `, [workspaceId]);

        return { invites: res.rows };

    } catch (error) {
        console.error("[GET_INVITES] Error:", error);
        return { invites: null, error: "Falha ao buscar convites."};
    }
}

export async function revokeWorkspaceInvite(inviteId: string): Promise<{success: boolean, error?: string}> {
    const supabase = createClient(cookies());
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: "Usuário não autenticado."};

    try {
        // First get workspace_id from invite to check permissions
        const inviteRes = await db.query('SELECT workspace_id FROM workspace_invites WHERE id = $1', [inviteId]);
        if(inviteRes.rowCount === 0) return { success: false, error: "Convite não encontrado."};
        
        const { workspace_id } = inviteRes.rows[0];
         if (!await hasPermission(user.id, workspace_id, 'workspace:invites:manage')) {
            return { success: false, error: "Você não tem permissão para gerenciar convites." };
        }

        await db.query('UPDATE workspace_invites SET is_revoked = TRUE WHERE id = $1', [inviteId]);
        revalidatePath('/settings/workspace');
        return { success: true };

    } catch (error) {
        console.error("[REVOKE_INVITE] Error:", error);
        return { success: false, error: "Falha no servidor ao revogar o convite." };
    }
}


export async function joinWorkspaceAction(prevState: any, formData: FormData): Promise<{ success: boolean; error: string | null }> {
    const supabase = createClient(cookies());
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        return { success: false, error: "Usuário não autenticado. Por favor, faça login novamente." };
    }
    const userId = user.id;
    const inviteCode = (formData.get('inviteCode') as string)?.trim().toUpperCase();

    if (!inviteCode) {
        return { success: false, error: "O código de convite é obrigatório." };
    }

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        // 1. Validate the invite code
        const inviteRes = await client.query(
            `SELECT 
                id, workspace_id, expires_at, max_uses, is_revoked, 
                (SELECT COUNT(*) FROM user_invites WHERE invite_id = wi.id) as use_count
             FROM workspace_invites wi 
             WHERE code = $1`, [inviteCode]
        );

        if (inviteRes.rowCount === 0) {
            return { success: false, error: "Código de convite inválido." };
        }
        const invite = inviteRes.rows[0];

        if (invite.is_revoked) {
            return { success: false, error: "Este convite foi revogado." };
        }
        if (new Date(invite.expires_at) < new Date()) {
            return { success: false, error: "Este convite expirou." };
        }
        if (invite.max_uses && invite.use_count >= invite.max_uses) {
            return { success: false, error: "O limite de usos para este convite foi atingido." };
        }
        
        const { workspace_id: workspaceId, id: inviteId } = invite;

        // 2. Check if user is already a member
        const memberCheck = await client.query(
            'SELECT 1 FROM user_workspace_roles WHERE user_id = $1 AND workspace_id = $2', [userId, workspaceId]
        );
        if (memberCheck.rowCount > 0) {
            return { success: false, error: "Você já é membro deste workspace." };
        }

        // 3. Add user to the workspace with the default 'Member' role
        const memberRoleRes = await client.query(
            "SELECT id FROM roles WHERE workspace_id = $1 AND is_default = TRUE", [workspaceId]
        );
        if (memberRoleRes.rowCount === 0) {
            throw new Error("Default 'Member' role not found for this workspace.");
        }
        const memberRoleId = memberRoleRes.rows[0].id;
        
        await client.query(
            'INSERT INTO user_workspace_roles (user_id, workspace_id, role_id) VALUES ($1, $2, $3)',
            [userId, workspaceId, memberRoleId]
        );

        // 4. Record the invite usage
        await client.query(
            'INSERT INTO user_invites (invite_id, user_id) VALUES ($1, $2)',
            [inviteId, userId]
        );
        
        // 5. Set the joined workspace as the user's active workspace
        await client.query(
            'UPDATE users SET last_active_workspace_id = $1 WHERE id = $2',
            [workspaceId, userId]
        );
        
        await client.query('COMMIT');
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('[JOIN_WORKSPACE] Error:', error);
        return { success: false, error: "Ocorreu um erro no servidor ao tentar entrar no workspace." };
    } finally {
        client.release();
    }
    
    revalidatePath('/', 'layout');
    redirect('/');
}
