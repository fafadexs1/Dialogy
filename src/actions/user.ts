

'use server';

import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import type { InterfaceTheme, OnlineAgent, User } from '@/lib/types';
import { revalidatePath } from 'next/cache';
import { cache } from 'react';
import { getPresenceTtlSeconds, type PresenceEventSource } from '@/lib/presence';
import {
    getOnlineAgents as getOnlineAgentsFromPresence,
    sweepStalePresence as sweepStalePresenceFromPresence,
    touchUserPresenceActivity as touchUserPresenceActivityFromPresence,
    touchUserPresenceFromChat as touchUserPresenceFromChatInternal,
    updateUserOnlineStatus as updateUserOnlineStatusInPresence,
} from '@/lib/presence-server';
import { normalizePlanKey } from '@/lib/plans';
import { normalizeSupabaseStorageUrl } from '@/lib/storage-url';
import { normalizeInterfaceTheme } from '@/lib/theme';

const FALLBACK_TIMEZONE = 'America/Sao_Paulo';

export async function sweepStalePresence(workspaceId?: string): Promise<number> {
    return sweepStalePresenceFromPresence(workspaceId);
}

/**
 * Persist workspace-level presence so that server-side flows (e.g., load-balancing)
 * can reason about which agents are currently online.
 */
export async function updateUserOnlineStatus(
    userId: string,
    workspaceId: string,
    isOnline: boolean,
    tabId?: string,
    forceOffline: boolean = false,
    source: PresenceEventSource = 'api'
): Promise<void> {
    await updateUserOnlineStatusInPresence(userId, workspaceId, isOnline, tabId, forceOffline, source);
}

export async function touchUserPresenceActivity(
    userId: string,
    workspaceId: string,
    tabId?: string | null,
    source: PresenceEventSource = 'activity'
): Promise<void> {
    await touchUserPresenceActivityFromPresence(userId, workspaceId, tabId, source);
}

export async function touchUserPresenceFromChat(
    userId: string,
    chatId: string,
    tabId?: string | null,
    source: PresenceEventSource = 'activity'
): Promise<void> {
    await touchUserPresenceFromChatInternal(userId, chatId, tabId, source);
}


export async function getOnlineAgents(workspaceId: string): Promise<OnlineAgent[]> {
    if (!workspaceId) {
        console.error('[GET_ONLINE_AGENTS] Workspace ID não fornecido.');
        return [];
    }

    try {
        const ttlSeconds = getPresenceTtlSeconds();
        // REMOVED: await sweepStalePresence(workspaceId); 
        // Optimization: The query below already filters by last_seen, so we don't need to write to DB (update stale) on every read polling.
        // Stale presence will be cleaned up eventually by other updates or we can move this to a less frequent triggers.
        const res = await db.query(
            `
            SELECT
                u.id,
                u.full_name,
                u.avatar_url,
                u.email,
                u.is_superadmin,
                uwp.online_since,
                t.name as team_name,
                r.name as role_name
            FROM user_workspace_presence uwp
            JOIN users u ON u.id = uwp.user_id
            LEFT JOIN team_members tm ON u.id = tm.user_id
            LEFT JOIN teams t ON tm.team_id = t.id AND t.workspace_id = uwp.workspace_id
            LEFT JOIN user_workspace_roles uwr ON u.id = uwr.user_id AND uwr.workspace_id = uwp.workspace_id
            LEFT JOIN roles r ON uwr.role_id = r.id
            WHERE uwp.workspace_id = $1 
            AND uwp.is_online = TRUE
            AND uwp.last_seen > NOW() - ($2 * interval '1 second')
            `,
            [workspaceId, ttlSeconds]
        );

        return res.rows.map((row): OnlineAgent => {
            const normalizedAvatar = normalizeSupabaseStorageUrl(row.avatar_url);
            return {
                user: {
                    id: row.id,
                    name: row.full_name,
                    email: row.email,
                    avatar_url: normalizedAvatar || undefined,
                    avatar: normalizedAvatar || undefined,
                    is_superadmin: row.is_superadmin,
                    firstName: row.full_name?.split(' ')[0] ?? row.full_name,
                    lastName: row.full_name?.split(' ').slice(1).join(' ') ?? '',
                    team: row.team_name || undefined,
                    role: row.role_name ? { name: row.role_name } as any : undefined,
                },
                joined_at: row.online_since ?? new Date().toISOString(),
            };
        });
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

export async function updateUserThemePreference(themePreference: InterfaceTheme): Promise<{ success: boolean; error?: string | null }> {
    const normalizedTheme = normalizeInterfaceTheme(themePreference);
    if (!normalizedTheme) {
        return { success: false, error: 'Tema inválido.' };
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        return { success: false, error: 'Usuário não autenticado.' };
    }

    const { error } = await supabase.auth.updateUser({
        data: {
            theme_preference: normalizedTheme,
        }
    });

    if (error) {
        console.error('[UPDATE_USER_THEME_PREFERENCE] Erro:', error);
        return { success: false, error: 'Falha ao atualizar a preferência de tema.' };
    }

    revalidatePath('/settings/profile');
    revalidatePath('/', 'layout');

    return { success: true, error: null };
}

export const getCurrentUser = cache(async function getCurrentUser(): Promise<User | null> {
    const supabase = await createClient();
    const { data: { user: authUser } } = await supabase.auth.getUser();

    if (!authUser) {
        return null;
    }

    try {
        const userRes = await db.query('SELECT * FROM users WHERE id = $1', [authUser.id]);

        if (userRes.rowCount === 0) {
            return null;
        }
        const dbUser = userRes.rows[0];
        const themePreference = normalizeInterfaceTheme(authUser.user_metadata?.theme_preference);

        const workspacesRes = await db.query(`
            SELECT w.id, w.name, w.avatar_url, w.owner_id, w.nexus_settings, 
                   w.close_message_template, w.transfer_team_message_template,
                   w.timezone, w.marketing_auto_close_seconds, w.queue_auto_close_seconds,
                   r.name as role_name,
                   (SELECT plan FROM billing_info WHERE workspace_id = w.id LIMIT 1) as plan
            FROM workspaces w
            JOIN user_workspace_roles uwr ON w.id = uwr.workspace_id
            LEFT JOIN roles r ON uwr.role_id = r.id
            WHERE uwr.user_id = $1
        `, [authUser.id]);

        const workspaces = workspacesRes.rows.map((r: any) => {
            const normalizedWorkspaceAvatar = normalizeSupabaseStorageUrl(r.avatar_url);
            // Normalize plan key (same logic as /api/user/route.ts)
            const planKey = normalizePlanKey(r.plan);

            return {
                id: r.id,
                name: r.name,
                avatar: normalizedWorkspaceAvatar || '',
                isOwner: r.owner_id === authUser.id,
                roleName: r.role_name,
                nexus_settings: r.nexus_settings || {},
                closeMessageTemplate: r.close_message_template || '',
                transferTeamMessageTemplate: r.transfer_team_message_template || '',
                timezone: r.timezone || undefined,
                marketingAutoCloseSeconds: r.marketing_auto_close_seconds ?? undefined,
                queueAutoCloseSeconds: r.queue_auto_close_seconds ?? undefined,
                plan: planKey,
            };
        });

        const activeWorkspaceId = dbUser.last_active_workspace_id || workspaces[0]?.id || null;
        let activeWorkspaceTimezone: string | undefined;
        if (activeWorkspaceId) {
            const tzRes = await db.query('SELECT timezone FROM workspaces WHERE id = $1 LIMIT 1', [activeWorkspaceId]);
            activeWorkspaceTimezone = tzRes.rows[0]?.timezone || FALLBACK_TIMEZONE;
        }

        return {
            id: dbUser.id,
            name: dbUser.full_name,
            firstName: dbUser.full_name.split(' ')[0] || '',
            lastName: dbUser.full_name.split(' ').slice(1).join(' ') || '',
            avatar: normalizeSupabaseStorageUrl(dbUser.avatar_url) || '',
            email: dbUser.email,
            workspaces,
            activeWorkspaceId,
            activeWorkspaceTimezone,
            themePreference,
        };

    } catch (error) {
        console.error('[GET_CURRENT_USER] Error fetching user:', error);
        return null;
    }
});
