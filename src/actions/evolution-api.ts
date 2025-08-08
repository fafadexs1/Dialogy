
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
        
        const res = await db.query('SELECT id, name, type, config_id, webhook_url FROM evolution_api_instances WHERE config_id = $1', [config.id]);
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
    
    const instanceName = formData.get('instanceName') as string;
    if (!instanceName) {
        return { error: 'O nome da instância é obrigatório.'}
    }

    // 2. Construir o payload para a API da Evolution dinamicamente
    const payload: EvolutionInstanceCreationPayload = {
        instanceName,
        qrcode: true // Sempre true, conforme solicitado.
    };
    
    // Funções auxiliares para manter o código limpo
    const addIfPresent = (key: keyof EvolutionInstanceCreationPayload, value: string | undefined | null) => {
        if (value) (payload as any)[key] = value;
    };
    const addIfOn = (key: keyof EvolutionInstanceCreationPayload, value: FormDataEntryValue | null) => {
        if (value === 'on') (payload as any)[key] = true;
    };
    
    addIfPresent('number', formData.get('number') as string);
    addIfPresent('integration', formData.get('integration') as 'WHATSAPP-BAILEYS' | 'WHATSAPP-BUSINESS' | undefined);

    // General Settings
    addIfOn('rejectCall', formData.get('rejectCall'));
    addIfPresent('msgCall', formData.get('msgCall') as string);
    addIfOn('groupsIgnore', formData.get('groupsIgnore'));
    addIfOn('alwaysOnline', formData.get('alwaysOnline'));
    addIfOn('readMessages', formData.get('readMessages'));
    addIfOn('readStatus', formData.get('readStatus'));
    addIfOn('syncFullHistory', formData.get('syncFullHistory'));
    
    // Proxy
    const proxyHost = formData.get('proxyHost') as string;
    const proxyPort = formData.get('proxyPort') as string;
    const proxyUsername = formData.get('proxyUsername') as string;
    const proxyPassword = formData.get('proxyPassword') as string;
    if (proxyHost && proxyPort) {
        payload.proxy = {
            host: proxyHost,
            port: Number(proxyPort)
        };
        if (proxyUsername) payload.proxy.username = proxyUsername;
        if (proxyPassword) payload.proxy.password = proxyPassword;
    }
    
    // Automatic Webhook Configuration
    const webhookBaseUrl = process.env.NEXTAUTH_URL;
    if (!webhookBaseUrl) {
        console.error('[EVO_ACTION_CREATE_INSTANCE] Erro: A variável de ambiente NEXTAUTH_URL não está definida.');
        return { error: 'A URL base da aplicação não está configurada no ambiente.' };
    }

    const webhookUrlForInstance = `${webhookBaseUrl}/api/webhooks/evolution/${instanceName}`;
    payload.webhook = {
        url: webhookUrlForInstance,
        enabled: true,
        events: [
            'CHATS_UPSERT',
            'CONNECTION_UPDATE',
            'CONTACTS_UPDATE',
            'CONTACTS_UPSERT',
            'MESSAGES_DELETE',
            'MESSAGES_UPSERT'
        ]
    };

    // RabbitMQ / SQS
    const addQueueEvents = (prefix: 'rabbitmq' | 'sqs') => {
        if (formData.get(`${prefix}.enabled`) === 'on') {
            (payload as any)[prefix] = { enabled: true };
            const eventsValue = formData.get(`${prefix}.events`) as string;
            if (eventsValue) {
                const events = eventsValue.split('\n').map(e => e.trim()).filter(Boolean);
                if (events.length > 0) {
                    (payload as any)[prefix].events = events;
                }
            }
        }
    };
    
    addQueueEvents('rabbitmq');
    addQueueEvents('sqs');


    try {
        // 3. Chamar a API da Evolution para criar a instância
        console.log("Enviando payload para a Evolution API:", JSON.stringify(payload, null, 2));
        await fetchEvolutionAPI('/instance/create', apiConfig, {
            method: 'POST',
            body: JSON.stringify(payload)
        });

        // 4. Se a criação na API for bem-sucedida, salvar no DB local
        const instanceType = payload.integration === 'WHATSAPP-BUSINESS' ? 'wa_cloud' : 'baileys';
        await db.query(
            'INSERT INTO evolution_api_instances (name, type, config_id, webhook_url) VALUES ($1, $2, $3, $4)',
            [payload.instanceName, instanceType, config_id, payload.webhook.url]
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
        // Primeiro, precisamos do nome da instância para a chamada da API
        const instanceRes = await db.query('SELECT name, config_id FROM evolution_api_instances WHERE id = $1', [instanceId]);
        if (instanceRes.rows.length === 0) {
            return { error: 'Instância não encontrada no banco de dados local.' };
        }
        const { name: instanceName, config_id } = instanceRes.rows[0];

        // Obter a configuração da API para a chave
        const configRes = await db.query('SELECT api_url, api_key FROM evolution_api_configs WHERE id = $1', [config_id]);
        if (configRes.rows.length === 0) {
            return { error: 'Configuração da API não encontrada.' };
        }
        const apiConfig = configRes.rows[0];

        // Chamar a API para deletar
        await fetchEvolutionAPI(`/instance/delete/${instanceName}`, apiConfig, { method: 'DELETE' });
        
        // Se a chamada da API for bem-sucedida, delete do DB local
        await db.query('DELETE FROM evolution_api_instances WHERE id = $1', [instanceId]);

    } catch (error: any) {
        console.error('[EVO_ACTION_DELETE_INSTANCE] Error deleting instance:', error);
        // Mesmo se a API falhar (ex: instância já deletada lá), tentamos remover do nosso DB
        try {
            await db.query('DELETE FROM evolution_api_instances WHERE id = $1', [instanceId]);
        } catch (dbError) {
             console.error('[EVO_ACTION_DELETE_INSTANCE] Error deleting from DB after API error:', dbError);
        }
        return { error: `Falha ao deletar instância. Ela pode ter sido removida do DB local, mas verifique o servidor da Evolution. Erro: ${error.message}` };
    }

    revalidatePath('/integrations/evolution-api');
    return { error: null };
}

export async function checkInstanceStatus(instanceName: string, config: EvolutionApiConfig): Promise<{ status: EvolutionInstance['status'], qrCode?: string }> {
    try {
        const data = await fetchEvolutionAPI(`/instance/connectionState/${instanceName}`, config);
        // O estado 'connecting' na API v2 significa que está aguardando o QR code.
        if (data.instance.state === 'connecting') {
            const qrData = await fetchEvolutionAPI(`/instance/connect/${instanceName}`, config);
             return { status: 'pending', qrCode: qrData?.base64 };
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
