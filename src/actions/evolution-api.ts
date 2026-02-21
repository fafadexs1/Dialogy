
'use server';

import { db } from '@/lib/db';
import { revalidatePath } from 'next/cache';
import type { EvolutionInstance, EvolutionInstanceCreationPayload, Workspace, EvolutionApiConfig, EvolutionInstanceSettings } from '@/lib/types';
import { createClient } from '@/lib/supabase/server';
import { randomUUID } from 'crypto';
import { resilientFetch } from '@/lib/http/resilient-fetch';

function parseEnvInt(value: string | undefined, fallback: number): number {
    if (!value) return fallback;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const EVOLUTION_LIMITS = {
    // If unset, do not enforce local token length and defer validation to Evolution API/database.
    instanceTokenMax: parseEnvInt(process.env.EVOLUTION_INSTANCE_TOKEN_MAX_LENGTH, 0),
    businessFieldMax: parseEnvInt(process.env.EVOLUTION_BUSINESS_FIELD_MAX_LENGTH, 100),
} as const;

/**
 * Retorna todas as instâncias da Evolution API para um workspace.
 */
export async function getEvolutionApiInstances(workspaceId: string): Promise<{ instances: Omit<EvolutionInstance, 'status' | 'qrCode'>[] | null; error?: string; limitStatus?: { reached: boolean, current: number, max: number, plan: string } }> {
    if (!workspaceId) {
        return { instances: null, error: 'Workspace n\u00e3o informado.' };
    }

    try {
        const res = await db.query(
            `SELECT 
                id, instance_name, display_name, type, cluster_id, webhook_url,
                to_jsonb(evolution_api_instances)->>'business_name' as business_name,
                to_jsonb(evolution_api_instances)->>'waba_name' as waba_name,
                to_jsonb(evolution_api_instances)->>'display_phone_number' as display_phone_number,
                to_jsonb(evolution_api_instances)->>'verified_name' as verified_name,
                to_jsonb(evolution_api_instances)->>'waba_id' as waba_id,
                to_jsonb(evolution_api_instances)->>'phone_number_id' as phone_number_id
             FROM evolution_api_instances
             WHERE workspace_id = $1`,
            [workspaceId]
        );

        // --- BILLING Check ---
        const { checkLimit } = await import('@/lib/billing-logic');
        const currentCount = res.rowCount || 0;
        const limitCheck = await checkLimit(workspaceId, 'whatsapp', currentCount);

        const limitStatus = {
            reached: !limitCheck.allowed,
            current: currentCount,
            max: limitCheck.limit,
            plan: limitCheck.plan
        };
        // ---------------------

        return { instances: res.rows, limitStatus };
    } catch (error) {
        console.error('[EVO_ACTION_GET_INSTANCES] Error fetching instances:', error);
        return { instances: null, error: 'Falha ao buscar inst\u00e2ncias do WhatsApp.' };
    }
}

/**
 * Wrapper genérico para chamadas à Evolution API.
 */
export async function fetchEvolutionAPI(
    endpoint: string,
    apiConfig: { api_url: string; api_key: string },
    options: RequestInit = {}
): Promise<any> {
    if (!apiConfig.api_url || !apiConfig.api_key) {
        throw new Error("A configuração da API (URL e Chave) é necessária.");
    }
    const baseUrl = apiConfig.api_url.endsWith('/') ? apiConfig.api_url.slice(0, -1) : apiConfig.api_url;
    const url = `${baseUrl}${endpoint}`;

    try {
        const response = await resilientFetch(url, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                'apikey': apiConfig.api_key,
                ...options.headers,
            },
        });

        if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(`Evolution API Error: ${response.status} ${response.statusText} - ${errorBody}`);
        }

        const text = await response.text();
        return text ? JSON.parse(text) : null;

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
): Promise<{ success: boolean; error?: string | null; qrCode?: string }> {
    if (!workspaceId) {
        return { success: false, error: 'ID do Workspace não encontrado.' };
    }
    if (!payload.displayName?.trim()) {
        return { success: false, error: 'O apelido da instância é obrigatório.' }
    }

    // --- BILLING: Check Channel Limits ---
    const { checkLimit } = await import('@/lib/billing-logic');
    // Count active instances
    const countRes = await db.query(
        'SELECT COUNT(*) as count FROM evolution_api_instances WHERE workspace_id = $1',
        [workspaceId]
    );
    const currentCount = parseInt(countRes.rows[0].count, 10);

    const limitCheck = await checkLimit(workspaceId, 'whatsapp', currentCount);
    if (!limitCheck.allowed) {
        return {
            success: false,
            error: `O limite de conexões de WhatsApp do plano ${limitCheck.plan.toUpperCase()} (${limitCheck.limit}) foi atingido. Fale com seu gerente de contas.`
        };
    }
    // -------------------------------------

    const isBaileys = payload.integration === 'WHATSAPP-BAILEYS';
    if (!isBaileys && (!payload.number?.trim() || !payload.businessId?.trim() || !payload.token?.trim())) {
        return { success: false, error: 'Para a Cloud API, todos os campos da Meta Business são obrigatórios.' };
    }
    if (EVOLUTION_LIMITS.instanceTokenMax > 0 && payload.token && payload.token.length > EVOLUTION_LIMITS.instanceTokenMax) {
        return {
            success: false,
            error: `Token muito longo para a Evolution v2.3.7 (${payload.token.length} caracteres). O limite do campo token é ${EVOLUTION_LIMITS.instanceTokenMax}. Gere/use um token menor ou ajuste o schema da Evolution.`,
        };
    }
    if (payload.number && payload.number.length > EVOLUTION_LIMITS.businessFieldMax) {
        return {
            success: false,
            error: `Phone Number ID muito longo (${payload.number.length} caracteres). O limite aceito pela Evolution v2.3.7 é ${EVOLUTION_LIMITS.businessFieldMax}.`,
        };
    }
    if (payload.businessId && payload.businessId.length > EVOLUTION_LIMITS.businessFieldMax) {
        return {
            success: false,
            error: `WABA ID muito longo (${payload.businessId.length} caracteres). O limite aceito pela Evolution v2.3.7 é ${EVOLUTION_LIMITS.businessFieldMax}.`,
        };
    }

    const client = await db.connect();
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
        // 2. Gerar o próximo `instanceName` sequencial para o cluster selecionado.
        const [lastInstanceRes, evoInstances] = await Promise.all([
            client.query(
                `SELECT instance_name FROM evolution_api_instances 
                 WHERE cluster_id = $1 AND instance_name LIKE 'zap%' 
                 ORDER BY LENGTH(instance_name) DESC, instance_name DESC 
                 LIMIT 1`,
                [cluster.id]
            ),
            fetchEvolutionAPI('/instance/fetchInstances', apiConfig)
        ]);

        let newInstanceNumber = 1;
        if ((lastInstanceRes.rowCount ?? 0) > 0) {
            const lastInstanceName = lastInstanceRes.rows[0].instance_name;
            const lastNumber = parseInt(lastInstanceName.replace('zap', ''), 10);
            if (!isNaN(lastNumber)) {
                newInstanceNumber = lastNumber + 1;
            }
        }

        // Validate against Evolution API existing instances to prevent collisions
        // (in case DB is out of sync with Evolution)
        const instancesArray = Array.isArray(evoInstances) ? evoInstances : (evoInstances?.data || []);

        let existingEvoNames = new Set<string>();
        if (Array.isArray(instancesArray)) {
            // Updated based on real payload: properties are at root level, and 'name' is the field
            existingEvoNames = new Set(
                instancesArray.map((i: any) => i.name || i.instanceName || i?.instance?.instanceName).filter(Boolean)
            );
        }

        while (existingEvoNames.has(`zap${newInstanceNumber}`)) {
            console.log(`[EVO_ACTION] Instance name zap${newInstanceNumber} exists in Evolution but not in DB. Skipping...`);
            newInstanceNumber++;
        }

        const instanceName = `zap${newInstanceNumber}`;
        payload.instanceName = instanceName;

        // 3. Preparar o payload para a API da Evolution
        // 3. Preparar o payload para a API da Evolution
        const webhookBaseUrl = process.env.NEXTAUTH_URL;
        if (!webhookBaseUrl) {
            throw new Error('A variável de ambiente NEXTAUTH_URL não está definida.');
        }

        const webhookUrlForInstance = `${webhookBaseUrl}/api/webhooks/evolution/${payload.instanceName}`;

        // Ensure webhook object exists and set the URL
        if (!payload.webhook) {
            payload.webhook = {};
        }
        payload.webhook.url = webhookUrlForInstance;
        payload.webhook.events = [
            "APPLICATION_STARTUP",
            "QRCODE_UPDATED",
            "MESSAGES_SET",
            "MESSAGES_UPSERT",
            "MESSAGES_EDITED",
            "MESSAGES_UPDATE",
            "MESSAGES_DELETE",
            "SEND_MESSAGE",
            "SEND_MESSAGE_UPDATE",
            "CONTACTS_SET",
            "CONTACTS_UPSERT",
            "CONTACTS_UPDATE",
            "PRESENCE_UPDATE",
            "CHATS_SET",
            "CHATS_UPSERT",
            "CHATS_UPDATE",
            "CHATS_DELETE",
            "GROUPS_UPSERT",
            "GROUP_UPDATE",
            "GROUP_PARTICIPANTS_UPDATE",
            "CONNECTION_UPDATE",
            "LABELS_EDIT",
            "LABELS_ASSOCIATION",
            "CALL",
            "TYPEBOT_START",
            "TYPEBOT_CHANGE_STATUS",
            "REMOVE_INSTANCE",
            "LOGOUT_INSTANCE",
            "INSTANCE_CREATE",
            "INSTANCE_DELETE",
            "STATUS_INSTANCE"
        ];
        payload.webhook.byEvents = false;

        // Clean up payload
        Object.keys(payload).forEach((key) => {
            const typedKey = key as keyof EvolutionInstanceCreationPayload;
            if (payload[typedKey] === undefined || payload[typedKey] === null || payload[typedKey] === '') {
                delete payload[typedKey];
            }
            // Use type assertion for object check to avoid TS errors
            if (typeof payload[typedKey] === 'object' && payload[typedKey] !== null && Object.keys(payload[typedKey] as object).length === 0) {
                delete payload[typedKey];
            }
        });


        // 4. Prepare payload for Evolution API
        // displayName and metaInfo are internal to Dialogy
        // evolutionPayload contains ONLY what Evolution API expects
        const { displayName, metaInfo, ...evolutionPayload } = payload;

        console.log("═══════════════════════════════════════════════════════════════");
        console.log("[EVO_ACTION] 1. PAYLOAD RECEBIDO DO FRONTEND:");
        console.log(JSON.stringify(payload, null, 2));
        console.log("───────────────────────────────────────────────────────────────");
        console.log("[EVO_ACTION] 2. INSTANCE NAME GERADO:", payload.instanceName);
        console.log("[EVO_ACTION] 3. DISPLAY NAME (interno Dialogy):", displayName);
        console.log("───────────────────────────────────────────────────────────────");
        console.log("[EVO_ACTION] 4. PAYLOAD FINAL PARA EVOLUTION API:");
        console.log(JSON.stringify(evolutionPayload, null, 2));
        console.log("[EVO_ACTION] 5. URL DA CHAMADA:", `${apiConfig.api_url}/instance/create`);
        console.log("═══════════════════════════════════════════════════════════════");

        await fetchEvolutionAPI('/instance/create', apiConfig, {
            method: 'POST',
            body: JSON.stringify(evolutionPayload)
        });

        // 5. Se a criação na API for bem-sucedida, salvar no DB local
        const instanceType = payload.integration === 'WHATSAPP-BUSINESS' ? 'wa_cloud' : 'baileys';

        // Extract meta info if available
        const meta = payload.metaInfo || {};

        await client.query(
            `INSERT INTO evolution_api_instances (
                workspace_id, cluster_id, instance_name, display_name, type, webhook_url,
                business_name, waba_name, display_phone_number, verified_name, waba_id, phone_number_id
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
            [
                workspaceId,
                cluster.id,
                payload.instanceName,
                payload.displayName,
                instanceType,
                webhookUrlForInstance,
                meta.businessName || null,
                meta.wabaName || null,
                meta.displayPhoneNumber || null,
                meta.verifiedName || null,
                payload.businessId || null,
                payload.number || null
            ]
        );

        // 6. Fetch QR Code immediately
        let qrCode;
        if (instanceType === 'baileys') {
            const qrData = await fetchEvolutionAPI(`/instance/connect/${instanceName}`, apiConfig);
            qrCode = qrData?.base64;
        }

        await client.query('COMMIT');

        revalidatePath('/integrations/evolution-api');
        return { success: true, error: null, qrCode };

    } catch (error: any) {
        await client.query('ROLLBACK');
        console.error('[EVO_ACTION_CREATE_INSTANCE] Erro ao criar instância:', error);
        return { success: false, error: `Falha ao criar instância: ${error.message}` };
    } finally {
        client.release();
    }
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

async function getApiConfigForInstance(instanceName: string): Promise<{ api_url: string; api_key: string; } | null> {
    const instanceRes = await db.query(
        `SELECT c.api_url, c.api_key 
       FROM evolution_api_instances i
       JOIN whatsapp_clusters c ON i.cluster_id = c.id
       WHERE i.instance_name = $1`,
        [instanceName]
    );
    if (instanceRes.rows.length === 0) {
        return null;
    }
    return instanceRes.rows[0];
}

export async function checkInstanceStatus(instanceName: string): Promise<{ status: EvolutionInstance['status'], qrCode?: string }> {
    try {
        const apiConfig = await getApiConfigForInstance(instanceName);
        if (!apiConfig) throw new Error(`Configuração de API não encontrada para ${instanceName}`);

        const data = await fetchEvolutionAPI(`/instance/connectionState/${instanceName}`, apiConfig);

        // This endpoint's response structure might be { "instance": { "state": "open" | "connecting" | "close" } }
        const state = data?.instance?.state;

        if (state === 'connecting') {
            const qrData = await fetchEvolutionAPI(`/instance/connect/${instanceName}`, apiConfig);
            return { status: 'pending', qrCode: qrData?.base64 };
        }
        if (state === 'open') {
            return { status: 'connected' };
        }
        // Default to disconnected for 'close' or any other state
        return { status: 'disconnected' };
    } catch (error) {
        console.error(`[EVO_ACTION_CHECK_STATUS] Erro ao verificar status da instância ${instanceName}:`, error);
        return { status: 'disconnected' };
    }
}

export async function connectInstance(instanceName: string): Promise<{ status: EvolutionInstance['status'], qrCode?: string }> {
    try {
        const apiConfig = await getApiConfigForInstance(instanceName);
        if (!apiConfig) throw new Error(`Configuração de API não encontrada para ${instanceName}`);

        // This is the GET request to fetch the QR code
        const data = await fetchEvolutionAPI(`/instance/connect/${instanceName}`, apiConfig);

        if (data?.base64) {
            return { status: 'pending', qrCode: data.base64 };
        }
        // If there's no QR code, it might still be connecting or already connected.
        // We'll return 'pending' and let the next status check sort it out.
        return { status: 'pending' };
    } catch (error) {
        console.error(`[EVO_ACTION_CONNECT] Erro ao conectar instância ${instanceName}:`, error);
        return { status: 'disconnected' };
    }
}

export async function disconnectInstance(instanceName: string): Promise<{ status: EvolutionInstance['status'] }> {
    try {
        const apiConfig = await getApiConfigForInstance(instanceName);
        if (!apiConfig) throw new Error(`Configuração de API não encontrada para ${instanceName}`);
        await fetchEvolutionAPI(`/instance/logout/${instanceName}`, apiConfig, { method: 'DELETE' });
        return { status: 'disconnected' };
    } catch (error) {
        console.error(`[EVO_ACTION_DISCONNECT] Erro ao desconectar instância ${instanceName}:`, error);
        return { status: 'disconnected' };
    }
}

export async function restartInstance(instanceName: string): Promise<{ success: boolean; error?: string }> {
    try {
        const apiConfig = await getApiConfigForInstance(instanceName);
        if (!apiConfig) throw new Error(`Configuração de API não encontrada para ${instanceName}`);
        await fetchEvolutionAPI(`/instance/restart/${instanceName}`, apiConfig, { method: 'PUT' });
        return { success: true };
    } catch (error: any) {
        console.error(`[EVO_ACTION_RESTART] Erro ao reiniciar instância ${instanceName}:`, error);
        return { success: false, error: error.message };
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
        if (!apiConfig) throw new Error(`Configuração de API não encontrada para ${instanceName}`);

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


// Ação para criar template do WhatsApp
export async function createWhatsappTemplate(
    instanceName: string,
    payload: any
): Promise<{ success: boolean; error?: string }> {
    try {
        const apiConfig = await getApiConfigForInstance(instanceName);
        if (!apiConfig) throw new Error(`Configuração de API não encontrada para ${instanceName}`);
        await fetchEvolutionAPI(`/template/add/${instanceName}`, apiConfig, {
            method: 'POST',
            body: JSON.stringify(payload)
        });
        return { success: true };
    } catch (error: any) {
        console.error('[EVO_ACTION_CREATE_TEMPLATE] Error:', error);
        return { success: false, error: error.message };
    }
}

// Ação para buscar templates do WhatsApp
export async function findWhatsappTemplates(
    instanceName: string
): Promise<{ templates: any[] | null; error?: string }> {
    try {
        const apiConfig = await getApiConfigForInstance(instanceName);
        if (!apiConfig) throw new Error(`Configuração de API não encontrada para ${instanceName}`);
        const response = await fetchEvolutionAPI(`/template/find/${instanceName}`, apiConfig);
        return { templates: response };
    } catch (error: any) {
        console.error('[EVO_ACTION_FIND_TEMPLATES] Error:', error);
        return { templates: null, error: error.message };
    }
}

export async function getInstanceSettings(instanceName: string): Promise<EvolutionInstanceSettings | null> {
    try {
        const apiConfig = await getApiConfigForInstance(instanceName);
        if (!apiConfig) {
            throw new Error(`Configuração de API não encontrada para a instância ${instanceName}`);
        }
        const data = await fetchEvolutionAPI(`/settings/find/${instanceName}`, apiConfig);

        // Mapeia de camelCase para camelCase (corrigido)
        return {
            rejectCall: data.rejectCall,
            msgCall: data.msgCall,
            groupsIgnore: data.groupsIgnore,
            alwaysOnline: data.alwaysOnline,
            readMessages: data.readMessages,
            readStatus: data.readStatus,
            syncFullHistory: data.syncFullHistory,
        };
    } catch (error) {
        console.error(`[GET_INSTANCE_SETTINGS] Erro ao buscar configurações para ${instanceName}:`, error);
        return null;
    }
}

export async function updateInstanceSettings(
    instanceName: string,
    settings: Partial<EvolutionInstanceSettings>
): Promise<{ success: boolean; error?: string }> {
    try {
        const apiConfig = await getApiConfigForInstance(instanceName);
        if (!apiConfig) {
            throw new Error(`Configuração de API não encontrada para a instância ${instanceName}`);
        }

        // O payload da API espera camelCase, então o objeto settings já está no formato correto
        await fetchEvolutionAPI(
            `/settings/set/${instanceName}`,
            apiConfig,
            {
                method: 'POST',
                body: JSON.stringify(settings),
            }
        );
        return { success: true };
    } catch (error: any) {
        console.error(`[UPDATE_INSTANCE_SETTINGS] Erro ao atualizar configurações para ${instanceName}:`, error);
        return { success: false, error: error.message };
    }
}
