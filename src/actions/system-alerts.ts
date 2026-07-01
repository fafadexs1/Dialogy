'use server';

import { db } from '@/lib/db';
import {
    GLOBAL_ALERT_REALTIME_EVENT,
    GLOBAL_ALERT_REALTIME_TOPIC,
    GlobalAlertSchema,
    globalAlertDefaultConfig,
    type GlobalAlertConfig,
} from '@/lib/system-alerts';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { revalidatePath, revalidateTag, unstable_cache } from 'next/cache';

const ALERT_KEY = 'global_inbox_alert';

const defaultAlert: GlobalAlertConfig = {
    ...globalAlertDefaultConfig,
};

function parseAlertConfig(raw: unknown): GlobalAlertConfig {
    const parsed = GlobalAlertSchema.safeParse({
        ...defaultAlert,
        ...(raw && typeof raw === 'object' ? raw : {}),
    });

    if (!parsed.success) {
        console.error('[GLOBAL_ALERT] Invalid alert config:', parsed.error.flatten());
        return defaultAlert;
    }

    return parsed.data;
}

async function checkSuperAdmin(userId: string): Promise<boolean> {
    const result = await db.query('SELECT is_superadmin FROM users WHERE id = $1', [userId]);
    return result.rows[0]?.is_superadmin === true;
}

async function broadcastGlobalAlert(alert: GlobalAlertConfig): Promise<void> {
    try {
        await getSupabaseAdmin()
            .channel(GLOBAL_ALERT_REALTIME_TOPIC)
            .httpSend(GLOBAL_ALERT_REALTIME_EVENT, {
                alert,
                updatedAt: new Date().toISOString(),
            });
    } catch (error) {
        console.error('[GLOBAL_ALERT] Failed to broadcast alert update:', error);
    }
}

const getGlobalAlertCached = unstable_cache(
    async (): Promise<GlobalAlertConfig> => {
        try {
            const res = await db.query(`SELECT value FROM system_settings WHERE key = $1`, [ALERT_KEY]);
            if (res.rows.length === 0 || !res.rows[0].value) {
                return defaultAlert;
            }

            return parseAlertConfig(JSON.parse(res.rows[0].value));
        } catch (error) {
            console.error('[GET_GLOBAL_ALERT] Error parsing alert:', error);
            return defaultAlert;
        }
    },
    ['global-alert'],
    { tags: ['global-alert'], revalidate: false }
);

export async function getGlobalAlertAction(): Promise<GlobalAlertConfig> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        return defaultAlert;
    }

    return getGlobalAlertCached();
}

export async function saveGlobalAlertAction(config: GlobalAlertConfig): Promise<{ success: boolean; error?: string }> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user || !(await checkSuperAdmin(user.id))) {
        return { success: false, error: 'Acesso nao autorizado.' };
    }

    try {
        const parsedConfig = GlobalAlertSchema.safeParse({
            ...defaultAlert,
            ...(config && typeof config === 'object' ? config : {}),
        });

        if (!parsedConfig.success) {
            return {
                success: false,
                error: parsedConfig.error.issues[0]?.message || 'Configuracao invalida do comunicado.',
            };
        }

        const valueStr = JSON.stringify(parsedConfig.data);
        await db.query(`
            INSERT INTO system_settings (key, value)
            VALUES ($1, $2)
            ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()
        `, [ALERT_KEY, valueStr]);

        revalidatePath('/superadmin/alerts');
        revalidatePath('/inbox', 'layout');
        revalidateTag('global-alert', 'default' as any);
        await broadcastGlobalAlert(parsedConfig.data);
        return { success: true };
    } catch (error: any) {
        console.error('[SAVE_GLOBAL_ALERT] Error:', error);
        return { success: false, error: 'Falha ao salvar configuracao do recado.' };
    }
}
