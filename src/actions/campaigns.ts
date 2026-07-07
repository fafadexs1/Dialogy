
'use server';

import { db } from '@/lib/db';
import { hasWorkspacePermission } from '@/lib/workspace-permissions';
import { revalidatePath } from 'next/cache';
import type { Campaign, CampaignChannel, CampaignDetails, CampaignMediaAttachment, CampaignRecipientDetail, CampaignScheduleConfig, CampaignTemplate } from '@/lib/types';
import { sendAgentTemplateAction, sendAutomatedMessageAction } from './messages';
import { createClient } from '@/lib/supabase/server';
import { randomUUID } from 'crypto';
import { buildChatProtocol } from '@/lib/utils';
import {
    extractWhatsappDigits,
    findOrCreateWhatsappContact,
    normalizeWhatsappJid,
} from '@/lib/whatsapp/contact-identity';
import {
    buildSegmentAudienceQuery,
    combineSegmentCriteria,
    type CriteriaGroup,
} from '@/lib/crm-query-builder';
import {
    buildCampaignRecipientSchedule,
    normalizeCampaignScheduleConfig,
} from '@/services/campaigns/schedule';
import {
    buildCampaignTemplateSendComponents,
    renderCampaignMessage,
} from '@/lib/campaigns/personalization';

export type CampaignDeliveryTarget = {
    channel: CampaignChannel;
    instanceName?: string;
    metaChannelId?: string;
    template?: CampaignTemplate | null;
};

function normalizeCsvWhatsappIdentity(value?: string | null): string | null {
    const raw = String(value || '').trim();
    const digits = extractWhatsappDigits(raw);
    if (!raw || !digits) return null;

    if (!raw.startsWith('+') && !raw.includes('@') && (digits.length === 10 || digits.length === 11)) {
        return normalizeWhatsappJid(`55${digits}`);
    }

    return normalizeWhatsappJid(raw);
}

function normalizeCampaignMediaAttachment(
    attachment?: CampaignMediaAttachment | null
): CampaignMediaAttachment | null {
    if (!attachment) return null;

    const type = attachment.type === 'audio' ? 'audio' : attachment.type === 'image' ? 'image' : null;
    const url = String(attachment.url || '').trim();
    const mimetype = String(attachment.mimetype || '').trim();
    const filename = String(attachment.filename || '').trim();

    if (!type || !url || !/^https?:\/\//i.test(url) || !mimetype || !filename) {
        return null;
    }

    if (type === 'image' && !mimetype.startsWith('image/')) return null;
    if (type === 'audio' && !mimetype.startsWith('audio/')) return null;

    return {
        type,
        url,
        mimetype,
        filename,
        storageBucket: attachment.storageBucket,
        storagePath: attachment.storagePath,
    };
}

function revalidateCampaignsSafely() {
    try {
        revalidatePath('/campaigns');
    } catch (error) {
        console.warn('[CAMPAIGN_WORKER] Failed to revalidate campaign list.', error);
    }
}

async function updateCampaignFinalStatus(campaignId: string): Promise<'completed' | 'failed'> {
    const totalsRes = await db.query(
        `SELECT
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE status = 'sent')::int AS sent
         FROM campaign_recipients
         WHERE campaign_id = $1`,
        [campaignId]
    );
    const totals = totalsRes.rows[0] || { total: 0, sent: 0 };
    const finalStatus: 'completed' | 'failed' = totals.total > 0 && totals.sent === totals.total
        ? 'completed'
        : 'failed';
    await db.query(
        `UPDATE campaigns
         SET status = $1,
             completed_at = NOW(),
             updated_at = NOW()
         WHERE id = $2`,
        [finalStatus, campaignId]
    );
    return finalStatus;
}

export async function getCampaigns(workspaceId: string): Promise<{ campaigns: Campaign[] | null, error?: string }> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { campaigns: null, error: "Usuário não autenticado." };
    if (!await hasWorkspacePermission(user.id, workspaceId, 'campaigns:manage')) {
        return { campaigns: null, error: 'Você não tem permissão para visualizar campanhas.' };
    }

    try {
        const res = await db.query(`
            SELECT 
                c.*,
                (SELECT COUNT(*) FROM campaign_recipients cr WHERE cr.campaign_id = c.id) as total_recipients,
                (SELECT COUNT(*) FROM campaign_recipients cr WHERE cr.campaign_id = c.id AND cr.status = 'sent') as sent_recipients,
                (SELECT COUNT(*) FROM campaign_recipients cr WHERE cr.campaign_id = c.id AND cr.status IN ('sent', 'failed', 'cancelled')) as processed_recipients,
                COALESCE(
                    NULLIF(c.delivery_channel, ''),
                    CASE WHEN i.type = 'wa_cloud' THEN 'whatsapp_cloud' ELSE 'whatsapp_baileys' END
                ) as channel,
                c.created_at as "lastUpdate"
            FROM campaigns c
            LEFT JOIN evolution_api_instances i ON i.instance_name = c.instance_name
            WHERE c.workspace_id = $1
            ORDER BY c.created_at DESC
        `, [workspaceId]);

        const campaigns: Campaign[] = res.rows.map(row => {
            const totalRecipients = Number.parseInt(row.total_recipients, 10) || 0;
            const sentRecipients = Number.parseInt(row.sent_recipients, 10) || 0;
            const processedRecipients = Number.parseInt(row.processed_recipients, 10) || 0;
            const progress = totalRecipients > 0 ? (processedRecipients / totalRecipients) * 100 : 0;

            return {
                ...row,
                progress,
                recipients: totalRecipients,
                status: totalRecipients > 0 && sentRecipients === totalRecipients ? 'completed' : row.status,
                deliveredPct: totalRecipients > 0 ? (sentRecipients / totalRecipients) * 100 : 0,
            };
        });

        return { campaigns };
    } catch (error) {
        console.error('[GET_CAMPAIGNS_ACTION]', error);
        return { campaigns: null, error: 'Falha ao buscar campanhas.' };
    }
}

export async function getCampaignDetails(workspaceId: string, campaignId: string): Promise<{ campaign: CampaignDetails | null, error?: string }> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { campaign: null, error: 'Usuario nao autenticado.' };
    if (!await hasWorkspacePermission(user.id, workspaceId, 'campaigns:manage')) {
        return { campaign: null, error: 'Você não tem permissão para visualizar esta campanha.' };
    }

    try {
        const campaignRes = await db.query(
            `SELECT c.*,
                    COALESCE(
                        NULLIF(c.delivery_channel, ''),
                        CASE WHEN i.type = 'wa_cloud' THEN 'whatsapp_cloud' ELSE 'whatsapp_baileys' END
                    ) AS channel,
                    c.created_at AS "lastUpdate"
             FROM campaigns c
             LEFT JOIN evolution_api_instances i ON i.instance_name = c.instance_name
             WHERE c.workspace_id = $1 AND c.id = $2
             LIMIT 1`,
            [workspaceId, campaignId]
        );

        if ((campaignRes.rowCount ?? 0) === 0) {
            return { campaign: null, error: 'Campanha nao encontrada.' };
        }

        const recipientsRes = await db.query(
            `SELECT cr.id,
                    cr.campaign_id,
                     cr.contact_id,
                     cr.status,
                     cr.scheduled_at,
                     cr.attempt_count,
                     cr.max_attempts,
                     cr.last_attempt_at,
                     cr.sent_at,
                    cr.error_message,
                    ct.name AS contact_name,
                    ct.phone_number_jid,
                    linked_message.id AS message_id,
                    linked_message.api_message_status
             FROM campaign_recipients cr
             JOIN contacts ct ON ct.id = cr.contact_id
             LEFT JOIN LATERAL (
                SELECT m.id, m.api_message_status
                FROM messages m
                WHERE m.id = cr.message_id
                   OR m.metadata ->> 'campaignRecipientId' = cr.id::text
                ORDER BY m.created_at DESC
                LIMIT 1
             ) linked_message ON TRUE
             WHERE cr.campaign_id = $1
             ORDER BY ct.name ASC, cr.id ASC`,
            [campaignId]
        );

        const recipientDetails = recipientsRes.rows as CampaignRecipientDetail[];
        const total = recipientDetails.length;
        const linkedMessages = recipientDetails.filter(recipient => Boolean(recipient.message_id)).length;
        const sent = recipientDetails.filter(recipient => recipient.status === 'sent').length;
        const failed = recipientDetails.filter(recipient => recipient.status === 'failed').length;
        const pending = recipientDetails.filter(recipient =>
            ['waiting', 'scheduled', 'processing'].includes(recipient.status)
        ).length;
        const paused = recipientDetails.filter(recipient => recipient.status === 'paused').length;
        const cancelled = recipientDetails.filter(recipient => recipient.status === 'cancelled').length;
        const processed = sent + failed + cancelled;
        const deliveryStatuses = new Set(['DELIVERED', 'DELIVERY', 'DELIVERY_ACK', 'READ', 'PLAYED']);
        const readStatuses = new Set(['READ', 'PLAYED']);
        const delivered = recipientDetails.filter(recipient => deliveryStatuses.has(String(recipient.api_message_status || '').toUpperCase())).length;
        const read = recipientDetails.filter(recipient => readStatuses.has(String(recipient.api_message_status || '').toUpperCase())).length;
        const campaign = campaignRes.rows[0] as Campaign;

        return {
            campaign: {
                ...campaign,
                recipients: total,
                progress: total > 0 ? (processed / total) * 100 : 0,
                deliveredPct: total > 0 ? (delivered / total) * 100 : 0,
                status: total > 0 && sent === total ? 'completed' : campaign.status,
                metrics: {
                    total,
                    sent,
                    delivered,
                    read,
                    failed,
                    pending,
                    paused,
                    cancelled,
                    linkedMessages,
                    deliveryRate: total > 0 ? (delivered / total) * 100 : 0,
                    readRate: total > 0 ? (read / total) * 100 : 0,
                },
                recipientDetails,
            },
        };
    } catch (error) {
        console.error('[GET_CAMPAIGN_DETAILS_ACTION]', error);
        return { campaign: null, error: 'Falha ao buscar detalhes da campanha.' };
    }
}

export async function createCampaign(
    workspaceId: string,
    delivery: CampaignDeliveryTarget | string,
    message: string,
    contactIdentifiers: { id: string, name: string, phone_number_jid?: string }[],
    segmentIds: string[] = [],
    requestedSchedule?: Partial<CampaignScheduleConfig>,
    mediaAttachment?: CampaignMediaAttachment | null,
): Promise<{ campaign: Campaign | null, error?: string }> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { campaign: null, error: "Usuário não autenticado." };

    const target: CampaignDeliveryTarget = typeof delivery === 'string'
        ? { channel: 'whatsapp_baileys', instanceName: delivery }
        : delivery;
    const instanceName = target.instanceName?.trim();
    const metaChannelId = target.metaChannelId?.trim();
    const destinationId = instanceName || metaChannelId;
    const selectedSegmentIds = [...new Set(segmentIds.filter(Boolean))];
    const scheduleConfig = normalizeCampaignScheduleConfig(requestedSchedule);
    const normalizedMediaAttachment = normalizeCampaignMediaAttachment(mediaAttachment);

    if (!workspaceId || !destinationId || !message || (contactIdentifiers.length === 0 && selectedSegmentIds.length === 0)) {
        return { campaign: null, error: 'Dados da campanha incompletos.' };
    }
    if (!scheduleConfig.consentConfirmed) {
        return { campaign: null, error: 'Confirme que os destinatarios consentiram em receber esta campanha.' };
    }
    if (target.channel === 'whatsapp_cloud' && !target.template?.name) {
        return { campaign: null, error: 'Selecione um template aprovado para a campanha do WhatsApp Cloud.' };
    }
    if (mediaAttachment && !normalizedMediaAttachment) {
        return { campaign: null, error: 'Anexo invalido. Envie uma imagem ou audio com URL publica HTTPS.' };
    }
    if (normalizedMediaAttachment && target.channel !== 'whatsapp_baileys') {
        return { campaign: null, error: 'Anexos de imagem e audio estao disponiveis apenas para WhatsApp conectado.' };
    }
    if (!target.channel.startsWith('whatsapp') && contactIdentifiers.some(contact => contact.id.startsWith('csv-'))) {
        return { campaign: null, error: 'A importacao CSV esta disponivel apenas para campanhas de WhatsApp.' };
    }
    if (!await hasWorkspacePermission(user.id, workspaceId, 'campaigns:manage')) {
        return { campaign: null, error: 'Você não tem permissão para criar campanhas neste workspace.' };
    }

    // --- BILLING: Check Campaign Access ---
    const { getWorkspaceLimits } = await import('@/lib/billing-logic');
    const { limits, plan } = await getWorkspaceLimits(workspaceId);

    // Check if campaigns are allowed at all (Starter = false)
    if (!limits.campaigns) {
        return {
            campaign: null,
            error: `O plano ${plan.toUpperCase()} não permite criar Campanhas de Disparo. Faça upgrade para o plano PRO.`
        };
    }
    // --------------------------------------

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        if (target.channel === 'whatsapp_baileys' || target.channel === 'whatsapp_cloud') {
            const instanceRes = await client.query(
                `SELECT type FROM evolution_api_instances WHERE workspace_id = $1 AND instance_name = $2 LIMIT 1`,
                [workspaceId, instanceName]
            );
            const expectedType = target.channel === 'whatsapp_cloud' ? 'wa_cloud' : 'baileys';
            if (instanceRes.rows[0]?.type !== expectedType) {
                throw new Error('Instancia de WhatsApp invalida para o canal selecionado.');
            }
        } else if (target.channel === 'telegram') {
            const instanceRes = await client.query(
                `SELECT 1 FROM telegram_bot_instances WHERE workspace_id = $1 AND instance_name = $2 LIMIT 1`,
                [workspaceId, instanceName]
            );
            if ((instanceRes.rowCount ?? 0) === 0) {
                throw new Error('Bot Telegram nao encontrado no workspace.');
            }
        } else {
            const channelRes = await client.query(
                `SELECT 1 FROM meta_channels WHERE workspace_id = $1 AND id = $2 AND type = $3 AND status = 'active' LIMIT 1`,
                [workspaceId, metaChannelId, target.channel]
            );
            if ((channelRes.rowCount ?? 0) === 0) {
                throw new Error('Canal Meta ativo nao encontrado no workspace.');
            }
        }

        // 1. Create the campaign
        const storedInstanceName = instanceName || `meta:${target.channel}:${metaChannelId}`;
        const campaignRes = await client.query(
            `INSERT INTO campaigns (
                workspace_id, created_by_id, name, message, instance_name, status,
                delivery_channel, destination_id, template_payload, media_payload, schedule_config,
                scheduled_end_at, started_at
             )
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
                     CASE WHEN $6 = 'sending' THEN NOW() ELSE NULL END)
             RETURNING *`,
            [
                workspaceId,
                user.id,
                `Campanha ${new Date().toLocaleString()}`,
                message,
                storedInstanceName,
                scheduleConfig.mode === 'immediate' ? 'sending' : 'scheduled',
                target.channel,
                destinationId,
                target.template ? JSON.stringify(target.template) : null,
                normalizedMediaAttachment ? JSON.stringify(normalizedMediaAttachment) : null,
                JSON.stringify(scheduleConfig),
                scheduleConfig.endAt || null,
            ]
        );
        const newCampaign = campaignRes.rows[0];

        // 2. Resolve contacts and add recipients
        const crmContactIds = contactIdentifiers
            .filter(c => c.id.startsWith('crm-'))
            .map(c => c.id.replace('crm-', ''));

        const csvContactsData = contactIdentifiers
            .filter(c => c.id.startsWith('csv-'));

        let allContactIdsForCampaign: string[] = [];

        // Add existing CRM contacts
        if (crmContactIds.length > 0) {
            allContactIdsForCampaign.push(...crmContactIds);
        }

        // Resolve the current members of the selected CRM lists on the server.
        // This keeps campaigns accurate even when a list contains more contacts
        // than the browser preview can display.
        if (selectedSegmentIds.length > 0) {
            const segmentsRes = await client.query(
                `SELECT criteria
                 FROM crm_segments
                 WHERE workspace_id = $1
                   AND id = ANY($2::uuid[])`,
                [workspaceId, selectedSegmentIds]
            );

            if (segmentsRes.rows.length !== selectedSegmentIds.length) {
                throw new Error('Uma ou mais listas selecionadas não foram encontradas.');
            }

            const segmentCriteria = combineSegmentCriteria(
                segmentsRes.rows.map(row => row.criteria as CriteriaGroup)
            );
            const segmentContactsQuery = buildSegmentAudienceQuery(workspaceId, segmentCriteria);
            const segmentContactsRes = await client.query(
                segmentContactsQuery.text,
                segmentContactsQuery.values
            );
            allContactIdsForCampaign.push(
                ...segmentContactsRes.rows.map(row => String(row.id))
            );
        }

        // Handle CSV contacts: find existing by JID or create new ones
        for (const csvContact of csvContactsData) {
            if (!csvContact.phone_number_jid) continue; // Skip if no number

            const normalizedJid = normalizeCsvWhatsappIdentity(csvContact.phone_number_jid);
            if (!normalizedJid) continue;

            const resolvedContact = await findOrCreateWhatsappContact(client, {
                workspaceId,
                phoneOrJid: normalizedJid,
                fallbackName: csvContact.name,
            });
            const contactId = resolvedContact.contact.id;

            allContactIdsForCampaign.push(contactId);
        }

        // Remove duplicates and add to recipients table
        const uniqueContactIds = [...new Set(allContactIdsForCampaign)];
        if (uniqueContactIds.length === 0) {
            throw new Error('As listas e contatos selecionados não possuem destinatários válidos.');
        }
        const eligibleContactsRes = await client.query(
            `SELECT id
             FROM contacts
             WHERE workspace_id = $1
               AND id = ANY($2::uuid[])
               AND marketing_opt_out_at IS NULL
             ORDER BY id`,
            [workspaceId, uniqueContactIds]
        );
        const eligibleContactIds = eligibleContactsRes.rows.map(row => String(row.id));
        const optedOutCount = uniqueContactIds.length - eligibleContactIds.length;
        if (eligibleContactIds.length === 0) {
            throw new Error('Todos os contatos selecionados estao marcados como opt-out.');
        }

        const recipientSchedule = buildCampaignRecipientSchedule({
            recipientIds: eligibleContactIds,
            config: scheduleConfig,
        });

        await client.query(
            `INSERT INTO campaign_recipients (
                campaign_id, contact_id, status, scheduled_at, max_attempts
             )
             SELECT $1, schedule.contact_id, schedule.status, schedule.scheduled_at, $5
             FROM unnest($2::uuid[], $3::text[], $4::timestamptz[])
               AS schedule(contact_id, status, scheduled_at)
             ON CONFLICT (campaign_id, contact_id) DO NOTHING`,
            [
                newCampaign.id,
                recipientSchedule.map(item => item.recipientId),
                recipientSchedule.map(item => item.status),
                recipientSchedule.map(item => item.scheduledAt.toISOString()),
                scheduleConfig.maxAttempts,
            ]
        );

        await client.query(
            `UPDATE campaigns
             SET opted_out_count = $1,
                 updated_at = NOW()
             WHERE id = $2`,
            [optedOutCount, newCampaign.id]
        );


        await client.query('COMMIT');

        revalidatePath('/campaigns');

        return {
            campaign: {
                ...newCampaign,
                opted_out_count: optedOutCount,
                media_payload: normalizedMediaAttachment,
                schedule_config: scheduleConfig,
            },
        };

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('[CREATE_CAMPAIGN_ACTION]', error);
        return { campaign: null, error: error instanceof Error ? error.message : 'Falha ao criar a campanha no banco de dados.' };
    } finally {
        client.release();
    }
}

async function startCampaignSending(campaignId: string) {
    // NOTE: We do NOT hold a single client connection for the entire process anymore.
    // This prevents connection pool exhaustion during long campaigns.
    try {
        console.log(`[CAMPAIGN_WORKER] Iniciando envio para a campanha ${campaignId}`);

        await db.query("UPDATE campaigns SET status = 'sending', started_at = NOW() WHERE id = $1", [campaignId]);

        const recipientsRes = await db.query(
            `SELECT cr.id as recipient_id, c.id as contact_id, c.name as contact_name, c.phone_number_jid,
                    cam.message, cam.instance_name, cam.workspace_id,
                    cam.created_by_id,
                    COALESCE(NULLIF(cam.delivery_channel, ''), 'whatsapp_baileys') as delivery_channel,
                    cam.destination_id, cam.template_payload, cam.schedule_config
             FROM campaign_recipients cr
             JOIN contacts c ON cr.contact_id = c.id
             JOIN campaigns cam ON cr.campaign_id = cam.id
             WHERE cr.campaign_id = $1 AND cr.status = 'pending'`,
            [campaignId]
        );

        const recipients = recipientsRes.rows;
        console.log(`[CAMPAIGN_WORKER] Encontrados ${recipients.length} destinatários pendentes.`);

        for (const recipient of recipients) {
            let messageStatus: 'sent' | 'failed' = 'sent';
            let errorMessage: string | null = null;

            try {
                const channel = recipient.delivery_channel as CampaignChannel;
                const instanceName = channel === 'messenger' || channel === 'instagram'
                    ? undefined
                    : (recipient.destination_id || recipient.instance_name);
                let chatId: string | undefined;

                if (channel === 'messenger' || channel === 'instagram') {
                    const metaChatRes = await db.query(
                        `SELECT mc.chat_id AS id
                         FROM meta_conversations mc
                         JOIN meta_contacts mct ON mct.id = mc.meta_contact_id
                         WHERE mc.channel_id = $1 AND mct.contact_id = $2 AND mc.platform = $3
                         ORDER BY mc.last_message_at DESC
                         LIMIT 1`,
                        [recipient.destination_id, recipient.contact_id, channel]
                    );
                    chatId = metaChatRes.rows[0]?.id;
                    if (!chatId) {
                        throw new Error('Contato sem conversa existente no canal Meta selecionado.');
                    }
                } else {
                    if (channel === 'telegram' && !recipient.phone_number_jid?.startsWith('telegram:')) {
                        throw new Error('Contato sem identificador Telegram para este envio.');
                    }
                    if (channel.startsWith('whatsapp') && !recipient.phone_number_jid) {
                        throw new Error('Contato sem telefone WhatsApp para este envio.');
                    }
                    const chatRes = await db.query(
                        `SELECT c.id
                         FROM chats c
                         WHERE c.contact_id = $1 AND c.workspace_id = $2
                           AND c.status IN ('gerais', 'atendimentos')
                           AND NOT EXISTS (SELECT 1 FROM meta_conversations mc WHERE mc.chat_id = c.id)
                         LIMIT 1`,
                        [recipient.contact_id, recipient.workspace_id]
                    );
                    chatId = chatRes.rows[0]?.id;
                }

                if (!chatId) {
                    const newChatId = randomUUID();
                    const protocol = buildChatProtocol(newChatId);
                    const { getMonthlyChatLimitStatus } = await import('@/lib/billing-logic');
                    const chatLimitStatus = await getMonthlyChatLimitStatus(recipient.workspace_id);
                    if (!chatLimitStatus.allowed) {
                        throw new Error(`Limite mensal de chats do plano ${chatLimitStatus.plan.toUpperCase()} atingido.`);
                    }
                    const newChatRes = await db.query(
                        `INSERT INTO chats (id, workspace_id, contact_id, status, protocol) VALUES ($1, $2, $3, 'gerais'::chat_status_enum, $4) RETURNING id`,
                        [newChatId, recipient.workspace_id, recipient.contact_id, protocol]
                    );
                    chatId = newChatRes.rows[0].id;
                }

                const personalizationNow = new Date();
                const personalizedMessage = renderCampaignMessage(recipient.message, {
                    contactName: recipient.contact_name,
                    now: personalizationNow,
                    timeZone: recipient.schedule_config?.timeZone,
                });

                const campaignSenderId = recipient.created_by_id;
                const campaignMetadata = {
                    campaignId,
                    campaignRecipientId: recipient.recipient_id,
                };

                const result = channel === 'whatsapp_cloud' && recipient.template_payload
                    ? await sendAgentTemplateAction({
                        agentId: campaignSenderId,
                        workspaceId: recipient.workspace_id,
                        numberid: recipient.phone_number_jid,
                        instanceName: instanceName!,
                        name: recipient.template_payload.name,
                        language: recipient.template_payload.language,
                        components: buildCampaignTemplateSendComponents(recipient.template_payload, {
                            contactName: recipient.contact_name,
                            campaignMessage: recipient.message,
                            now: personalizationNow,
                            timeZone: recipient.schedule_config?.timeZone,
                        }),
                        renderedContent: personalizedMessage,
                        metadata: campaignMetadata,
                        senderUserId: campaignSenderId,
                    })
                    : await sendAutomatedMessageAction(chatId!, personalizedMessage, campaignSenderId, false, instanceName, campaignMetadata);

                if (!result.success) {
                    throw new Error(result.error || 'Falha na resposta da API ao enviar a mensagem.');
                }

            } catch (err: any) {
                messageStatus = 'failed';
                errorMessage = err.message;
                console.error(`[CAMPAIGN_WORKER] Falha ao enviar para ${recipient.phone_number_jid}:`, err.message);
            }

            // Update recipient status
            await db.query(
                `UPDATE campaign_recipients SET status = $1, error_message = $2, sent_at = CASE WHEN $1 = 'sent' THEN NOW() ELSE NULL END WHERE id = $3`,
                [messageStatus, errorMessage, recipient.recipient_id]
            );

            // Revalidate path after each send to provide real-time feedback
            revalidateCampaignsSafely();

            // Add a small delay to avoid rate limiting
            // During this delay, NO database connection is held!
            await new Promise(resolve => setTimeout(resolve, 2000));
        }

        const finalStatus = await updateCampaignFinalStatus(campaignId);
        revalidateCampaignsSafely();
        console.log(`[CAMPAIGN_WORKER] Campanha ${campaignId} concluída com status: ${finalStatus}.`);

    } catch (error) {
        console.error(`[CAMPAIGN_WORKER] Erro fatal no worker da campanha ${campaignId}:`, error);
        await updateCampaignFinalStatus(campaignId);
        revalidateCampaignsSafely();
    }
}

async function getAuthorizedCampaignWorkspace(campaignId: string): Promise<{
    userId?: string;
    workspaceId?: string;
    error?: string;
}> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        return { error: 'Usuario nao autenticado.' };
    }
    const result = await db.query(
        'SELECT workspace_id FROM campaigns WHERE id = $1 LIMIT 1',
        [campaignId]
    );
    const workspaceId = result.rows[0]?.workspace_id;
    if (!workspaceId) {
        return { error: 'Campanha nao encontrada.' };
    }
    if (!await hasWorkspacePermission(user.id, workspaceId, 'campaigns:manage')) {
        return { error: 'Voce nao tem permissao para gerenciar esta campanha.' };
    }
    return { userId: user.id, workspaceId };
}

export async function pauseCampaign(campaignId: string): Promise<{ success: boolean; error?: string }> {
    const access = await getAuthorizedCampaignWorkspace(campaignId);
    if (access.error) return { success: false, error: access.error };

    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const result = await client.query(
            `UPDATE campaigns
             SET status = 'paused',
                 paused_at = NOW(),
                 pause_reason = 'Pausada manualmente.',
                 updated_at = NOW()
             WHERE id = $1
               AND status IN ('scheduled', 'sending')
             RETURNING id`,
            [campaignId]
        );
        if ((result.rowCount ?? 0) === 0) {
            throw new Error('A campanha nao esta em um estado que possa ser pausado.');
        }
        await client.query(
            `UPDATE campaign_recipients
             SET status = 'paused',
                 locked_at = NULL,
                 locked_by = NULL,
                 updated_at = NOW()
             WHERE campaign_id = $1
               AND status IN ('waiting', 'scheduled')`,
            [campaignId]
        );
        await client.query('COMMIT');
        revalidatePath('/campaigns');
        return { success: true };
    } catch (error) {
        await client.query('ROLLBACK');
        return { success: false, error: error instanceof Error ? error.message : 'Falha ao pausar campanha.' };
    } finally {
        client.release();
    }
}

export async function resumeCampaign(campaignId: string): Promise<{ success: boolean; error?: string }> {
    const access = await getAuthorizedCampaignWorkspace(campaignId);
    if (access.error) return { success: false, error: access.error };

    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const result = await client.query(
            `UPDATE campaigns
             SET status = CASE
                   WHEN EXISTS (
                     SELECT 1 FROM campaign_recipients cr
                     WHERE cr.campaign_id = campaigns.id
                       AND cr.scheduled_at <= NOW()
                   ) THEN 'sending'
                   ELSE 'scheduled'
                 END,
                 paused_at = NULL,
                 pause_reason = NULL,
                 updated_at = NOW()
             WHERE id = $1
               AND status = 'paused'
             RETURNING id`,
            [campaignId]
        );
        if ((result.rowCount ?? 0) === 0) {
            throw new Error('A campanha nao esta pausada.');
        }
        await client.query(
            `UPDATE campaign_recipients
             SET status = CASE WHEN scheduled_at <= NOW() THEN 'waiting' ELSE 'scheduled' END,
                 updated_at = NOW()
             WHERE campaign_id = $1
               AND status = 'paused'`,
            [campaignId]
        );
        await client.query('COMMIT');
        revalidatePath('/campaigns');
        return { success: true };
    } catch (error) {
        await client.query('ROLLBACK');
        return { success: false, error: error instanceof Error ? error.message : 'Falha ao retomar campanha.' };
    } finally {
        client.release();
    }
}

export async function cancelCampaign(campaignId: string): Promise<{ success: boolean; error?: string }> {
    const access = await getAuthorizedCampaignWorkspace(campaignId);
    if (access.error) return { success: false, error: access.error };

    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const result = await client.query(
            `UPDATE campaigns
             SET status = 'cancelled',
                 cancelled_at = NOW(),
                 updated_at = NOW()
             WHERE id = $1
               AND status IN ('draft', 'scheduled', 'sending', 'paused')
             RETURNING id`,
            [campaignId]
        );
        if ((result.rowCount ?? 0) === 0) {
            throw new Error('A campanha nao esta em um estado que possa ser cancelado.');
        }
        await client.query(
            `UPDATE campaign_recipients
             SET status = 'cancelled',
                 cancelled_at = NOW(),
                 locked_at = NULL,
                 locked_by = NULL,
                 updated_at = NOW()
             WHERE campaign_id = $1
               AND status IN ('waiting', 'scheduled', 'paused')`,
            [campaignId]
        );
        await client.query('COMMIT');
        revalidatePath('/campaigns');
        return { success: true };
    } catch (error) {
        await client.query('ROLLBACK');
        return { success: false, error: error instanceof Error ? error.message : 'Falha ao cancelar campanha.' };
    } finally {
        client.release();
    }
}


export async function deleteCampaign(campaignId: string): Promise<{ success: boolean; error?: string }> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: "Usuário não autenticado." };

    const client = await db.connect();
    try {
        // Find workspace to check permissions
        const campaignRes = await client.query('SELECT workspace_id FROM campaigns WHERE id = $1', [campaignId]);
        if (campaignRes.rowCount === 0) {
            return { success: false, error: 'Campanha não encontrada.' };
        }
        const { workspace_id } = campaignRes.rows[0];

        // Permission check
        if (!await hasWorkspacePermission(user.id, workspace_id, 'campaigns:delete')) {
            return { success: false, error: 'Você não tem permissão para excluir campanhas.' };
        }

        await client.query('BEGIN');
        // Delete recipients first due to foreign key constraint
        await client.query('DELETE FROM campaign_recipients WHERE campaign_id = $1', [campaignId]);
        // Then delete the campaign
        await client.query('DELETE FROM campaigns WHERE id = $1', [campaignId]);
        await client.query('COMMIT');

        revalidatePath('/campaigns');
        return { success: true };

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('[DELETE_CAMPAIGN_ACTION]', error);
        return { success: false, error: 'Falha ao excluir a campanha no banco de dados.' };
    } finally {
        client.release();
    }
}

export async function deleteCampaigns(campaignIds: string[]): Promise<{ success: boolean; error?: string }> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: "Usuário não autenticado." };

    const client = await db.connect();
    try {
        const campaignRes = await client.query('SELECT workspace_id FROM campaigns WHERE id = $1', [campaignIds[0]]);
        if (campaignRes.rowCount === 0) {
            return { success: false, error: 'Campanha não encontrada.' };
        }
        const { workspace_id } = campaignRes.rows[0];

        // Permission check
        if (!await hasWorkspacePermission(user.id, workspace_id, 'campaigns:delete')) {
            return { success: false, error: 'Você não tem permissão para excluir campanhas.' };
        }

        await client.query('BEGIN');
        await client.query('DELETE FROM campaign_recipients WHERE campaign_id = ANY($1::uuid[])', [campaignIds]);
        await client.query('DELETE FROM campaigns WHERE id = ANY($1::uuid[])', [campaignIds]);
        await client.query('COMMIT');

        revalidatePath('/campaigns');
        return { success: true };
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('[DELETE_CAMPAIGNS_ACTION]', error);
        return { success: false, error: 'Falha ao excluir as campanhas no banco de dados.' };
    } finally {
        client.release();
    }
}
