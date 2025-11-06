
'use server';

import { db } from '@/lib/db';
import { revalidatePath } from 'next/cache';
import type { EvolutionInstance, EvolutionInstanceCreationPayload, Workspace } from '@/lib/types';
import { createClient } from '@/lib/supabase/server';

/**
 * Retorna todas as instâncias da Evolution API para um workspace.
 */
export async function getEvolutionApiInstances(workspaceId: string): Promise<Omit<EvolutionInstance, 'status' | 'qrCode'>[]> {
    try {
        const res = await db.query('SELECT id, instance_name, display_name, type, cluster_id, webhook_url FROM evolution_api_instances WHERE workspace_id = $1', [workspaceId]);
        return res.rows.map(r => ({ ...r, config_id: r.cluster_id })); // Map cluster_id to config_id for compatibility
    } catch (error) {
        console.error('[EVO_ACTION_GET_INSTANCES] Error fetching instances:', error);
        throw new Error('Failed to fetch Evolution API instances.');
    }
}

/**
 * Wrapper genérico para chamadas à Evolution API.
 */
export async function fetchEvolutionAPI(
    endpoint: string, 
    apiConfig: { api_url: string; api_key: string },
    options: RequestInit = {}
) {
    if (!apiConfig.api_url || !apiConfig.api_key) {
        throw new Error("A configuração da API (URL e Chave) é necessária.");
    }
    const baseUrl = apiConfig.api_url.endsWith('/') ? apiConfig.api_url.slice(0, -1) : apiConfig.api_url;
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
                'apikey': apiConfig.api_key,
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
        
        const contentType = response.headers.get("content-type");
        if (contentType && contentType.includes("application/json") && responseBodyText) {
            return JSON.parse(responseBodyText);
        }
        return responseBodyText ? { text: responseBodyText } : undefined;

    } catch (error) {
        console.error(`[EVO_API_FETCH] Erro de rede ou sistema ao chamar a API Evolution. URL: ${url}. Erro:`, error);
        throw error;
    }
}

/**
 * Cria uma nova instância na API da Evolution e a registra no banco de dados local.
 */
export async function createEvolutionApiInstance(
    payload: EvolutionInstanceCreationPayload,
    workspaceId: string
): Promise<{ success: boolean, error?: string | null }> {
    const client = await db.connect();
    
    if (!workspaceId) {
        return { success: false, error: 'ID do Workspace não encontrado.' };
    }
    if (!payload.displayName) {
        return { success: false, error: 'O apelido da instância é obrigatório.'}
    }

    try {
        await client.query('BEGIN');

        // 1. Encontrar um cluster ativo com a menor carga (lógica de load balance a ser implementada)
        const clusterRes = await client.query('SELECT id, api_url, api_key FROM whatsapp_clusters WHERE is_active = TRUE ORDER BY created_at ASC LIMIT 1');
        if (clusterRes.rowCount === 0) {
            throw new Error('Nenhum servidor (cluster) de WhatsApp ativo foi encontrado.');
        }
        const cluster = clusterRes.rows[0];
        const apiConfig = { api_url: cluster.api_url, api_key: cluster.api_key };
        
        // 2. Gerar o próximo `instanceName` sequencial para o cluster selecionado.
        const lastInstanceRes = await client.query(
            `SELECT instance_name FROM evolution_api_instances 
             WHERE cluster_id = $1 AND instance_name LIKE 'zap%' 
             ORDER BY LENGTH(instance_name) DESC, instance_name DESC 
             LIMIT 1`,
            [cluster.id]
        );
        
        let newInstanceNumber = 1;
        if (lastInstanceRes.rowCount > 0) {
            const lastInstanceName = lastInstanceRes.rows[0].instance_name;
            const lastNumber = parseInt(lastInstanceName.replace('zap', ''), 10);
            if (!isNaN(lastNumber)) {
                newInstanceNumber = lastNumber + 1;
            }
        }
        const instanceName = `zap${newInstanceNumber}`;
        payload.instanceName = instanceName;
        
        // 3. Preparar o payload para a API da Evolution
        if (payload.integration === 'WHATSAPP-BUSINESS') {
            payload.qrcode = false;
            if (!payload.token || !payload.number || !payload.businessId) {
                return { success: false, error: 'Para a Cloud API, Token, ID do Número e ID do Business são obrigatórios.' };
            }
        } else { // WHATSAPP-BAILEYS
            payload.qrcode = true;
        }
        
        const webhookBaseUrl = process.env.NEXTAUTH_URL;
        if (!webhookBaseUrl) {
            throw new Error('A variável de ambiente NEXTAUTH_URL não está definida.');
        }

        const webhookUrlForInstance = `${webhookBaseUrl}/api/webhooks/evolution/${payload.instanceName}`;
        payload.webhook = {
            url: webhookUrlForInstance,
            enabled: true,
            events: [
                'CHATS_UPSERT', 'CONNECTION_UPDATE', 'CONTACTS_UPDATE', 'CONTACTS_UPSERT',
                'MESSAGES_DELETE', 'MESSAGES_UPSERT', 'MESSAGES_UPDATE'
            ]
        };

        // 4. Chamar a API da Evolution para criar a instância
        console.log("Enviando payload para a Evolution API:", JSON.stringify(payload, null, 2));
        await fetchEvolutionAPI('/instance/create', apiConfig, {
            method: 'POST',
            body: JSON.stringify(payload)
        });

        // 5. Se a criação na API for bem-sucedida, salvar no DB local
        const instanceType = payload.integration === 'WHATSAPP-BUSINESS' ? 'wa_cloud' : 'baileys';
        await client.query(
            'INSERT INTO evolution_api_instances (workspace_id, cluster_id, instance_name, display_name, type, webhook_url) VALUES ($1, $2, $3, $4, $5, $6)',
            [workspaceId, cluster.id, payload.instanceName, payload.displayName, instanceType, payload.webhook.url]
        );

        await client.query('COMMIT');
    } catch (error: any) {
        await client.query('ROLLBACK');
        console.error('[EVO_ACTION_CREATE_INSTANCE] Erro ao criar instância:', error);
        return { success: false, error: `Falha ao criar instância: ${error.message}` };
    } finally {
        client.release();
    }

    revalidatePath('/integrations/evolution-api');
    return { success: true, error: null };
}

/**
 * Deleta uma instância da Evolution API.
 */
export async function deleteEvolutionApiInstance(instanceId: string): Promise<{ error: string | null }> {
    if (!instanceId) {
        return { error: 'Instance ID is required.' };
    }

    try {
        // Obter detalhes da instância e do cluster associado
        const instanceRes = await db.query(
          `SELECT i.instance_name, c.api_url, c.api_key 
           FROM evolution_api_instances i
           JOIN whatsapp_clusters c ON i.cluster_id = c.id
           WHERE i.id = $1`,
          [instanceId]
        );
        if (instanceRes.rows.length === 0) {
            return { error: 'Instância ou cluster associado não encontrado.' };
        }
        const { instance_name: instanceName, api_url, api_key } = instanceRes.rows[0];
        const apiConfig = { api_url, api_key };

        // Chamar a API para deletar
        await fetchEvolutionAPI(`/instance/delete/${instanceName}`, apiConfig, { method: 'DELETE' });
        
        // Se a chamada da API for bem-sucedida, delete do DB local
        await db.query('DELETE FROM evolution_api_instances WHERE id = $1', [instanceId]);

    } catch (error: any) {
        console.error('[EVO_ACTION_DELETE_INSTANCE] Error deleting instance:', error);
        // Mesmo se a API falhar, tentamos remover do nosso DB
        try {
            await db.query('DELETE FROM evolution_api_instances WHERE id = $1', [instanceId]);
        } catch (dbError) {
             console.error('[EVO_ACTION_DELETE_INSTANCE] Error deleting from DB after API error:', dbError);
        }
        return { error: `Falha ao deletar instância. Erro: ${error.message}` };
    }

    revalidatePath('/integrations/evolution-api');
    return { error: null };
}

async function getApiConfigForInstance(instanceName: string) {
    const instanceRes = await db.query(
      `SELECT c.api_url, c.api_key 
       FROM evolution_api_instances i
       JOIN whatsapp_clusters c ON i.cluster_id = c.id
       WHERE i.instance_name = $1`,
      [instanceName]
    );
     if (instanceRes.rows.length === 0) {
        throw new Error(`Configuração de API não encontrada para a instância ${instanceName}`);
    }
    return instanceRes.rows[0];
}

export async function checkInstanceStatus(instanceName: string): Promise<{ status: EvolutionInstance['status'], qrCode?: string }> {
    try {
        const apiConfig = await getApiConfigForInstance(instanceName);
        const data = await fetchEvolutionAPI(`/instance/connectionState/${instanceName}`, apiConfig);
        if (data.instance.state === 'connecting') {
            const qrData = await fetchEvolutionAPI(`/instance/connect/${instanceName}`, apiConfig);
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

export async function connectInstance(instanceName: string): Promise<{ status: EvolutionInstance['status'], qrCode?: string }> {
    try {
        const apiConfig = await getApiConfigForInstance(instanceName);
        const data = await fetchEvolutionAPI(`/instance/connect/${instanceName}`, apiConfig);
        if (data?.base64) {
            return { status: 'pending', qrCode: data.base64 };
        }
        return { status: 'pending' };
    } catch (error) {
        console.error(`[EVO_ACTION_CONNECT] Erro ao conectar instância ${instanceName}:`, error);
        return { status: 'disconnected' };
    }
}

export async function disconnectInstance(instanceName: string): Promise<{ status: EvolutionInstance['status'] }> {
    try {
        const apiConfig = await getApiConfigForInstance(instanceName);
        await fetchEvolutionAPI(`/instance/logout/${instanceName}`, apiConfig, { method: 'POST' });
        return { status: 'disconnected' };
    } catch (error) {
        console.error(`[EVO_ACTION_DISCONNECT] Erro ao desconectar instância ${instanceName}:`, error);
        return { status: 'disconnected' };
    }
}

export async function deleteMessageAction(
    messageId: string,
    instanceName: string
): Promise<{ success: boolean, error?: string }> {
     if (!instanceName || !messageId) {
        return { success: false, error: "Dados insuficientes para apagar a mensagem." };
    }
    
    const client = await db.connect();
    try {
        await client.query('BEGIN');

        const msgRes = await client.query('SELECT message_id_from_api, from_me, chat_id FROM messages WHERE id = $1', [messageId]);
        if (msgRes.rowCount === 0) throw new Error("Mensagem não encontrada no banco de dados.");
        const { message_id_from_api: apiMessageId, from_me: fromMe, chat_id } = msgRes.rows[0];
        
        if (!apiMessageId) throw new Error("A mensagem não possui um ID da API para ser apagada.");

        const chatRes = await client.query('SELECT ct.phone_number_jid as remoteJid FROM chats c JOIN contacts ct ON c.contact_id = ct.id WHERE c.id = $1', [chat_id]);
        if (chatRes.rowCount === 0) throw new Error("Chat não encontrado.");
        const { remotejid: remoteJid } = chatRes.rows[0];
        
        const apiConfig = await getApiConfigForInstance(instanceName);
        
        const deletePayload = { id: apiMessageId, remoteJid, fromMe };
        
        console.log(`[EVO_ACTION_DELETE_MSG] Enviando requisição para apagar. Payload: ${JSON.stringify(deletePayload)}`);

        await fetchEvolutionAPI(`/chat/deleteMessageForEveryone/${instanceName}`, apiConfig, {
            method: 'DELETE',
            body: JSON.stringify(deletePayload)
        });
        
        await client.query("UPDATE messages SET api_message_status = 'DELETED', content = 'Mensagem apagada' WHERE id = $1", [messageId]);

        await client.query('COMMIT');
        revalidatePath('/', 'layout');
        return { success: true };

    } catch (error: any) {
        await client.query('ROLLBACK');
        console.error(`[EVO_ACTION_DELETE_MSG] Erro ao apagar mensagem ${messageId}:`, error);
        return { success: false, error: error.message };
    } finally {
        client.release();
    }
}
