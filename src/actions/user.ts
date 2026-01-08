

'use server';

import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import type { OnlineAgent, User } from '@/lib/types';
import { revalidatePath } from 'next/cache';
import { cache } from 'react';
import { getPresenceTtlSeconds } from '@/lib/presence';

const FALLBACK_TIMEZONE = 'America/Sao_Paulo';

async function ensurePresenceMetadataColumn() {
    await db.query(`
        ALTER TABLE user_workspace_presence
        ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;
    `);
}

export async function sweepStalePresence(workspaceId?: string): Promise<number> {
    const ttlSeconds = getPresenceTtlSeconds();
    const params: Array<string | number> = [];
    let workspaceClause = '';
    if (workspaceId) {
        params.push(workspaceId);
        workspaceClause = `AND workspace_id = $1`;
    }

    await ensurePresenceMetadataColumn();

    const result = await db.query(
        `
        UPDATE user_workspace_presence
        SET
            is_online = FALSE,
            online_since = NULL,
            metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{active_sessions}', '{}'::jsonb, true)
        WHERE is_online = TRUE
          ${workspaceClause}
          AND last_seen < NOW() - ($${params.length + 1} * interval '1 second')
        `,
        [...params, ttlSeconds]
    );

    return result.rowCount ?? 0;
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
    forceOffline: boolean = false
): Promise<void> {
    if (!userId || !workspaceId) {
        console.warn('[UPDATE_USER_STATUS] Missing userId or workspaceId.');
        return;
    }

    try {
        const ttlSeconds = getPresenceTtlSeconds();
        const nowIso = new Date().toISOString();

        await ensurePresenceMetadataColumn();
        await sweepStalePresence(workspaceId);

        // 2. Perform Atomic Update with Session Logic
        // Logic:
        // - Retrieve current map of { tabId: timestamp } from metadata->'active_sessions'
        // - Filter out stale sessions (older than TTL)
        // - If tabId provided:
        //    - If isOnline=true: Upsert tabId with NOW()
        //    - If isOnline=false: Remove tabId
        // - Determine is_online: count(remaining_sessions) > 0

        const query = `
        INSERT INTO user_workspace_presence (user_id, workspace_id, is_online, online_since, last_seen, metadata)
        VALUES ($1, $2, $3, CASE WHEN $3 THEN NOW() ELSE NULL END, NOW(), $4)
        ON CONFLICT (user_id, workspace_id)
        DO UPDATE SET
            last_seen = NOW(),
            metadata = (
                SELECT 
                    jsonb_build_object(
                         'active_sessions',
                         COALESCE(
                            (
                                SELECT jsonb_object_agg(key, value)
                                FROM jsonb_each_text(COALESCE(user_workspace_presence.metadata->'active_sessions', '{}'::jsonb))
                                WHERE 
                                    -- Prune stale sessions (older than TTL)
                                    (value::timestamp > (NOW() - INTERVAL '${ttlSeconds} seconds'))
                                    -- AND remove current tabId if setting offline
                                    AND ($6 = FALSE OR key != $5)
                            ),
                            '{}'::jsonb
                         ) 
                         || 
                         -- Add/Update current tabId if Online
                         CASE 
                             WHEN $6 = TRUE THEN jsonb_build_object($5, NOW())
                             ELSE '{}'::jsonb
                         END
                    )
            ),
            is_online = (
                SELECT COUNT(*) > 0
                FROM jsonb_each_text(
                    COALESCE(
                        (
                            SELECT jsonb_object_agg(key, value)
                            FROM jsonb_each_text(COALESCE(user_workspace_presence.metadata->'active_sessions', '{}'::jsonb))
                            WHERE 
                                (value::timestamp > (NOW() - INTERVAL '${ttlSeconds} seconds'))
                                AND ($6 = FALSE OR key != $5)
                        ),
                        '{}'::jsonb
                    ) 
                    || 
                    CASE 
                         WHEN $6 = TRUE THEN jsonb_build_object($5, NOW())
                         ELSE '{}'::jsonb
                    END
                )
            ),
            online_since = CASE
                -- If it WAS offline and NOW becomes online (based on logic above), set online_since
                -- Logic: If the NEW is_online state is true and old was false (or null), set NOW().
                -- Simplification: If resulting is_online is TRUE, keep existing online_since OR set to NOW() if null.
                -- However, in a complex single query, referencing the "new" value is hard.
                -- We approximate: If we are adding a session and it was empty effectively, it's a new start.
                -- For simplicity, we keep existing valid online_since or set new if it was null.
                WHEN (
                    SELECT COUNT(*) > 0
                    FROM jsonb_each_text( ...same logic... ) 
                    -- (Omitting full repetition for brevity in comments, handled by simple coalesce below)
                ) THEN COALESCE(user_workspace_presence.online_since, NOW())
                ELSE NULL
            END; 
        `;

        // Simplified Query using a Function or just simpler Logic in JS?
        // JS Logic is safer and easier to debug than complex SQL JSON manipulation regarding types.
        // Let's do Read-Modify-Write in a Transaction. It's safe enough for presence (low contention per user).

        await db.query('BEGIN');

        // A. Read current state
        const readRes = await db.query(
            `SELECT metadata FROM user_workspace_presence WHERE user_id = $1 AND workspace_id = $2 FOR UPDATE`,
            [userId, workspaceId]
        );

        let metadata = readRes.rows[0]?.metadata || {};
        let activeSessions: Record<string, string> = metadata.active_sessions || {};

        // B. Update Logic
        const threshold = new Date(Date.now() - ttlSeconds * 1000).getTime();

        // Prune stale
        const nextSessions: Record<string, string> = {};
        for (const [tid, ts] of Object.entries(activeSessions)) {
            if (new Date(ts as string).getTime() > threshold) {
                nextSessions[tid] = ts as string;
            }
        }

        // Handle current Tab
        if (forceOffline) {
            Object.keys(nextSessions).forEach((key) => delete nextSessions[key]);
        } else if (tabId) {
            if (isOnline) {
                nextSessions[tabId] = nowIso;
            } else {
                delete nextSessions[tabId];
            }
        } else {
            // Legacy/Fallback (no tabID): single default session
            if (isOnline) {
                nextSessions['default'] = nowIso;
            } else {
                delete nextSessions['default'];
            }
        }

        const sessionCount = Object.keys(nextSessions).length;
        const newIsOnline = !forceOffline && sessionCount > 0;

        metadata.active_sessions = nextSessions;

        // C. Update DB
        await db.query(
            `
            INSERT INTO user_workspace_presence (user_id, workspace_id, is_online, online_since, last_seen, metadata)
            VALUES ($1, $2, $3, CASE WHEN $3 THEN NOW() ELSE NULL END, NOW(), $4)
            ON CONFLICT (user_id, workspace_id)
            DO UPDATE SET
                is_online = $3,
                last_seen = NOW(),
                metadata = $4,
                online_since = CASE 
                    WHEN $3 THEN COALESCE(user_workspace_presence.online_since, NOW())
                    ELSE NULL
                END
            `,
            [userId, workspaceId, newIsOnline, metadata]
        );

        await db.query('COMMIT');

    } catch (error) {
        await db.query('ROLLBACK').catch(() => { }); // prevent throwing if no tx
        console.error(`[UPDATE_USER_STATUS] Failed to update online status for user ${userId}:`, error);
    }
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

        return res.rows.map((row): OnlineAgent => ({
            user: {
                id: row.id,
                name: row.full_name,
                email: row.email,
                avatar_url: row.avatar_url,
                avatar: row.avatar_url,
                is_superadmin: row.is_superadmin,
                firstName: row.full_name?.split(' ')[0] ?? row.full_name,
                lastName: row.full_name?.split(' ').slice(1).join(' ') ?? '',
                team: row.team_name || undefined,
                role: row.role_name ? { name: row.role_name } as any : undefined,
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

        const workspacesRes = await db.query(`
            SELECT w.id, w.name, w.avatar_url, w.owner_id, w.nexus_settings, 
                   w.close_message_template, w.transfer_team_message_template,
                   w.timezone, w.marketing_auto_close_seconds,
                   r.name as role_name,
                   (SELECT plan FROM billing_info WHERE workspace_id = w.id LIMIT 1) as plan
            FROM workspaces w
            JOIN user_workspace_roles uwr ON w.id = uwr.workspace_id
            LEFT JOIN roles r ON uwr.role_id = r.id
            WHERE uwr.user_id = $1
        `, [authUser.id]);

        const workspaces = workspacesRes.rows.map((r: any) => {
            // Normalize plan key (same logic as /api/user/route.ts)
            const rawPlan = r.plan;
            let planKey = 'starter';
            if (rawPlan) {
                const normalizedPlan = rawPlan.toLowerCase();
                // Check known plan keys
                if (['starter', 'growth', 'pro', 'enterprise'].includes(normalizedPlan)) {
                    planKey = normalizedPlan;
                } else {
                    planKey = rawPlan; // Keep original for debugging
                }
            }

            return {
                id: r.id,
                name: r.name,
                avatar: r.avatar_url || '',
                isOwner: r.owner_id === authUser.id,
                roleName: r.role_name,
                nexus_settings: r.nexus_settings || {},
                closeMessageTemplate: r.close_message_template || '',
                transferTeamMessageTemplate: r.transfer_team_message_template || '',
                timezone: r.timezone || undefined,
                marketingAutoCloseSeconds: r.marketing_auto_close_seconds ?? undefined,
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
            avatar: dbUser.avatar_url || '',
            email: dbUser.email,
            workspaces,
            activeWorkspaceId,
            activeWorkspaceTimezone,
        };

    } catch (error) {
        console.error('[GET_CURRENT_USER] Error fetching user:', error);
        return null;
    }
});
