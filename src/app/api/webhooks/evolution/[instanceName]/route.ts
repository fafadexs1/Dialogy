
'use server';

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { revalidatePath } from 'next/cache';

export async function POST(
    request: Request,
    { params }: { params: { instanceName: string } }
) {
  const instanceNameFromUrl = params.instanceName;
  console.log(`--- [WEBHOOK] Payload recebido para a instância: ${instanceNameFromUrl} ---`);

  try {
    const payload = await request.json();
    console.log('[WEBHOOK] Payload completo:', JSON.stringify(payload, null, 2));

    const { event, instance: instanceNameFromPayload } = payload;
    
    // Validação para garantir que a instância na URL corresponde à do payload
    if (instanceNameFromUrl !== instanceNameFromPayload) {
        console.error(`[WEBHOOK] Conflito de nome de instância. URL: ${instanceNameFromUrl}, Payload: ${instanceNameFromPayload}`);
        return NextResponse.json({ error: 'Instance name mismatch' }, { status: 400 });
    }

    if (!event) {
      console.error('[WEBHOOK] Erro: Evento não encontrado no payload.');
      return NextResponse.json({ error: 'Event not found' }, { status: 400 });
    }

    if (event === 'messages.upsert') {
      await handleMessagesUpsert(payload);
    } else if (event === 'messages.update') {
      await handleMessagesUpdate(payload);
    } else if (event === 'contacts.update') {
      await handleContactsUpdate(payload);
    } else {
      console.log(`[WEBHOOK] Evento '${event}' recebido para a instância ${instanceNameFromUrl}, mas não há handler implementado.`);
    }

    revalidatePath('/', 'layout');
    return NextResponse.json({ message: 'Webhook received successfully' });
  } catch (error) {
    console.error(`[WEBHOOK] Erro ao processar o webhook para ${instanceNameFromUrl}:`, error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

async function handleContactsUpdate(payload: any) {
    const { instance: instanceName, data } = payload;
    
    // Normalize data to always be an array
    const contactsToUpdate = Array.isArray(data) ? data : [data];

    if (contactsToUpdate.length === 0 || !contactsToUpdate[0]?.remoteJid) {
        console.log('[WEBHOOK_CONTACT_UPDATE] Payload inválido ou sem contatos para atualizar.');
        return;
    }

    console.log(`[WEBHOOK_CONTACT_UPDATE] Recebido evento de atualização para ${contactsToUpdate.length} contato(s) na instância ${instanceName}`);
    
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        
        const instanceRes = await client.query(
          `SELECT ec.workspace_id 
           FROM evolution_api_instances AS ei
           JOIN evolution_api_configs AS ec ON ei.config_id = ec.id
           WHERE ei.name = $1`,
          [instanceName]
        );

        if (instanceRes.rows.length === 0) {
          throw new Error(`Workspace para a instância '${instanceName}' não encontrado.`);
        }
        const workspaceId = instanceRes.rows[0].workspace_id;

        for (const contactData of contactsToUpdate) {
            if (contactData && contactData.remoteJid && contactData.profilePicUrl) {
                console.log(`[WEBHOOK_CONTACT_UPDATE] Atualizando avatar para JID: ${contactData.remoteJid}`);
                await client.query(
                    `UPDATE contacts SET avatar_url = $1 WHERE phone_number_jid = $2 AND workspace_id = $3`,
                    [contactData.profilePicUrl, contactData.remoteJid, workspaceId]
                );
            }
        }
        
        await client.query('COMMIT');
        revalidatePath(`/api/chats/${workspaceId}`);

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('[WEBHOOK_CONTACT_UPDATE] Erro ao atualizar contatos:', error);
    } finally {
        client.release();
    }
}


async function handleMessagesUpdate(payload: any) {
    const { instance: instanceName, data } = payload;
    
    if (!data || !data.keyId || !data.status) {
        console.log('[WEBHOOK_MSG_UPDATE] Payload inválido, keyId ou status ausente.');
        return;
    }

    const { keyId, status } = data;

    console.log(`[WEBHOOK_MSG_UPDATE] Atualizando status da mensagem ${keyId} para ${status} na instância ${instanceName}`);
    
    try {
        await db.query(
            `UPDATE messages SET api_message_status = $1 WHERE message_id_from_api = $2`,
            [status.toUpperCase(), keyId]
        );
        console.log(`[WEBHOOK_MSG_UPDATE] Status da mensagem ${keyId} atualizado com sucesso.`);
    } catch (error) {
        console.error('[WEBHOOK_MSG_UPDATE] Erro ao atualizar status da mensagem:', error);
    }
}

async function handleMessagesUpsert(payload: any) {
    const { instance: instanceName, data, sender, server_url } = payload;

    if (!data || !data.key || !data.message) {
        console.log('[WEBHOOK_MSG_UPSERT] Payload inválido, data, key ou message ausente.');
        return;
    }

    const { key, pushName, message, messageType } = data;

    if (key.fromMe) {
        console.log('[WEBHOOK_MSG_UPSERT] Mensagem ignorada (fromMe=true).');
        return;
    }

    let content = '';
    let metadata: any = {};
    const messageDetails = message.imageMessage || message.videoMessage || message.documentMessage || message.audioMessage || message.extendedTextMessage;

    content = messageDetails?.caption || messageDetails?.text || message.conversation || '';
    if (message.mediaUrl) metadata.mediaUrl = message.mediaUrl;
    if (messageType) {
        switch (messageType) {
            case 'imageMessage':
            case 'videoMessage':
            case 'audioMessage':
            case 'documentMessage':
                metadata.mimetype = messageDetails?.mimetype;
                metadata.fileName = messageDetails?.fileName;
                break;
            case 'conversation':
            case 'extendedTextMessage':
                break;
            default:
                console.log(`[WEBHOOK_MSG_UPSERT] Tipo de mensagem não suportado: ${messageType}. Ignorando.`);
                return;
        }
    }

    if (!content.trim() && !metadata.mediaUrl) {
        console.log('[WEBHOOK_MSG_UPSERT] Mensagem sem conteúdo textual ou de mídia. Ignorando.');
        return;
    }
    
    const parsedUrl = server_url ? new URL(server_url).hostname : null;
    const contactJid = key.remoteJid;

    try {
        const query = `
            WITH ins_ws AS (
                SELECT ec.workspace_id 
                FROM evolution_api_instances AS ei
                JOIN evolution_api_configs AS ec ON ei.config_id = ec.id
                WHERE ei.name = $1
            ),
            upsert_contact AS (
                INSERT INTO contacts (workspace_id, name, phone_number_jid)
                SELECT workspace_id, $2, $3 FROM ins_ws
                ON CONFLICT (workspace_id, phone_number_jid) DO UPDATE SET name = EXCLUDED.name
                RETURNING id, workspace_id
            ),
            target_chat AS (
                SELECT c.id, c.workspace_id, c.contact_id
                FROM (
                    SELECT c.id, c.workspace_id, c.contact_id, c.status,
                           ROW_NUMBER() OVER(PARTITION BY c.contact_id ORDER BY c.status = 'atendimentos' DESC, c.status = 'gerais' DESC, c.closed_at DESC NULLS FIRST, c.assigned_at DESC NULLS FIRST) as rn
                    FROM chats c
                    JOIN upsert_contact uc ON c.workspace_id = uc.workspace_id AND c.contact_id = uc.id
                ) AS ranked_chats
                WHERE rn = 1 AND status IN ('gerais', 'atendimentos')
            ),
            new_chat AS (
                INSERT INTO chats (workspace_id, contact_id, status)
                SELECT uc.workspace_id, uc.id, 'gerais'::chat_status_enum
                FROM upsert_contact uc
                WHERE NOT EXISTS (SELECT 1 FROM target_chat)
                RETURNING id, workspace_id, contact_id
            )
            INSERT INTO messages (
                workspace_id, chat_id, sender_id, type, content, metadata,
                created_at, message_id_from_api, sender_from_api, instance_name,
                status_from_api, source_from_api, server_url, from_me,
                api_message_status, raw_payload
            )
            SELECT
                tc.workspace_id,
                tc.id,
                uc.id, -- sender_id is the contact id
                'text'::message_type_enum,
                $4, $5, NOW(), $6, $7, $8, $9, $10, $11, $12, $13, $14
            FROM upsert_contact uc,
                 (SELECT id, workspace_id, contact_id FROM target_chat UNION ALL SELECT id, workspace_id, contact_id FROM new_chat) AS tc;
        `;
        
        await db.query(query, [
            instanceName, // $1
            pushName || contactJid, // $2
            contactJid, // $3
            content, // $4
            JSON.stringify(metadata), // $5
            key.id, // $6
            sender, // $7
            instanceName, // $8
            data.status, // $9
            data.source, // $10
            parsedUrl, // $11
            key.fromMe, // $12
            data.status?.toUpperCase(), // $13
            JSON.stringify(payload) // $14
        ]);
        
        const instanceRes = await db.query(`SELECT ec.workspace_id FROM evolution_api_instances AS ei JOIN evolution_api_configs AS ec ON ei.config_id = ec.id WHERE ei.name = $1`, [instanceName]);
        if(instanceRes.rowCount > 0) {
            revalidatePath(`/api/chats/${instanceRes.rows[0].workspace_id}`);
        }


    } catch (error) {
        console.error('[WEBHOOK_MSG_UPSERT] Erro ao processar a mensagem com CTE:', error);
    }
}

    