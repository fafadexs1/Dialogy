'use server';

import { db } from '@/lib/db';
import { getCurrentUser } from './user';
import { revalidatePath } from 'next/cache';

export type IntegrationConfig<T = any> = {
    provider: string;
    config: T;
    is_active: boolean;
    updated_at: string;
};

export async function saveIntegrationConfig(
    workspaceId: string,
    provider: string,
    config: any,
    isActive: boolean = true
): Promise<{ success: boolean; error?: string }> {
    const user = await getCurrentUser();

    if (!user) {
        return { success: false, error: 'Usuário não autenticado.' };
    }

    // Verify workspace access (simple check: must be active workspace)
    if (user.activeWorkspaceId !== workspaceId) {
        // More robust check could query user_workspace_roles
        return { success: false, error: 'Acesso negado ao workspace.' };
    }

    try {
        await db.query(`
            INSERT INTO workspace_integrations (workspace_id, provider, config, is_active, updated_at)
            VALUES ($1, $2, $3, $4, NOW())
            ON CONFLICT (workspace_id, provider)
            DO UPDATE SET 
                config = $3,
                is_active = $4,
                updated_at = NOW();
        `, [workspaceId, provider, JSON.stringify(config), isActive]);

        revalidatePath('/integrations');
        return { success: true };
    } catch (error) {
        console.error('[SAVE_INTEGRATION] Error:', error);
        return { success: false, error: 'Falha ao salvar configuração da integração.' };
    }
}

export async function getIntegrationConfig(
    workspaceId: string,
    provider: string
): Promise<{ config: any | null; isActive: boolean }> {
    const user = await getCurrentUser();
    if (!user) return { config: null, isActive: false };

    try {
        const res = await db.query(`
            SELECT config, is_active 
            FROM workspace_integrations 
            WHERE workspace_id = $1 AND provider = $2
        `, [workspaceId, provider]);

        if (res.rows.length === 0) {
            return { config: null, isActive: false };
        }

        return {
            config: res.rows[0].config,
            isActive: res.rows[0].is_active
        };
    } catch (error) {
        return { config: null, isActive: false };
    }
}

export async function getIntegrations(): Promise<{ integrations: any[]; error?: string }> {
    const user = await getCurrentUser();
    if (!user?.activeWorkspaceId) {
        return { integrations: [] };
    }

    const workspaceId = user.activeWorkspaceId;

    try {
        // Fetch integration statuses from the new table
        const statusesRes = await db.query(`
            SELECT provider, is_active 
            FROM workspace_integrations 
            WHERE workspace_id = $1
        `, [workspaceId]);

        const activeProviders = new Set(statusesRes.rows.filter(r => r.is_active).map(r => r.provider));

        const availableIntegrations = [
            {
                id: 'gemini',
                name: 'Google Gemini',
                description: 'Assistente de IA para resumos e respostas inteligentes.',
                icon_url: '/icons/gemini.svg',
                href: '/integrations/gemini',
                is_active: activeProviders.has('gemini'),
                provider: 'gemini'
            },
            {
                id: 'evolution-api',
                name: 'Evolution API (WhatsApp)',
                description: 'Conecte seus números de WhatsApp via Evolution API.',
                icon_url: '/icons/whatsapp.svg',
                href: '/integrations/evolution-api',
                is_active: activeProviders.has('evolution-api'),
                provider: 'evolution-api'
            },
            {
                id: 'meta-messenger',
                name: 'Meta Messenger',
                description: 'Gerencie mensagens do Facebook Messenger.',
                icon_url: '/icons/messenger.svg',
                href: '/integrations/meta-messenger',
                is_active: activeProviders.has('meta-messenger'),
                provider: 'meta-messenger'
            },
            {
                id: 'meta-instagram',
                name: 'Instagram Direct',
                description: 'Responda DMs do Instagram diretamente.',
                icon_url: '/icons/instagram.svg',
                href: '/integrations/meta-instagram',
                is_active: activeProviders.has('meta-instagram'),
                provider: 'meta-instagram'
            },
            {
                id: 'mercadolivre',
                name: 'Mercado Livre',
                description: 'Responda perguntas e gerencie vendas do Mercado Livre.',
                icon_url: '/icons/mercadolivre.png',
                href: '/integrations/mercadolivre',
                is_active: activeProviders.has('mercadolivre'),
                provider: 'mercadolivre'
            },
            {
                id: 'nexusflow',
                name: 'NexusFlow',
                description: 'Automação de fluxos e chatbots avançados.',
                icon_url: '/icons/nexusflow.svg',
                href: '/integrations/nexusflow',
                is_active: activeProviders.has('nexusflow'),
                provider: 'nexusflow'
            }
        ];

        return { integrations: availableIntegrations };
    } catch (error) {
        console.error('[GET_INTEGRATIONS_ACTION]', error);
        return { integrations: [], error: 'Falha ao carregar integrações.' };
    }
}

export async function updateIntegration(data: any): Promise<{ success: boolean; error?: string }> {
    // Stub for now, as we don't have a table for Integration Definitions yet.
    // In a real scenario, this would update an 'integrations_catalog' table.
    console.log('[UPDATE_INTEGRATION] Stub called with:', data);
    return { success: true };
}
