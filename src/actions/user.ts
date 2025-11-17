

'use server';

import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import type { OnlineAgent, User } from '@/lib/types';
import { revalidatePath } from 'next/cache';

/**
 * Persist workspace-level presence so that server-side flows (e.g., load-balancing)
 * can reason about which agents are currently online.
 */
export async function updateUserOnlineStatus(userId: string, workspaceId: string, isOnline: boolean): Promise<void> {
    if (!userId || !workspaceId) {
        console.warn('[UPDATE_USER_STATUS] Missing userId or workspaceId.');
        return;
    }

    try {
        await db.query(
            `
            INSERT INTO user_workspace_presence (user_id, workspace_id, is_online, online_since, last_seen)
            VALUES ($1, $2, $3, CASE WHEN $3 THEN NOW() ELSE NULL END, NOW())
            ON CONFLICT (user_id, workspace_id)
            DO UPDATE SET
                is_online = EXCLUDED.is_online,
                online_since = CASE
                    WHEN EXCLUDED.is_online THEN COALESCE(user_workspace_presence.online_since, NOW())
                    ELSE NULL
                END,
                last_seen = NOW();
            `,
            [userId, workspaceId, isOnline]
        );
    } catch (error) {
        console.error(`[UPDATE_USER_STATUS] Failed to update online status for user ${userId}:`, error);
    }
}


export async function getOnlineAgents(workspaceId: string): Promise<OnlineAgent[]> {
    if (!workspaceId) {
        console.error('[GET_ONLINE_AGENTS] Workspace ID não fornecido.');
        return [];
    }

    try {
        const res = await db.query(
            `
            SELECT
                u.id,
                u.full_name,
                u.avatar_url,
                u.email,
                uwp.online_since
            FROM user_workspace_presence uwp
            JOIN users u ON u.id = uwp.user_id
            WHERE uwp.workspace_id = $1 AND uwp.is_online = TRUE
            `,
            [workspaceId]
        );

        return res.rows.map((row): OnlineAgent => ({
            user: {
                id: row.id,
                name: row.full_name,
                email: row.email,
                avatar_url: row.avatar_url,
                firstName: row.full_name?.split(' ')[0] ?? row.full_name,
                lastName: row.full_name?.split(' ').slice(1).join(' ') ?? '',
            },
            joined_at: row.online_since ?? new Date().toISOString(),
        }));
    } catch (error) {
        console.error('[GET_ONLINE_AGENTS] Error fetching presence data:', error);
        return [];
    }
}

export async function updateUserProfile(prevState: any, formData: FormData): Promise<{ success: boolean; error?: string | null; }> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        return { success: false, error: 'Usuário não autenticado.' };
    }

    const fullName = formData.get('fullName') as string;
    const avatarUrl = formData.get('avatarUrl') as string;

    const updates: { full_name?: string; avatar_url?: string } = {};
    if (fullName) updates.full_name = fullName;
    if (avatarUrl) updates.avatar_url = avatarUrl;
    
    // Update public.users table
    if (Object.keys(updates).length > 0) {
        try {
            // Only update fields that are provided
            const setClauses = Object.keys(updates).map((key, i) => `${key} = $${i + 1}`).join(', ');
            const values = Object.values(updates);

            if (setClauses) {
                 await db.query(
                    `UPDATE users SET ${setClauses}, updated_at = NOW() WHERE id = $${values.length + 1}`,
                    [...values, user.id]
                );
            }
           
        } catch (dbError: any) {
            console.error("[UPDATE_USER_PROFILE_DB] Erro:", dbError);
            return { success: false, error: 'Falha ao atualizar o perfil no banco de dados.' };
        }
    }
    
    // Update auth.users metadata
    const { error: authError } = await supabase.auth.updateUser({
        data: {
            full_name: fullName,
            avatar_url: avatarUrl,
        }
    });

    if (authError) {
        console.error("[UPDATE_USER_PROFILE_AUTH] Erro:", authError);
        return { success: false, error: 'Falha ao atualizar os metadados de autenticação.' };
    }

    revalidatePath('/settings/profile');
    revalidatePath('/', 'layout'); // Revalidate layout to update sidebar avatar/name

    return { success: true, error: null };
}
