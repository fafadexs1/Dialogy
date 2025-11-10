

'use server';

import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import type { OnlineAgent, User } from '@/lib/types';
import { revalidatePath } from 'next/cache';

/**
 * DEPRECATED: This function is no longer used. Presence is handled by Supabase Realtime.
 */
export async function updateUserOnlineStatus(userId: string, isOnline: boolean): Promise<void> {
    try {
        // This function is kept to avoid breaking changes if old clients still call it, but it does nothing.
        console.warn(`[DEPRECATED] updateUserOnlineStatus foi chamada para o usuário ${userId}, mas esta função foi descontinuada.`);
    } catch (error) {
        console.error(`[UPDATE_USER_STATUS] Failed to update online status for user ${userId}:`, error);
        // Do not throw an error, as this is often a background task.
    }
}


export async function getOnlineAgents(workspaceId: string): Promise<OnlineAgent[]> {
    if (!workspaceId) {
        console.error('[GET_ONLINE_AGENTS] Workspace ID não fornecido.');
        return [];
    }
    
    // NOTE: This function no longer gets online status from the database.
    // It is kept for compatibility but will likely be deprecated.
    // Presence is now handled in real-time by the client via Supabase channels.
    // We will return an empty array as the client will populate this itself.
    return [];
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
