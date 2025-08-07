
'use server';

import { db } from '@/lib/db';
import { revalidatePath } from 'next/cache';
import type { EvolutionApiConfig, EvolutionInstance } from '@/lib/types';

/**
 * Retorna a configuração da Evolution API para um workspace específico.
 */
export async function getEvolutionApiConfig(workspaceId: string): Promise<EvolutionApiConfig | null> {
    try {
        const res = await db.query('SELECT * FROM evolution_api_configs WHERE workspace_id = $1', [workspaceId]);
        if (res.rows.length === 0) {
            return null;
        }
        return res.rows[0];
    } catch (error) {
        console.error('[EVO_ACTION_GET_CONFIG] Error fetching config:', error);
        throw new Error('Failed to fetch Evolution API config.');
    }
}

/**
 * Salva ou atualiza a configuração da Evolution API para um workspace.
 */
export async function saveEvolutionApiConfig(prevState: any, formData: FormData): Promise<{ error: string | null }> {
    const workspaceId = formData.get('workspaceId') as string;
    const configId = formData.get('configId') as string;
    const apiUrl = formData.get('apiUrl') as string;
    const apiKey = formData.get('apiKey') as string;

    if (!workspaceId) {
        return { error: 'Workspace ID is required.' };
    }

    try {
        if (configId) {
            // Update existing config
            await db.query(
                'UPDATE evolution_api_configs SET api_url = $1, api_key = $2 WHERE id = $3 AND workspace_id = $4',
                [apiUrl, apiKey, configId, workspaceId]
            );
        } else {
            // Insert new config
            await db.query(
                'INSERT INTO evolution_api_configs (workspace_id, api_url, api_key) VALUES ($1, $2, $3)',
                [workspaceId, apiUrl, apiKey]
            );
        }
    } catch (error) {
        console.error('[EVO_ACTION_SAVE_CONFIG] Error saving config:', error);
        return { error: 'Failed to save configuration.' };
    }

    revalidatePath('/integrations/evolution-api');
    return { error: null };
}

/**
 * Retorna todas as instâncias da Evolution API para um workspace.
 */
export async function getEvolutionApiInstances(workspaceId: string): Promise<EvolutionInstance[]> {
    try {
        // Primeiro, precisamos do ID da configuração do workspace.
        const config = await getEvolutionApiConfig(workspaceId);
        if (!config) {
            return []; // Sem configuração, sem instâncias.
        }
        
        const res = await db.query('SELECT * FROM evolution_api_instances WHERE config_id = $1', [config.id]);
        return res.rows;
    } catch (error) {
        console.error('[EVO_ACTION_GET_INSTANCES] Error fetching instances:', error);
        throw new Error('Failed to fetch Evolution API instances.');
    }
}

/**
 * Cria uma nova instância da Evolution API.
 */
export async function createEvolutionApiInstance(
    data: { name: string, type: EvolutionInstance['type'], config_id: string },
    formData: FormData // formData is still passed by default
): Promise<{ error: string | null }> {
    const { name, type, config_id } = data;

    if (!name || !type || !config_id) {
        return { error: 'Missing required fields to create an instance.' };
    }

    try {
        await db.query(
            'INSERT INTO evolution_api_instances (name, type, config_id, status) VALUES ($1, $2, $3, $4)',
            [name, type, config_id, 'disconnected']
        );
    } catch (error) {
        console.error('[EVO_ACTION_CREATE_INSTANCE] Error creating instance:', error);
        return { error: 'Failed to create instance.' };
    }

    revalidatePath('/integrations/evolution-api');
    return { error: null };
}

/**
 * Deleta uma instância da Evolution API.
 */
export async function deleteEvolutionApiInstance(instanceId: string): Promise<{ error: string | null }> {
    if (!instanceId) {
        return { error: 'Instance ID is required.' };
    }

    try {
        await db.query('DELETE FROM evolution_api_instances WHERE id = $1', [instanceId]);
    } catch (error) {
        console.error('[EVO_ACTION_DELETE_INSTANCE] Error deleting instance:', error);
        return { error: 'Failed to delete instance.' };
    }

    revalidatePath('/integrations/evolution-api');
    return { error: null };
}

// Note: Connection/disconnection logic would typically involve calls to the actual Evolution API
// and are not implemented here as they depend on an external service.
