
'use server';

import { db } from '@/lib/db';
import { revalidatePath } from 'next/cache';
import type { Integration } from '@/lib/types';
import { createClient } from '@/lib/supabase/server';

async function checkSuperAdmin(userId: string): Promise<boolean> {
    if (!userId) return false;
    const result = await db.query('SELECT is_superadmin FROM users WHERE id = $1', [userId]);
    return result.rows[0]?.is_superadmin === true;
}

export async function getIntegrations(): Promise<{ integrations: Integration[] | null; error?: string }> {
    try {
        const result = await db.query('SELECT * FROM app_integrations ORDER BY name');
        return { integrations: result.rows };
    } catch (error: any) {
        console.error('[GET_INTEGRATIONS_ACTION]', error);
        return { integrations: null, error: 'Falha ao buscar integrações do banco de dados.' };
    }
}

export async function updateIntegration(data: Integration): Promise<{ success: boolean; error?: string }> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user || !await checkSuperAdmin(user.id)) {
        return { success: false, error: "Acesso não autorizado." };
    }
    
    try {
        await db.query(
            `UPDATE app_integrations 
             SET name = $1, description = $2, icon_url = $3, tag = $4, tag_type = $5
             WHERE id = $6`,
            [data.name, data.description, data.icon_url, data.tag, data.tag_type, data.id]
        );
        revalidatePath('/integrations');
        revalidatePath('/superadmin/plans');
        return { success: true };
    } catch(error: any) {
        console.error('[UPDATE_INTEGRATION_ACTION]', error);
        return { success: false, error: 'Falha ao atualizar a integração.' };
    }
}
