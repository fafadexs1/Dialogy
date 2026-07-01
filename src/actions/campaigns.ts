
'use server';

import { db } from '@/lib/db';
import { hasWorkspacePermission } from '@/lib/workspace-permissions';
import { revalidatePath } from 'next/cache';
import type { Campaign, CampaignChannel, CampaignDetails, CampaignRecipientDetail, CampaignTemplate } from '@/lib/types';
import { sendAgentTemplateAction, sendAutomatedMessageAction } from './messages';
import { createClient } from '@/lib/supabase/server';
import { randomUUID } from 'crypto';
import { buildChatProtocol } from '@/lib/utils';
import {
    findOrCreateWhatsappContact,
    normalizeWhatsappJid,
} from '@/lib/whatsapp/contact-identity';
import {
    buildSegmentAudienceQuery,
    combineSegmentCriteria,
    type CriteriaGroup,
} from '@/lib/crm-query-builder';

export type CampaignDeliveryTarget = {
    channel: CampaignChannel;
    instanceName?: string;
    metaChannelId?: string;
    template?: CampaignTemplate | null;
};

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
             completed_at = CASE WHEN $1 = 'completed' THEN COALESCE(completed_at, NOW()) ELSE completed_at END
         WHERE id = $2`,
        [finalStatus, campaignId]
    );

    return finalStatus;
}

function buildTemplateSendComponents(template: CampaignTemplate, contactName: string): any[] {
    const body = template.components?.find(component => String(component.type).toUpperCase() === 'BODY');
    const placeholderCount = (String(body?.text || '').match(/\{\{\d+\}\}/g) || []).length;

    if (placeholderCount === 0) {
        return [];
    }

    return [{
        type: 'body',
        parameters: Array.from({ length: placeholderCount }, () => ({
            type: 'text',
            text: contactName,
        })),
    }];
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
            const progress = totalRecipients > 0 ? (sentRecipients / totalRecipients) * 100 : 0;

            return {
                ...row,
                progress,
                recipients: totalRecipients,
                status: totalRecipients > 0 && sentRecipients === totalRecipients ? 'completed' : row.status,
                deliveredPct: progress,
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
                WHERE m.metadata ->> 'campaignRecipientId' = cr.id::text
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
        const pending = recipientDetails.filter(recipient => recipient.status === 'pending').length;
        const deliveryStatuses = new Set(['DELIVERED', 'DELIVERY', 'DELIVERY_ACK', 'READ', 'PLAYED']);
        const readStatuses = new Set(['READ', 'PLAYED']);
        const delivered = recipientDetails.filter(recipient => deliveryStatuses.has(String(recipient.api_message_status || '').toUpperCase())).length;
        const read = recipientDetails.filter(recipient => readStatuses.has(String(recipient.api_message_status || '').toUpperCase())).length;
        const campaign = campaignRes.rows[0] as Campaign;

        return {
            campaign: {
                ...campaign,
                recipients: total,
                progress: total > 0 ? (sent / total) * 100 : 0,
                deliveredPct: total > 0 ? (delivered / total) * 100 : 0,
                status: total > 0 && sent === total ? 'completed' : campaign.status,
                metrics: {
                    total,
                    sent,
                    delivered,
                    read,
                    failed,
                    pending,
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
    segmentIds: string[] = []
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

    if (!workspaceId || !destinationId || !message || (contactIdentifiers.length === 0 && selectedSegmentIds.length === 0)) {
        return { campaign: null, error: 'Dados da campanha incompletos.' };
    }
    if (target.channel === 'whatsapp_cloud' && !target.template?.name) {
        return { campaign: null, error: 'Selecione um template aprovado para a campanha do WhatsApp Cloud.' };
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
                delivery_channel, destination_id, template_payload
             )
             VALUES ($1, $2, $3, $4, $5, 'draft', $6, $7, $8) RETURNING *`,
            [
                workspaceId,
                user.id,
                `Campanha ${new Date().toLocaleString()}`,
                message,
                storedInstanceName,
                target.channel,
                destinationId,
                target.template ? JSON.stringify(target.template) : null,
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

            const normalizedJid = normalizeWhatsappJid(csvContact.phone_number_jid);
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
        await client.query(
            `INSERT INTO campaign_recipients (campaign_id, contact_id)
             SELECT $1, recipient_id
             FROM unnest($2::uuid[]) AS recipient_id`,
            [newCampaign.id, uniqueContactIds]
        );


        await client.query('COMMIT');

        // Now, start sending process and wait for it to complete.
        // We do this in the background to not block the UI response
        startCampaignSending(newCampaign.id);

        revalidatePath('/campaigns');

        return { campaign: newCampaign };

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
                    cam.destination_id, cam.template_payload
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

                // Personalize message
                const personalizedMessage = recipient.message.replace(/{{nome}}/gi, recipient.contact_name);

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
                        components: buildTemplateSendComponents(recipient.template_payload, recipient.contact_name),
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
