
'use server';

import { db } from '@/lib/db';
import { revalidatePath } from 'next/cache';
import type { EvolutionInstance, EvolutionInstanceCreationPayload, EvolutionInstanceSettings } from '@/lib/types';
import { randomUUID } from 'crypto';
import { buildEvolutionWebhookUrl, getEvolutionApiConfig } from '@/lib/whatsapp/evolution-config';
import { requireWorkspaceAccess, requireWorkspacePermission } from '@/lib/security/access';
import { fetchEvolutionAPI } from '@/lib/whatsapp/evolution-api-client';
import { hasWorkspacePermission } from '@/lib/workspace-permissions';
import { buildEvolutionWebhookConfig, configureEvolutionInstanceWebhook } from '@/services/whatsapp/evolution-webhook-config';
import {
    buildTelegramWebhookUrl,
    deleteTelegramWebhook,
    getTelegramWebhookInfo,
    normalizeTelegramBotToken,
    setTelegramWebhook,
    validateTelegramBotToken,
} from '@/services/telegram/bot-api';

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

function extractEvolutionInstanceNames(payload: any): string[] {
    const instances = Array.isArray(payload) ? payload : (Array.isArray(payload?.data) ? payload.data : []);
    if (!Array.isArray(instances)) {
        return [];
    }

    return instances
        .map((instance: any) => instance?.name || instance?.instanceName || instance?.instance?.instanceName)
        .filter((name: unknown): name is string => typeof name === 'string' && name.trim().length > 0);
}

function getInstanceNamePrefix(payload: EvolutionInstanceCreationPayload): 'zap' | 'tg' {
    return 'zap';
}

async function getTelegramInstanceRecord(
    instanceName: string
): Promise<{
    instance_name: string;
    workspace_id: string;
    webhook_key: string | null;
    telegram_bot_token: string | null;
    telegram_webhook_url: string | null;
} | null> {
    const res = await db.query(
        `SELECT
            instance_name,
            workspace_id,
            to_jsonb(evolution_api_instances)->>'webhook_key' AS webhook_key,
            to_jsonb(evolution_api_instances)->>'telegram_bot_token' AS telegram_bot_token,
            to_jsonb(evolution_api_instances)->>'telegram_webhook_url' AS telegram_webhook_url
         FROM evolution_api_instances
         WHERE instance_name = $1
           AND type = 'telegram'
         LIMIT 1`,
        [instanceName]
    );

    return res.rows[0] || null;
}

async function getInstanceWorkspaceId(instanceName: string): Promise<string | null> {
    const result = await db.query(
        `SELECT workspace_id
           FROM evolution_api_instances
          WHERE instance_name = $1
         UNION ALL
         SELECT workspace_id
           FROM telegram_bot_instances
          WHERE instance_name = $1
          LIMIT 1`,
        [instanceName]
    );
    return result.rows[0]?.workspace_id || null;
}

async function requireInstanceAccess(
    instanceName: string,
    permission: 'workspace:settings:edit' | null
): Promise<string> {
    const workspaceId = await getInstanceWorkspaceId(instanceName);
    if (!workspaceId) throw new Error('Instância não encontrada.');
    if (permission) await requireWorkspacePermission(workspaceId, permission);
    else await requireWorkspaceAccess(workspaceId);
    return workspaceId;
}

/**
 * Retorna todas as instâncias da Evolution API para um workspace.
 */
export async function getEvolutionApiInstances(workspaceId: string): Promise<{ instances: Omit<EvolutionInstance, 'status' | 'qrCode'>[] | null; canManageWebhooks?: boolean; error?: string; limitStatus?: { reached: boolean, current: number, max: number, plan: string } }> {
    if (!workspaceId) {
        return { instances: null, error: 'Workspace n\u00e3o informado.' };
    }

    try {
        const user = await requireWorkspaceAccess(workspaceId);
        const canManageWebhooks = await hasWorkspacePermission(user.id, workspaceId, 'workspace:settings:edit');
        const res = await db.query(
            `SELECT 
                id, instance_name, display_name, type, cluster_id,
                CASE WHEN $2 THEN webhook_url ELSE NULL END AS webhook_url,
                CASE WHEN $2 THEN to_jsonb(evolution_api_instances)->>'webhook_key' ELSE NULL END AS webhook_key,
                to_jsonb(evolution_api_instances)->>'business_name' as business_name,
                to_jsonb(evolution_api_instances)->>'waba_name' as waba_name,
                to_jsonb(evolution_api_instances)->>'display_phone_number' as display_phone_number,
                to_jsonb(evolution_api_instances)->>'verified_name' as verified_name,
                to_jsonb(evolution_api_instances)->>'waba_id' as waba_id,
                to_jsonb(evolution_api_instances)->>'phone_number_id' as phone_number_id,
                to_jsonb(evolution_api_instances)->>'telegram_bot_id' as telegram_bot_id,
                to_jsonb(evolution_api_instances)->>'telegram_bot_username' as telegram_bot_username,
                to_jsonb(evolution_api_instances)->>'telegram_bot_name' as telegram_bot_name,
                to_jsonb(evolution_api_instances)->>'telegram_webhook_url' as telegram_webhook_url
             FROM evolution_api_instances
             WHERE workspace_id = $1
               AND type <> 'telegram'`,
            [workspaceId, canManageWebhooks]
        );

        const instances = res.rows.map(({ webhook_key, webhook_url, ...instance }) => {
            if (!canManageWebhooks) return instance;
            try {
                const expectedUrl = buildEvolutionWebhookUrl(webhook_key || instance.instance_name);
                return { ...instance, webhook_url: expectedUrl, webhook_needs_sync: webhook_url !== expectedUrl };
            } catch {
                return { ...instance, webhook_url: webhook_url || null, webhook_configuration_error: 'Link salvo, se disponível. Configure EVOLUTION_WEBHOOK_BASE_URL ou NEXTAUTH_URL com a URL pública da Dialogy antes de reconfigurar.' };
            }
        });

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

        return { instances, canManageWebhooks, limitStatus };
    } catch (error) {
        console.error('[EVO_ACTION_GET_INSTANCES] Error fetching instances:', error);
        return { instances: null, error: 'Falha ao buscar instancias da Evolution API.' };
    }
}

/** Reapply delivery without logging out or recreating the WhatsApp instance. */
export async function reconfigureEvolutionWebhook(instanceId: string, workspaceId: string): Promise<{ success: boolean; webhookUrl?: string; error?: string }> {
    try {
        await requireWorkspacePermission(workspaceId, 'workspace:settings:edit');
        const webhookUrl = await configureEvolutionInstanceWebhook(instanceId, workspaceId);
        revalidatePath('/integrations/whatsapp-api');
        return { success: true, webhookUrl };
    } catch {
        // Provider errors can contain authentication headers or the secret webhook URL.
        return { success: false, error: 'Não foi possível reconfigurar o webhook. Verifique sua permissão, o cluster Evolution API e a URL pública em EVOLUTION_WEBHOOK_BASE_URL ou NEXTAUTH_URL.' };
    }
}

/**
 * Cria uma nova instância na API da Evolution e a registra no banco de dados local.
 */
export async function createEvolutionApiInstance(
    payload: EvolutionInstanceCreationPayload,
    workspaceId: string
): Promise<{ success: boolean; error?: string | null; qrCode?: string; instanceId?: string }> {
    if (!workspaceId) {
        return { success: false, error: 'ID do Workspace não encontrado.' };
    }
    await requireWorkspacePermission(workspaceId, 'workspace:settings:edit');
    if (!payload.displayName?.trim()) {
        return { success: false, error: 'O apelido da instância é obrigatório.' }
    }

    if (payload.channel === 'telegram' || payload.telegramBotToken) {
        return {
            success: false,
            error: 'Telegram agora possui integracao propria. Use o card "Telegram Bot" para conectar o webhook nativo.',
        };
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

    const isTelegram = payload.channel === 'telegram';
    const isCloudApi = payload.integration === 'WHATSAPP-BUSINESS';
    const telegramBotToken = normalizeTelegramBotToken(payload.telegramBotToken);
    let telegramBot: Awaited<ReturnType<typeof validateTelegramBotToken>> | null = null;

    if (isTelegram) {
        if (!telegramBotToken) {
            return { success: false, error: 'Informe o token do bot Telegram gerado no BotFather.' };
        }

        try {
            telegramBot = await validateTelegramBotToken(telegramBotToken);
        } catch (error: any) {
            return { success: false, error: error?.message || 'Token do bot Telegram invalido.' };
        }
    }

    if (isCloudApi && (!payload.number?.trim() || !payload.businessId?.trim() || !payload.token?.trim())) {
        return { success: false, error: 'Para a Cloud API, todos os campos da Meta Business são obrigatórios.' };
    }
    if (!isTelegram && EVOLUTION_LIMITS.instanceTokenMax > 0 && payload.token && payload.token.length > EVOLUTION_LIMITS.instanceTokenMax) {
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

        // 1. WABAs existentes stay on their registered owner. Only a brand-new
        // WABA participates in active-cluster provisioning.
        const clusterRes = await client.query(
            'SELECT id, api_url, api_key FROM whatsapp_clusters WHERE is_active = TRUE ORDER BY created_at ASC'
        );
        let ownerCluster: { id: string; api_url: string; api_key: string; route_status: string } | null = null;
        if (isCloudApi && payload.businessId) {
            const ownerRes = await client.query(
                `SELECT c.id, c.api_url, c.api_key, r.status AS route_status
                 FROM meta_whatsapp_waba_routes r
                 JOIN whatsapp_clusters c ON c.id = r.cluster_id
                 WHERE r.waba_id = $1
                 FOR UPDATE OF r`,
                [payload.businessId]
            );
            ownerCluster = ownerRes.rows[0] || null;
            if (ownerCluster && ownerCluster.route_status !== 'active') {
                throw new Error(`A WABA está com rota ${ownerCluster.route_status}; conclua a migração antes de provisionar.`);
            }
        }
        if (!ownerCluster && clusterRes.rowCount === 0) {
            throw new Error('Nenhum servidor (cluster) Evolution API ativo foi encontrado.');
        }
        const activeClusters = clusterRes.rows;
        const cluster = ownerCluster || activeClusters[0];
        const clusters = ownerCluster && !activeClusters.some((item) => item.id === ownerCluster!.id)
            ? [...activeClusters, ownerCluster]
            : activeClusters;
        const apiConfig = { api_url: cluster.api_url, api_key: cluster.api_key };

        // 2. Gerar o próximo `instanceName` sequencial GLOBALMENTE.
        // O webhook URL é global (/api/webhooks/evolution/{instanceName}),
        // então o nome precisa ser único em toda a plataforma.
        await client.query(`SELECT pg_advisory_xact_lock(hashtext('dialogy_evolution_instance_name_generation'))`);

        const instancePrefix = getInstanceNamePrefix(payload);
        const reservedNames = new Set<string>();
        const dbInstancesRes = await client.query(
            `SELECT instance_name
             FROM evolution_api_instances
             WHERE instance_name LIKE $1`,
            [`${instancePrefix}%`]
        );

        for (const row of dbInstancesRes.rows) {
            if (typeof row.instance_name === 'string' && row.instance_name.trim().length > 0) {
                reservedNames.add(row.instance_name.trim());
            }
        }

        const evoInstancesByCluster = await Promise.allSettled(
            clusters.map((activeCluster) =>
                fetchEvolutionAPI('/instance/fetchInstances', {
                    api_url: activeCluster.api_url,
                    api_key: activeCluster.api_key,
                })
            )
        );

        for (const result of evoInstancesByCluster) {
            if (result.status !== 'fulfilled') {
                console.warn('[EVO_ACTION] Falha ao listar instancias de um cluster durante a reserva global:', result.reason);
                continue;
            }

            for (const name of extractEvolutionInstanceNames(result.value)) {
                if (name.startsWith(instancePrefix)) {
                    reservedNames.add(name);
                }
            }
        }

        let newInstanceNumber = 1;
        while (reservedNames.has(`${instancePrefix}${newInstanceNumber}`)) {
            newInstanceNumber++;
        }

        const instanceName = `${instancePrefix}${newInstanceNumber}`;
        const webhookKey = randomUUID();
        payload.instanceName = instanceName;
        let telegramWebhookUrl: string | null = null;

        if (isTelegram && telegramBot) {
            telegramWebhookUrl = buildTelegramWebhookUrl(webhookKey);
            payload.number = String(telegramBot.id);
            payload.qrcode = false;
            payload.token = payload.token || webhookKey;
            payload.displayName = payload.displayName?.trim() || `Telegram ${telegramBot.username ? `@${telegramBot.username}` : telegramBot.first_name}`;
        }

        // 3. Preparar o payload para a API da Evolution
        const webhookUrlForInstance = buildEvolutionWebhookUrl(webhookKey);
        payload.webhook = { ...payload.webhook, ...buildEvolutionWebhookConfig(webhookUrlForInstance) };

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
        delete (evolutionPayload as Partial<EvolutionInstanceCreationPayload>).channel;
        delete (evolutionPayload as Partial<EvolutionInstanceCreationPayload>).telegramBotToken;

        console.log("═══════════════════════════════════════════════════════════════");
        console.log("[EVO_ACTION] 1. PAYLOAD RECEBIDO DO FRONTEND:");
        console.log('[EVO_ACTION] Payload prepared.', {
            instanceName: payload.instanceName,
            integration: payload.integration,
            hasTelegramBotToken: Boolean(payload.telegramBotToken),
        });
        console.log("───────────────────────────────────────────────────────────────");
        console.log("[EVO_ACTION] 2. INSTANCE NAME GERADO:", payload.instanceName);
        console.log("[EVO_ACTION] 3. DISPLAY NAME (interno Dialogy):", displayName);
        console.log("───────────────────────────────────────────────────────────────");
        console.log("[EVO_ACTION] 4. Payload final preparado para Evolution API.");
        console.log("[EVO_ACTION] 5. URL DA CHAMADA:", `${apiConfig.api_url}/instance/create`);
        console.log("═══════════════════════════════════════════════════════════════");

        await fetchEvolutionAPI('/instance/create', apiConfig, {
            method: 'POST',
            body: JSON.stringify(evolutionPayload)
        });

        // 5. Se a criação na API for bem-sucedida, salvar no DB local
        const instanceType = isTelegram ? 'telegram' : payload.integration === 'WHATSAPP-BUSINESS' ? 'wa_cloud' : 'baileys';

        // Extract meta info if available
        const meta = payload.metaInfo || {};

        const createdInstance = await client.query(
            `INSERT INTO evolution_api_instances (
                workspace_id, cluster_id, instance_name, webhook_key, display_name, type, webhook_url,
                business_name, waba_name, display_phone_number, verified_name, waba_id, phone_number_id
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            RETURNING id`,
            [
                workspaceId,
                cluster.id,
                payload.instanceName,
                webhookKey,
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

        if (instanceType === 'wa_cloud') {
            const wabaId = payload.businessId!;
            const phoneNumberId = payload.number!;
            await client.query(
                `INSERT INTO meta_whatsapp_waba_routes (waba_id, cluster_id, status, version)
                 VALUES ($1, $2, 'active', 1)
                 ON CONFLICT (waba_id) DO NOTHING`,
                [wabaId, cluster.id]
            );
            const owner = await client.query(
                `SELECT cluster_id FROM meta_whatsapp_waba_routes WHERE waba_id = $1 FOR UPDATE`,
                [wabaId]
            );
            if (owner.rowCount !== 1 || owner.rows[0].cluster_id !== cluster.id) {
                throw new Error('A WABA informada já pertence a outro cluster. Use uma migração versionada.');
            }
            await client.query(
                `INSERT INTO meta_whatsapp_phone_routes
                   (phone_number_id, waba_id, instance_id, workspace_id, status)
                 VALUES ($1, $2, $3, $4, 'active')`,
                [phoneNumberId, wabaId, createdInstance.rows[0].id, workspaceId]
            );
        }

        if (isTelegram && telegramWebhookUrl) {
            await setTelegramWebhook(telegramBotToken, telegramWebhookUrl, webhookKey);
        }

        // 6. Fetch QR Code immediately
        let qrCode;
        if (instanceType === 'baileys') {
            const qrData = await fetchEvolutionAPI(`/instance/connect/${instanceName}`, apiConfig);
            qrCode = qrData?.base64;
        }

        await client.query('COMMIT');

        revalidatePath('/integrations/whatsapp-api');
        return { success: true, error: null, qrCode, instanceId: createdInstance.rows[0].id };

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
            `SELECT
                i.instance_name,
                i.type,
                to_jsonb(i)->>'telegram_bot_token' AS telegram_bot_token,
                c.api_url,
                c.api_key
           FROM evolution_api_instances i
           JOIN whatsapp_clusters c ON i.cluster_id = c.id
           WHERE i.id = $1`,
            [instanceId]
        );
        if (instanceRes.rows.length === 0) {
            return { error: 'Instância ou cluster associado não encontrado.' };
        }
        const { instance_name: instanceName, api_url, api_key, type, telegram_bot_token: telegramBotToken } = instanceRes.rows[0];
        const workspaceId = await requireInstanceAccess(instanceName, 'workspace:settings:edit');
        const apiConfig = { api_url, api_key };

        if (type === 'telegram' && telegramBotToken) {
            await deleteTelegramWebhook(telegramBotToken).catch((error) => {
                console.error('[EVO_ACTION_DELETE_INSTANCE] Falha ao remover webhook Telegram:', error);
            });
        }

        // Chamar a API para deletar
        await fetchEvolutionAPI(`/instance/delete/${instanceName}`, apiConfig, { method: 'DELETE' });

        // Se a chamada da API for bem-sucedida, delete do DB local
        await db.query('DELETE FROM evolution_api_instances WHERE id = $1 AND workspace_id = $2', [instanceId, workspaceId]);

    } catch (error: any) {
        console.error('[EVO_ACTION_DELETE_INSTANCE] Error deleting instance:', error);
        // Mesmo se a API falhar, tentamos remover do nosso DB
        return { error: `Falha ao deletar instância. Erro: ${error.message}` };
    }

    revalidatePath('/integrations/whatsapp-api');
    return { error: null };
}

async function getApiConfigForInstance(instanceName: string): Promise<{ api_url: string; api_key: string; } | null> {
    return getEvolutionApiConfig(instanceName);
}

export async function checkInstanceStatus(instanceName: string): Promise<{ status: EvolutionInstance['status'], qrCode?: string; error?: string }> {
    try {
        await requireInstanceAccess(instanceName, null);
        const telegramInstance = await getTelegramInstanceRecord(instanceName);
        if (telegramInstance) {
            if (!telegramInstance.telegram_bot_token) {
                return { status: 'disconnected' };
            }

            await validateTelegramBotToken(telegramInstance.telegram_bot_token);
            const webhookInfo = await getTelegramWebhookInfo(telegramInstance.telegram_bot_token);
            return { status: webhookInfo?.url ? 'connected' : 'pending' };
        }

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
        return { status: 'disconnected', error: 'Não foi possível consultar o status desta conexão.' };
    }
}

export async function connectInstance(instanceName: string): Promise<{ status: EvolutionInstance['status'], qrCode?: string; error?: string }> {
    try {
        await requireInstanceAccess(instanceName, 'workspace:settings:edit');
        const telegramInstance = await getTelegramInstanceRecord(instanceName);
        if (telegramInstance) {
            if (!telegramInstance.telegram_bot_token || !telegramInstance.webhook_key) {
                return { status: 'disconnected' };
            }

            const webhookUrl = telegramInstance.telegram_webhook_url || buildTelegramWebhookUrl(telegramInstance.webhook_key);
            await setTelegramWebhook(telegramInstance.telegram_bot_token, webhookUrl, telegramInstance.webhook_key);
            return { status: 'connected' };
        }

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
        return { status: 'disconnected', error: 'Não foi possível iniciar esta conexão. Tente novamente.' };
    }
}

export async function disconnectInstance(instanceName: string): Promise<{ status: EvolutionInstance['status']; error?: string }> {
    try {
        await requireInstanceAccess(instanceName, 'workspace:settings:edit');
        const telegramInstance = await getTelegramInstanceRecord(instanceName);
        if (telegramInstance?.telegram_bot_token) {
            await deleteTelegramWebhook(telegramInstance.telegram_bot_token);
            return { status: 'disconnected' };
        }

        const apiConfig = await getApiConfigForInstance(instanceName);
        if (!apiConfig) throw new Error(`Configuração de API não encontrada para ${instanceName}`);
        await fetchEvolutionAPI(`/instance/logout/${instanceName}`, apiConfig, { method: 'DELETE' });
        return { status: 'disconnected' };
    } catch (error) {
        console.error(`[EVO_ACTION_DISCONNECT] Erro ao desconectar instância ${instanceName}:`, error);
        return { status: 'disconnected', error: 'Não foi possível confirmar a desconexão.' };
    }
}

export async function restartInstance(instanceName: string): Promise<{ success: boolean; error?: string }> {
    try {
        await requireInstanceAccess(instanceName, 'workspace:settings:edit');
        const telegramInstance = await getTelegramInstanceRecord(instanceName);
        if (telegramInstance) {
            if (!telegramInstance.telegram_bot_token || !telegramInstance.webhook_key) {
                throw new Error('Credenciais Telegram ausentes para esta instancia.');
            }

            const webhookUrl = telegramInstance.telegram_webhook_url || buildTelegramWebhookUrl(telegramInstance.webhook_key);
            await setTelegramWebhook(telegramInstance.telegram_bot_token, webhookUrl, telegramInstance.webhook_key);
            return { success: true };
        }

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

        const msgRes = await client.query(
            `SELECT m.message_id_from_api, m.from_me, m.chat_id, c.workspace_id
               FROM messages m
               JOIN chats c ON c.id = m.chat_id
              WHERE m.id = $1`,
            [messageId]
        );
        if (msgRes.rowCount === 0) throw new Error("Mensagem não encontrada no banco de dados.");
        const { message_id_from_api: apiMessageId, from_me: fromMe, chat_id, workspace_id: workspaceId } = msgRes.rows[0];
        await requireWorkspacePermission(workspaceId, 'inbox:access');
        const instanceWorkspaceId = await requireInstanceAccess(instanceName, null);
        if (instanceWorkspaceId !== workspaceId) throw new Error('Instância não pertence ao workspace da mensagem.');

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

        await client.query(
            `UPDATE messages m
                SET api_message_status = 'DELETED', content = 'Mensagem apagada'
               FROM chats c
              WHERE m.id = $1
                AND c.id = m.chat_id
                AND c.workspace_id = $2`,
            [messageId, workspaceId]
        );

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
        await requireInstanceAccess(instanceName, 'workspace:settings:edit');
        const apiConfig = await getApiConfigForInstance(instanceName);
        if (!apiConfig) throw new Error(`Configuração de API não encontrada para ${instanceName}`);
        const requestOptions = {
            method: 'POST',
            body: JSON.stringify(payload)
        };

        try {
            await fetchEvolutionAPI(`/template/create/${instanceName}`, apiConfig, requestOptions);
        } catch (error: any) {
            const message = error?.message || '';
            if (!message.includes('Evolution API Error: 404')) {
                throw error;
            }

            console.warn(`[EVO_ACTION_CREATE_TEMPLATE] /template/create unavailable for ${instanceName}; retrying legacy /template/add endpoint.`);
            await fetchEvolutionAPI(`/template/add/${instanceName}`, apiConfig, requestOptions);
        }
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
        await requireInstanceAccess(instanceName, null);
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
        await requireInstanceAccess(instanceName, null);
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
        await requireInstanceAccess(instanceName, 'workspace:settings:edit');
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
