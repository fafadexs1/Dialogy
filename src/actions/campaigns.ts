

'use server';

import { db } from '@/lib/db';
import { revalidatePath } from 'next/cache';
import type { Campaign, CampaignRecipient, Contact } from '@/lib/types';
import { sendAutomatedMessageAction } from './messages';
import { createClient } from '@/lib/supabase/server';
import { cookies } from 'next/headers';

async function hasPermission(userId: string, workspaceId: string, permission: string): Promise<boolean> {
    const res = await db.query(`
        SELECT 1
        FROM user_workspace_roles uwr
        JOIN role_permissions rp ON uwr.role_id = rp.role_id
        WHERE uwr.user_id = $1 AND uwr.workspace_id = $2 AND rp.permission_id = $3
    `, [userId, workspaceId, permission]);
    // For now, let's assume if they are part of the workspace, they can manage campaigns.
    // Replace with a real permission like 'campaigns:manage' later.
    const memberCheck = await db.query('SELECT 1 FROM user_workspace_roles WHERE user_id = $1 AND workspace_id = $2', [userId, workspaceId]);
    return memberCheck.rowCount > 0;
}


export async function getCampaigns(workspaceId: string): Promise<{ campaigns: Campaign[] | null, error?: string }> {
    const supabase = createClient(cookies());
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { campaigns: null, error: "Usuário não autenticado." };

    try {
        const res = await db.query(`
            SELECT 
                c.*,
                (SELECT COUNT(*) FROM campaign_recipients cr WHERE cr.campaign_id = c.id) as total_recipients,
                (SELECT COUNT(*) FROM campaign_recipients cr WHERE cr.campaign_id = c.id AND cr.status = 'sent') as sent_recipients,
                'parallel' as channel,
                c.created_at as "lastUpdate"
            FROM campaigns c
            WHERE c.workspace_id = $1
            ORDER BY c.created_at DESC
        `, [workspaceId]);

        const campaigns: Campaign[] = res.rows.map(row => ({
            ...row,
            progress: row.total_recipients > 0 ? (row.sent_recipients / row.total_recipients) * 100 : 0,
            recipients: parseInt(row.total_recipients, 10),
            status: row.status,
            deliveredPct: row.total_recipients > 0 ? (row.sent_recipients / row.total_recipients) * 100 : 0,
        }));

        return { campaigns };
    } catch (error) {
        console.error('[GET_CAMPAIGNS_ACTION]', error);
        return { campaigns: null, error: 'Falha ao buscar campanhas.' };
    }
}

export async function createCampaign(
    workspaceId: string,
    instanceName: string,
    message: string,
    contactIdentifiers: { id: string, name: string, phone_number_jid?: string }[]
): Promise<{ campaign: Campaign | null, error?: string }> {
    const supabase = createClient(cookies());
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { campaign: null, error: "Usuário não autenticado." };
    
    if (!workspaceId || !instanceName || !message || contactIdentifiers.length === 0) {
        return { campaign: null, error: 'Dados da campanha incompletos.' };
    }

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        // 1. Create the campaign
        const campaignRes = await client.query(
            `INSERT INTO campaigns (workspace_id, created_by_id, name, message, instance_name, status)
             VALUES ($1, $2, $3, $4, $5, 'draft') RETURNING *`,
            [workspaceId, user.id, `Campanha ${new Date().toLocaleString()}`, message, instanceName]
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
        
        // Handle CSV contacts: find existing by JID or create new ones
        for (const csvContact of csvContactsData) {
            if (!csvContact.phone_number_jid) continue; // Skip if no number
            
            let contactId;
            const existingContactRes = await client.query(
                `SELECT id FROM contacts WHERE workspace_id = $1 AND phone_number_jid = $2`,
                [workspaceId, csvContact.phone_number_jid]
            );

            if (existingContactRes.rowCount > 0) {
                contactId = existingContactRes.rows[0].id;
            } else {
                const newContactRes = await client.query(
                    `INSERT INTO contacts (workspace_id, name, phone_number_jid) VALUES ($1, $2, $3) RETURNING id`,
                    [workspaceId, csvContact.name, csvContact.phone_number_jid]
                );
                contactId = newContactRes.rows[0].id;
            }
            allContactIdsForCampaign.push(contactId);
        }

        // Remove duplicates and add to recipients table
        const uniqueContactIds = [...new Set(allContactIdsForCampaign)];
        if(uniqueContactIds.length > 0) {
            const recipientValues = uniqueContactIds.map(contactId => `('${newCampaign.id}', '${contactId}')`).join(',');
            await client.query(
                `INSERT INTO campaign_recipients (campaign_id, contact_id) VALUES ${recipientValues}`
            );
        }


        await client.query('COMMIT');
        
        // Now, start sending process and wait for it to complete.
        await startCampaignSending(newCampaign.id);
        
        revalidatePath('/campaigns');

        return { campaign: newCampaign };

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('[CREATE_CAMPAIGN_ACTION]', error);
        return { campaign: null, error: 'Falha ao criar a campanha no banco de dados.' };
    } finally {
        client.release();
    }
}

async function startCampaignSending(campaignId: string) {
    const client = await db.connect();
    try {
        console.log(`[CAMPAIGN_WORKER] Iniciando envio para a campanha ${campaignId}`);
        
        await client.query("UPDATE campaigns SET status = 'sending', started_at = NOW() WHERE id = $1", [campaignId]);

        const recipientsRes = await client.query(
            `SELECT cr.id as recipient_id, c.id as contact_id, c.name as contact_name, c.phone_number_jid, cam.message, cam.instance_name, cam.workspace_id
             FROM campaign_recipients cr
             JOIN contacts c ON cr.contact_id = c.id
             JOIN campaigns cam ON cr.campaign_id = cam.id
             WHERE cr.campaign_id = $1 AND cr.status = 'pending'`,
            [campaignId]
        );
        
        const recipients = recipientsRes.rows;
        console.log(`[CAMPAIGN_WORKER] Encontrados ${recipients.length} destinatários pendentes.`);
        
        let hasFailures = false;
        for (const recipient of recipients) {
            let messageStatus: 'sent' | 'failed' = 'sent';
            let errorMessage: string | null = null;
            
            try {
                // Find or create a chat for the contact to send the message
                let chatRes = await client.query(
                    `SELECT id FROM chats WHERE contact_id = $1 AND workspace_id = $2 AND status IN ('gerais', 'atendimentos') LIMIT 1`,
                    [recipient.contact_id, recipient.workspace_id]
                );

                let chatId;
                if (chatRes.rowCount > 0) {
                    chatId = chatRes.rows[0].id;
                } else {
                    const newChatRes = await client.query(
                        `INSERT INTO chats (workspace_id, contact_id, status) VALUES ($1, $2, 'gerais'::chat_status_enum) RETURNING id`,
                        [recipient.workspace_id, recipient.contact_id]
                    );
                    chatId = newChatRes.rows[0].id;
                }
                
                // Personalize message
                const personalizedMessage = recipient.message.replace(/{{nome}}/gi, recipient.contact_name);

                // Use a generic system agent ID for now. This could be improved.
                const systemAgentId = '00000000-0000-0000-0000-000000000000'; 
                const result = await sendAutomatedMessageAction(chatId, personalizedMessage, systemAgentId, true, recipient.instance_name);
                
                // Check for the presence of the `key` object in the API response as a success indicator.
                if (!result.success || !result.apiResponse?.key?.id) {
                    throw new Error(result.error || 'Falha na resposta da API ao enviar a mensagem.');
                }

            } catch (err: any) {
                messageStatus = 'failed';
                errorMessage = err.message;
                hasFailures = true;
                console.error(`[CAMPAIGN_WORKER] Falha ao enviar para ${recipient.phone_number_jid}:`, err.message);
            }

            // Update recipient status
            await client.query(
                `UPDATE campaign_recipients SET status = $1, error_message = $2, sent_at = CASE WHEN $1 = 'sent' THEN NOW() ELSE NULL END WHERE id = $3`,
                [messageStatus, errorMessage, recipient.recipient_id]
            );
            
            // Revalidate path after each send to provide real-time feedback
            revalidatePath('/campaigns');
            
            // Add a small delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
        
        const finalStatus = hasFailures ? 'failed' : 'completed';
        await client.query("UPDATE campaigns SET status = $1, completed_at = NOW() WHERE id = $2", [finalStatus, campaignId]);
        revalidatePath('/campaigns');
        console.log(`[CAMPAIGN_WORKER] Campanha ${campaignId} concluída com status: ${finalStatus}.`);

    } catch (error) {
         console.error(`[CAMPAIGN_WORKER] Erro fatal no worker da campanha ${campaignId}:`, error);
         await client.query("UPDATE campaigns SET status = 'failed' WHERE id = $1", [campaignId]);
    } finally {
        client.release();
    }
}


export async function deleteCampaign(campaignId: string): Promise<{ success: boolean; error?: string }> {
    const supabase = createClient(cookies());
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
        if (!await hasPermission(user.id, workspace_id, 'campaigns:delete')) { // Permission to be defined
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
    const supabase = createClient(cookies());
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
        if (!await hasPermission(user.id, workspace_id, 'campaigns:delete')) { // Permission to be defined
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

    