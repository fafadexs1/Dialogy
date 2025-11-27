
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
        const integrations = result.rows;

        // Inject Gemini integration if not present
        if (!integrations.find((i: Integration) => i.tag === 'Gemini')) {
            integrations.push({
                id: 'gemini-integration',
                name: 'Google Gemini',
                description: 'Configure sua própria chave de API e escolha o modelo do Gemini para as Respostas Inteligentes.',
                icon_url: 'https://www.gstatic.com/lamda/images/gemini_sparkle_v002_d4735304ff6292a690345.svg',
                href: '/integrations/gemini',
                status: 'active',
                tag: 'Gemini',
                tag_type: 'primary',
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            } as Integration);
        }

        return { integrations };
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
    } catch (error: any) {
        console.error('[UPDATE_INTEGRATION_ACTION]', error);
        return { success: false, error: 'Falha ao atualizar a integração.' };
    }
}
