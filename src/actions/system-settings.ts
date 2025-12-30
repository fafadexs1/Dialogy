'use server';

import { db } from '@/lib/db';
import { createClient } from '@/lib/supabase/server';
import { revalidatePath, revalidateTag, unstable_cache } from 'next/cache';

async function checkSuperAdmin(userId: string): Promise<boolean> {
    const result = await db.query('SELECT is_superadmin FROM users WHERE id = $1', [userId]);
    return result.rows[0]?.is_superadmin === true;
}

const getSystemSettingsCached = unstable_cache(
    async (keys: string[]): Promise<{ [key: string]: string }> => {
        const res = await db.query(`SELECT key, value FROM system_settings WHERE key = ANY($1)`, [keys]);
        const settings: { [key: string]: string } = {};
        res.rows.forEach(row => {
            settings[row.key] = row.value;
        });
        return settings;
    },
    ['system-settings'],
    { tags: ['system-settings'], revalidate: false }
);

function normalizeKeys(keys: string[]): string[] {
    return [...new Set(keys.filter(Boolean))].sort();
}

export async function saveSystemSettingAction(key: string, value: string): Promise<{ success: boolean, error?: string }> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user || !await checkSuperAdmin(user.id)) {
        return { success: false, error: "Acesso não autorizado." };
    }

    try {
        await db.query(`
            INSERT INTO system_settings (key, value) 
            VALUES ($1, $2)
            ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()
        `, [key, value]);

        revalidatePath('/superadmin/billing/settings');
        revalidateTag('system-settings', 'default');
        return { success: true };
    } catch (error: any) {
        console.error('[SAVE_SYSTEM_SETTING] Error:', error);
        return { success: false, error: 'Falha ao salvar configuração.' };
    }
}

// Internal function (No Auth Check) - Use with caution
export async function getSystemSettings(keys: string[]): Promise<{ [key: string]: string }> {
    try {
        const normalized = normalizeKeys(keys);
        if (!normalized.length) {
            return {};
        }
        return await getSystemSettingsCached(normalized);
    } catch (error) {
        console.error('[GET_SYSTEM_SETTINGS_INTERNAL] Error:', error);
        return {};
    }
}

// Public Action (Protected by Auth)
export async function getSystemSettingsAction(keys: string[]): Promise<{ [key: string]: string }> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user || !await checkSuperAdmin(user.id)) {
        return {};
    }

    return getSystemSettings(keys);
}
