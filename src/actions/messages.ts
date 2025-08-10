
'use server';

import { db } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { revalidatePath } from 'next/cache';
import { fetchEvolutionAPI } from './evolution-api';

export async function sendMessageAction(
    prevState: any,
    formData: FormData,
): Promise<{ success: boolean; error?: string }> {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
        return { success: false, error: 'Usuário não autenticado.' };
    }
    const currentUserId = session.user.id;

    const content = formData.get('content') as string;
    const chatId = formData.get('chatId') as string;

    if (!content || !chatId) {
        return { success: false, error: 'Conteúdo e ID do chat são obrigatórios.' };
    }

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        // 1. Get chat, contact, instance, and API config info
        const chatInfoRes = await client.query(
            `SELECT
                c.workspace_id,
                ct.phone_number_jid as "remoteJid",
                (SELECT lm.instance_name FROM messages lm WHERE lm.chat_id = c.id AND lm.instance_name IS NOT NULL ORDER BY lm.created_at DESC LIMIT 1) as "instanceName"
             FROM chats c
             JOIN contacts ct ON c.contact_id = ct.id
             WHERE c.id = $1`,
            [chatId]
        );

        if (chatInfoRes.rowCount === 0) {
            throw new Error('Chat não encontrado.');
        }

        const { workspace_id, remoteJid, instanceName } = chatInfoRes.rows[0];

        if (!remoteJid || !instanceName) {
            throw new Error('Não foi possível encontrar o número de destino ou a instância para este chat.');
        }

        const apiConfigRes = await client.query('SELECT api_url, api_key FROM evolution_api_configs WHERE workspace_id = $1', [workspace_id]);

        if (apiConfigRes.rowCount === 0) {
            throw new Error('Configuração da Evolution API não encontrada para este workspace.');
        }
        const apiConfig = apiConfigRes.rows[0];

        // 2. Send message via Evolution API
        const apiResponse = await fetchEvolutionAPI(
            `/message/sendText/${instanceName}`,
            apiConfig,
            {
                method: 'POST',
                body: JSON.stringify({
                    number: remoteJid,
                    text: content,
                }),
            }
        );
        
        // 3. Save the message to our database using the API response
        await client.query(
            `INSERT INTO messages (
                workspace_id,
                chat_id,
                sender_id,
                type,
                content,
                from_me,
                message_id_from_api,
                api_message_status,
                instance_name
             ) VALUES ($1, $2, $3, 'text', $4, true, $5, $6, $7)`,
            [workspace_id, chatId, currentUserId, content, apiResponse?.key?.id, 'SENT', instanceName]
        );

        await client.query('COMMIT');
        
        revalidatePath(`/api/chats/${workspace_id}`);
        revalidatePath('/', 'layout');

        return { success: true };

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('[SEND_MESSAGE_ACTION] Erro:', error);
        const errorMessage = error instanceof Error ? error.message : "Ocorreu um erro desconhecido.";
        return { success: false, error: `Falha ao enviar mensagem: ${errorMessage}` };
    } finally {
        client.release();
    }
}


export async function sendMediaAction(
    chatId: string,
    caption: string,
    mediaFiles: {
        base64: string;
        mimetype: string;
        filename: string;
        mediatype: 'image' | 'video' | 'document';
    }[]
): Promise<{ success: boolean; error?: string }> {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
        return { success: false, error: 'Usuário não autenticado.' };
    }
    const currentUserId = session.user.id;

    if (!chatId || !mediaFiles || mediaFiles.length === 0) {
        return { success: false, error: 'Dados da mídia inválidos.' };
    }

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        const chatInfoRes = await client.query(
            `SELECT
                c.workspace_id,
                ct.phone_number_jid as "remoteJid",
                (SELECT lm.instance_name FROM messages lm WHERE lm.chat_id = c.id AND lm.instance_name IS NOT NULL ORDER BY lm.created_at DESC LIMIT 1) as "instanceName"
             FROM chats c
             JOIN contacts ct ON c.contact_id = ct.id
             WHERE c.id = $1`,
            [chatId]
        );

        if (chatInfoRes.rowCount === 0) throw new Error('Chat não encontrado.');
        const { workspace_id, remoteJid, instanceName } = chatInfoRes.rows[0];

        if (!remoteJid || !instanceName) throw new Error('Não foi possível encontrar o número de destino ou a instância para este chat.');
        
        const apiConfigRes = await client.query('SELECT api_url, api_key FROM evolution_api_configs WHERE workspace_id = $1', [workspace_id]);
        if (apiConfigRes.rowCount === 0) throw new Error('Configuração da Evolution API não encontrada.');
        const apiConfig = apiConfigRes.rows[0];

        for (const file of mediaFiles) {
            const apiPayload = {
                number: remoteJid,
                mediatype: file.mediatype,
                mimetype: file.mimetype,
                media: file.base64,
                fileName: file.filename,
                caption: caption || ' ',
            };
            
            const apiResponse = await fetchEvolutionAPI(
                `/message/sendMedia/${instanceName}`,
                apiConfig,
                { method: 'POST', body: JSON.stringify(apiPayload) }
            );

            // Extract data from the successful API response to store in our DB
            const responseMessage = apiResponse?.message;
            let dbContent = caption;
            let dbMetadata = {};

            if (responseMessage) {
                const messageType = Object.keys(responseMessage).find(k => k.endsWith('Message'));
                if (messageType && responseMessage[messageType]) {
                    const mediaDetails = responseMessage[messageType];
                    dbMetadata = {
                        mediaUrl: mediaDetails.url,
                        mimetype: mediaDetails.mimetype,
                        caption: mediaDetails.caption,
                        fileName: mediaDetails.fileName || file.filename,
                    };
                    // Use caption from response if available, otherwise from input
                    dbContent = mediaDetails.caption || caption || '';
                }
            }
            
            await client.query(
                `INSERT INTO messages (
                    workspace_id, chat_id, sender_id, type, content, from_me,
                    message_id_from_api, api_message_status, metadata, instance_name
                 ) VALUES ($1, $2, $3, 'text', $4, true, $5, $6, $7, $8)`,
                [
                    workspace_id, 
                    chatId, 
                    currentUserId, 
                    dbContent, 
                    apiResponse?.key?.id, 
                    apiResponse?.status || 'SENT', 
                    dbMetadata,
                    instanceName
                ]
            );
        }

        await client.query('COMMIT');
        
        revalidatePath(`/api/chats/${workspace_id}`);
        revalidatePath('/', 'layout');

        return { success: true };

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('[SEND_MEDIA_ACTION] Erro:', error);
        const errorMessage = error instanceof Error ? error.message : "Ocorreu um erro desconhecido ao enviar mídia.";
        return { success: false, error: errorMessage };
    } finally {
        client.release();
    }
}
