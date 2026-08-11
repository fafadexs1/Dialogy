'use server';

import { db } from '@/lib/db';
import { getSystemSettings } from '@/lib/system-settings';
import { createClient } from '@/lib/supabase/server';
import { revalidatePath, revalidateTag } from 'next/cache';

async function checkSuperAdmin(userId: string): Promise<boolean> {
    const result = await db.query('SELECT is_superadmin FROM users WHERE id = $1', [userId]);
    return result.rows[0]?.is_superadmin === true;
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

// Public Action (Protected by Auth)
export async function getSystemSettingsAction(keys: string[]): Promise<{ [key: string]: string }> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user || !await checkSuperAdmin(user.id)) {
        return {};
    }

    try {
        return await getSystemSettings(keys);
    } catch (error) {
        console.error('[GET_SYSTEM_SETTINGS_ACTION] Error:', error);
        return {};
    }
}
