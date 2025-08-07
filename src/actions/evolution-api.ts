
'use server';

import { db } from '@/lib/db';
import { revalidatePath } from 'next/cache';
import type { EvolutionApiConfig, EvolutionInstance, EvolutionInstanceCreationPayload } from '@/lib/types';

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
export async function getEvolutionApiInstances(workspaceId: string): Promise<Omit<EvolutionInstance, 'status' | 'qrCode'>[]> {
    try {
        const config = await getEvolutionApiConfig(workspaceId);
        if (!config || !config.id) {
            return [];
        }
        
        const res = await db.query('SELECT id, name, type, config_id FROM evolution_api_instances WHERE config_id = $1', [config.id]);
        return res.rows;
    } catch (error) {
        console.error('[EVO_ACTION_GET_INSTANCES] Error fetching instances:', error);
        throw new Error('Failed to fetch Evolution API instances.');
    }
}

/**
 * Wrapper genérico para chamadas à Evolution API.
 */
async function fetchEvolutionAPI(
    endpoint: string, 
    config: Omit<EvolutionApiConfig, 'id' | 'workspace_id'>,
    options: RequestInit = {}
) {
    if (!config.api_url || !config.api_key) {
        throw new Error("A configuração da API (URL e Chave) é necessária.");
    }
    const baseUrl = config.api_url.endsWith('/') ? config.api_url.slice(0, -1) : config.api_url;
    const url = `${baseUrl}${endpoint}`;
    
    console.log(`[EVO_API_FETCH] Chamando: ${options.method || 'GET'} ${url}`);
    if (options.body) {
       console.log(`[EVO_API_FETCH] Body: ${options.body}`);
    }

    try {
        const response = await fetch(url, {
            ...options,
            headers: {
                ...options.headers,
                'apikey': config.api_key,
                'Content-Type': 'application/json',
            },
            cache: 'no-store'
        });

        const responseBodyText = await response.text();
        console.log(`[EVO_API_FETCH] Resposta recebida: Status ${response.status}, Body: ${responseBodyText}`);

        if (!response.ok) {
            console.error(`[EVO_API_FETCH] Erro na API Evolution: Status ${response.status}. URL: ${url}. Body: ${responseBodyText}`);
            throw new Error(`Erro da API Evolution: ${response.statusText} - ${responseBodyText}`);
        }
        
        if (response.headers.get("content-type")?.includes("application/json") && responseBodyText) {
            return JSON.parse(responseBodyText);
        }
        return;

    } catch (error) {
        console.error(`[EVO_API_FETCH] Erro de rede ou sistema ao chamar a API Evolution. URL: ${url}. Erro:`, error);
        throw error;
    }
}


/**
 * Cria uma nova instância na API da Evolution e a registra no banco de dados local.
 */
export async function createEvolutionApiInstance(
    prevState: any,
    formData: FormData
): Promise<{ error: string | null }> {
    const config_id = formData.get('config_id') as string;
    if (!config_id) {
        return { error: 'ID de configuração não encontrado.' };
    }

    // 1. Obter a configuração global da API
    const configRes = await db.query('SELECT api_url, api_key FROM evolution_api_configs WHERE id = $1', [config_id]);
    if (configRes.rows.length === 0) {
        return { error: 'Configuração global da API não encontrada.' };
    }
    const apiConfig = configRes.rows[0];

    // 2. Construir o payload para a API da Evolution
    const payload: EvolutionInstanceCreationPayload = {
        instanceName: formData.get('instanceName') as string,
        token: formData.get('token') as string | undefined,
        qrcode: formData.get('qrcode') === 'on',
        number: formData.get('number') as string | undefined,
        integration: formData.get('type') as 'WHATSAPP-BAILEYS' | 'WHATSAPP-WEB.JS' | undefined,

        // General Settings
        rejectCall: formData.get('rejectCall') === 'on',
        msgCall: formData.get('msgCall') as string | undefined,
        groupsIgnore: formData.get('groupsIgnore') === 'on',
        alwaysOnline: formData.get('alwaysOnline') === 'on',
        readMessages: formData.get('readMessages') === 'on',
        readStatus: formData.get('readStatus') === 'on',
        syncFullHistory: formData.get('syncFullHistory') === 'on',
        
        // Proxy
        proxyHost: formData.get('proxyHost') as string | undefined,
        proxyPort: Number(formData.get('proxyPort')) || undefined,
        proxyUsername: formData.get('proxyUsername') as string | undefined,
        proxyPassword: formData.get('proxyPassword') as string | undefined,

        // Webhook
        webhook: {
            url: formData.get('webhook.url') as string | undefined,
            byEvents: formData.get('webhook.byEvents') === 'on',
            base64: formData.get('webhook.base64') === 'on',
            events: (formData.get('webhook.events') as string)?.split('\n').filter(e => e.trim()) || undefined,
        },
        // RabbitMQ
        rabbitmq: {
            enabled: formData.get('rabbitmq.enabled') === 'on',
            events: (formData.get('rabbitmq.events') as string)?.split('\n').filter(e => e.trim()) || undefined,
        },
        // SQS
        sqs: {
            enabled: formData.get('sqs.enabled') === 'on',
            events: (formData.get('sqs.events') as string)?.split('\n').filter(e => e.trim()) || undefined,
        },
    };

    // Remove chaves undefined ou vazias para um payload limpo
    Object.keys(payload).forEach(key => {
        const typedKey = key as keyof typeof payload;
        if (payload[typedKey] === undefined || payload[typedKey] === '' || payload[typedKey] === null) {
            delete payload[typedKey];
        }
        if (typeof payload[typedKey] === 'object' && payload[typedKey] !== null) {
             Object.keys(payload[typedKey]!).forEach(subKey => {
                const typedSubKey = subKey as keyof typeof payload[typeof typedKey];
                const subObject = payload[typedKey] as any;
                 if (subObject[typedSubKey] === undefined || subObject[typedSubKey] === '' || subObject[typedSubKey] === null || (Array.isArray(subObject[typedSubKey]) && subObject[typedSubKey].length === 0)) {
                    delete subObject[typedSubKey];
                }
             });
             if (Object.keys(payload[typedKey]!).length === 0) {
                 delete payload[typedKey];
             }
        }
    });

    try {
        // 3. Chamar a API da Evolution para criar a instância
        console.log("Enviando payload para a Evolution API:", JSON.stringify(payload, null, 2));
        await fetchEvolutionAPI('/instance/create', apiConfig, {
            method: 'POST',
            body: JSON.stringify(payload)
        });

        // 4. Se a criação na API for bem-sucedida, salvar no DB local
        await db.query(
            'INSERT INTO evolution_api_instances (name, type, config_id) VALUES ($1, $2, $3)',
            [payload.instanceName, (formData.get('type') === 'WHATSAPP-BAILEYS' ? 'baileys' : 'wa_cloud'), config_id]
        );

    } catch (error: any) {
        console.error('[EVO_ACTION_CREATE_INSTANCE] Erro ao criar instância:', error);
        return { error: `Falha ao criar instância na API Evolution: ${error.message}` };
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

export async function checkInstanceStatus(instanceName: string, config: EvolutionApiConfig): Promise<{ status: EvolutionInstance['status'], qrCode?: string }> {
    try {
        const data = await fetchEvolutionAPI(`/instance/connectionState/${instanceName}`, config);
        // O estado 'connecting' na API v2 significa que está aguardando o QR code.
        if (data.instance.state === 'connecting') {
            return { status: 'pending' };
        }
        if (data.instance.state === 'open') {
             return { status: 'connected' };
        }
        return { status: 'disconnected' };
    } catch (error) {
        console.error(`[EVO_ACTION_CHECK_STATUS] Erro ao verificar status da instância ${instanceName}:`, error);
        return { status: 'disconnected' };
    }
}

export async function connectInstance(instanceName: string, config: EvolutionApiConfig): Promise<{ status: EvolutionInstance['status'], qrCode?: string }> {
    try {
        const data = await fetchEvolutionAPI(`/instance/connect/${instanceName}`, config);
        // Se a conexão for iniciada, o status será 'pending' e podemos ter um QR code
        if (data?.base64) {
            return { status: 'pending', qrCode: data.base64 };
        }
        return { status: 'pending' };
    } catch (error) {
        console.error(`[EVO_ACTION_CONNECT] Erro ao conectar instância ${instanceName}:`, error);
        return { status: 'disconnected' };
    }
}

export async function disconnectInstance(instanceName: string, config: EvolutionApiConfig): Promise<{ status: EvolutionInstance['status'] }> {
    try {
        await fetchEvolutionAPI(`/instance/logout/${instanceName}`, config, { method: 'POST' });
        return { status: 'disconnected' };
    } catch (error) {
        console.error(`[EVO_ACTION_DISCONNECT] Erro ao desconectar instância ${instanceName}:`, error);
        // Mesmo em caso de erro, assumimos que desconectou ou já estava desconectado.
        return { status: 'disconnected' };
    }
}

export async function testEvolutionApiConnection(
    config: Omit<EvolutionApiConfig, 'id' | 'workspace_id'>
): Promise<{ success: boolean; message: string }> {
    if (!config.api_url || !config.api_key) {
        return { success: false, message: 'URL da API e Chave da API são obrigatórias.' };
    }
    
    try {
        // Tenta acessar um endpoint simples que não requer um nome de instância, como o de 'manager'
        // Se a API estiver no ar e a chave for válida, isso deve funcionar.
        await fetchEvolutionAPI('/manager/restart', { ...config }, { method: 'POST' });
        // Nota: Não queremos realmente reiniciar, apenas testar o endpoint.
        // A API da Evolution V2 não tem um endpoint de "ping" simples, então usamos um que requer autenticação.
        // Um restart falha se não estiver no modo manager, mas ainda valida a conexão.
        // Se a chamada acima não lançar um erro, a conexão está ok.
        return { success: true, message: 'Conexão bem-sucedida.' };
    } catch (error: any) {
        // A API pode retornar um erro específico se o modo manager não estiver ativo, o que ainda é um sinal de sucesso na conexão.
        if (error.message && error.message.includes('403') || error.message && error.message.includes('501')) {
            return { success: true, message: 'Conexão bem-sucedida.' };
        }
        console.error('[EVO_ACTION_TEST_CONNECTION] Erro ao testar a conexão:', error);
        return { success: false, message: `Falha na conexão: ${error.message}` };
    }
}
