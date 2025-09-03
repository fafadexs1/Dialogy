

'use server';

import { createClient } from '@/lib/supabase/server';
import { cookies } from 'next/headers';
import { db } from '@/lib/db';
import type { OnlineAgent, User } from '@/lib/types';
import { revalidatePath } from 'next/cache';


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
    const supabase = createClient(cookies());
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
            await db.query(
                'UPDATE users SET full_name = $1, avatar_url = $2, updated_at = NOW() WHERE id = $3',
                [updates.full_name, updates.avatar_url, user.id]
            );
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