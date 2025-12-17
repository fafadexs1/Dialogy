
'use server';

import { db } from '@/lib/db';
import { revalidatePath } from 'next/cache';
import type { Integration } from '@/lib/types';
import { createClient } from '@/lib/supabase/server';
import { availableIntegrations } from '@/lib/integrations';

const FALLBACK_ICON = '/integration-fallback.svg';

async function checkSuperAdmin(userId: string): Promise<boolean> {
    if (!userId) return false;
    const result = await db.query('SELECT is_superadmin FROM users WHERE id = $1', [userId]);
    return result.rows[0]?.is_superadmin === true;
}

export async function getIntegrations(): Promise<{ integrations: Integration[] | null; error?: string }> {
    try {
        const result = await db.query('SELECT * FROM app_integrations ORDER BY name');

        const integrations = result.rows;

        const knownIcons: Record<string, string> = {
            'Facebook Messenger': 'https://upload.wikimedia.org/wikipedia/commons/b/be/Facebook_Messenger_logo_2020.svg',
            'Instagram': 'https://upload.wikimedia.org/wikipedia/commons/a/a5/Instagram_icon.png',
            'WhatsApp': 'https://upload.wikimedia.org/wikipedia/commons/6/6b/WhatsApp.svg',
            'Google Gemini': 'https://www.gstatic.com/lamda/images/gemini_sparkle_v002_d4735304ff6292a690345.svg',
            'Mercado Livre': 'https://http2.mlstatic.com/frontend-assets/ml-web-navigation/ui-navigation/5.21.22/mercadolibre/logo__large_plus.png'
        };

        const fallbackIcons: Record<string, string> = {
            'gemini-integration': knownIcons['Google Gemini'],
            'mercadolivre-integration': knownIcons['Mercado Livre'],
            'Mercado Livre': knownIcons['Mercado Livre'],
        };

        availableIntegrations.forEach((integration) => {
            fallbackIcons[integration.id] = integration.icon_url;
            fallbackIcons[integration.name] = integration.icon_url;
            if (integration.tag) {
                fallbackIcons[integration.tag] = integration.icon_url;
            }
        });

        const enrichedIntegrations = integrations.map((i: Integration) => {
            // Fuzzy match for resilience
            const knownKey = Object.keys(knownIcons).find(key => i.name?.toLowerCase().includes(key.toLowerCase()));
            const safeIconUrl =
                (i.icon_url && i.icon_url.trim()) ||
                (knownKey ? knownIcons[knownKey] : undefined) ||
                fallbackIcons[i.id] ||
                (i.tag ? fallbackIcons[i.tag] : undefined) ||
                fallbackIcons[i.name] ||
                FALLBACK_ICON;

            return { ...i, icon_url: safeIconUrl };
        });

        // Inject Gemini if missing
        if (!enrichedIntegrations.find((i: Integration) => i.tag === 'Gemini')) {
            enrichedIntegrations.push({
                id: 'gemini-integration',
                name: 'Google Gemini',
                description: 'Configure sua própria chave de API e escolha o modelo do Gemini para as Respostas Inteligentes.',
                icon_url: knownIcons['Google Gemini'] ?? FALLBACK_ICON,
                href: '/integrations/gemini',
                status: 'active',
                tag: 'Gemini',
                tag_type: 'primary',
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            } as Integration);
        }

        // Inject Mercado Livre if missing
        if (!enrichedIntegrations.find((i: Integration) => i.tag === 'Mercado Livre')) {
            enrichedIntegrations.push({
                id: 'mercadolivre-integration',
                name: 'Mercado Livre',
                description: 'Receba perguntas e mensagens das suas vendas do Mercado Livre diretamente no chat.',
                icon_url: knownIcons['Mercado Livre'] ?? FALLBACK_ICON,
                href: '/integrations/mercadolivre',
                status: 'active',
                tag: 'Mercado Livre',
                tag_type: 'primary',
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            } as Integration);
        }

        // Inject NexusFlow if missing
        if (!enrichedIntegrations.find((i: Integration) => i.tag === 'NexusFlow')) {
            enrichedIntegrations.push({
                id: 'nexusflow-integration',
                name: 'NexusFlow',
                description: 'Configure a conta mestre unificada para automação avançada de fluxos.',
                icon_url: 'https://cdn-icons-png.flaticon.com/512/8637/8637089.png', // Temporary generic automation icon
                href: '/integrations/nexusflow', // Points to our new page
                status: 'active',
                tag: 'NexusFlow',
                tag_type: 'primary',
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            } as Integration);
        }

        return { integrations: enrichedIntegrations };
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
