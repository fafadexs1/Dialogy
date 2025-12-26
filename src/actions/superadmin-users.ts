'use server';

import { db } from '@/lib/db';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import type { User } from '@/lib/types';

async function checkSuperAdmin(userId: string): Promise<boolean> {
    if (!userId) return false;
    const result = await db.query('SELECT is_superadmin FROM users WHERE id = $1', [userId]);
    return result.rows[0]?.is_superadmin === true;
}

export async function getUsers(page = 1, limit = 20, search = ''): Promise<{ users: User[], total: number, error?: string }> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user || !await checkSuperAdmin(user.id)) {
        return { users: [], total: 0, error: "Acesso não autorizado." };
    }

    try {
        const offset = (page - 1) * limit;
        let query = `
            SELECT 
                u.id, 
                u.full_name as name, 
                u.email, 
                u.avatar_url, 
                u.is_superadmin,
                u.created_at as "memberSince",
                (
                    SELECT COALESCE(json_agg(json_build_object(
                        'id', w.id, 
                        'name', w.name,
                        'plan', COALESCE(b.plan, 'starter'),
                        'role', r.name
                    )), '[]'::json)
                    FROM user_workspace_roles uwr
                    JOIN workspaces w ON uwr.workspace_id = w.id
                    LEFT JOIN billing_info b ON w.id = b.workspace_id
                    LEFT JOIN roles r ON uwr.role_id = r.id
                    WHERE uwr.user_id = u.id
                ) as workspaces_data
            FROM users u
        `;
        const params: any[] = [limit, offset];
        let countQuery = 'SELECT count(*) FROM users u';
        const countParams: any[] = [];

        if (search) {
            query += ` WHERE u.full_name ILIKE $3 OR u.email ILIKE $3`;
            countQuery += ` WHERE u.full_name ILIKE $1 OR u.email ILIKE $1`;
            params.push(`%${search}%`);
            countParams.push(`%${search}%`);
        }

        query += ` ORDER BY u.created_at DESC LIMIT $1 OFFSET $2`;

        const [usersRes, countRes] = await Promise.all([
            db.query(query, params),
            db.query(countQuery, countParams)
        ]);

        const total = parseInt(countRes.rows[0].count);

        // Map to User type (partial)
        const users: User[] = usersRes.rows.map(row => ({
            id: row.id,
            firstName: row.name?.split(' ')[0] || '',
            lastName: row.name?.split(' ').slice(1).join(' ') || '',
            name: row.name || 'Sem Nome',
            email: row.email,
            avatar_url: row.avatar_url,
            is_superadmin: row.is_superadmin,
            memberSince: row.memberSince?.toISOString(),
            workspaces: row.workspaces_data || [], // Now mapping actual workspaces
            role: undefined
        }));

        return { users, total };

    } catch (error: any) {
        console.error('[GET_USERS_ACTION]', error);
        return { users: [], total: 0, error: 'Falha ao buscar usuários.' };
    }
}

export async function toggleSuperAdmin(targetUserId: string, isSuperAdmin: boolean): Promise<{ success: boolean, error?: string }> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user || !await checkSuperAdmin(user.id)) {
        return { success: false, error: "Acesso não autorizado." };
    }

    // Prevent removing own superadmin status to avoid lockout (optional safety)
    if (targetUserId === user.id && !isSuperAdmin) {
        return { success: false, error: "Você não pode remover seu próprio acesso de superadmin." };
    }

    try {
        await db.query('UPDATE users SET is_superadmin = $1 WHERE id = $2', [isSuperAdmin, targetUserId]);
        revalidatePath('/superadmin/users');
        return { success: true };
    } catch (error: any) {
        console.error('[TOGGLE_SUPERADMIN]', error);
        return { success: false, error: 'Erro ao atualizar permissão.' };
    }
}

export async function createSuperAdminInvite(workspaceId: string): Promise<{ code: string | null, error?: string }> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user || !await checkSuperAdmin(user.id)) {
        return { code: null, error: "Acesso não autorizado." };
    }

    try {
        // Create a short lived invite code (e.g. 24h)
        const code = Math.random().toString(36).substring(2, 10).toUpperCase(); // Simple code gen

        await db.query(
            'INSERT INTO workspace_invites (workspace_id, code, created_by, expires_at, max_uses) VALUES ($1, $2, $3, NOW() + INTERVAL \'24 hours\', 1)',
            [workspaceId, code, user.id]
        );

        return { code };
    } catch (error: any) {
        console.error('[CREATE_SUPERADMIN_INVITE]', error);
        return { code: null, error: 'Falha ao criar convite.' };
    }
}

export async function deleteUser(userId: string): Promise<{ success: boolean, error?: string }> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user || !await checkSuperAdmin(user.id)) {
        return { success: false, error: "Acesso não autorizado." };
    }

    if (userId === user.id) {
        return { success: false, error: "Você não pode excluir sua própria conta." };
    }

    try {
        // 1. Delete from Supabase Auth (requires Service Role Key)
        // We need to create a separate admin client here because the default one is scoped to the user
        const { createClient: createAdminClient } = await import('@supabase/supabase-js');
        const adminSupabase = createAdminClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!,
            {
                auth: {
                    autoRefreshToken: false,
                    persistSession: false
                }
            }
        );

        const { error: authError } = await adminSupabase.auth.admin.deleteUser(userId);

        if (authError) {
            console.error('[DELETE_USER_AUTH]', authError);
            return { success: false, error: `Erro ao excluir do Supabase Auth: ${authError.message}` };
        }

        // 2. Delete from Database
        await db.query('DELETE FROM users WHERE id = $1', [userId]);

        revalidatePath('/superadmin/users');
        return { success: true };

    } catch (error: any) {
        console.error('[DELETE_USER]', error);
        return { success: false, error: 'Falha ao excluir usuário do banco de dados.' };
    }
}
