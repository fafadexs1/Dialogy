

'use server';

import { db } from '@/lib/db';
import { revalidatePath } from 'next/cache';
import { fetchEvolutionAPI } from './evolution-api';
import type { MessageMetadata, Message } from '@/lib/types';
import { createClient } from '@/lib/supabase/server';


/**
 * Ação genérica para enviar uma mensagem de texto.
 * Pode ser chamada tanto por formulários (agentes) quanto por automações (Piloto Automático).
 * @param input - Um objeto FormData ou um objeto com os dados da mensagem.
 * @returns Um objeto com o resultado da operação.
 */
async function internalSendMessage(
    chatId: string,
    content: string,
    senderId: string, // The user ID of the sender (could be an agent or the system for automated messages)
    metadata?: MessageMetadata,
    instanceNameParam?: string, // Opcional: nome da instância para usar
): Promise<{ success: boolean; error?: string; apiResponse?: any }> {
    if (!content || !chatId) {
        return { success: false, error: 'Conteúdo e ID do chat são obrigatórios.' };
    }
    const client = await db.connect();
    try {
        await client.query('BEGIN');

        const chatInfoRes = await client.query(`
            SELECT 
                c.workspace_id, c.status, c.agent_id,
                ct.phone_number_jid,
                (SELECT m.instance_name FROM messages m WHERE m.chat_id = c.id AND m.instance_name IS NOT NULL ORDER BY m.created_at DESC LIMIT 1) as last_instance_name
            FROM chats c
            JOIN contacts ct ON c.contact_id = ct.id
            WHERE c.id = $1
        `, [chatId]);

        if (chatInfoRes.rowCount === 0) {
            throw new Error('Chat não encontrado.');
        }

        const chatInfo = chatInfoRes.rows[0];
        const { workspace_id: workspaceId, status: chatStatus, agent_id: currentAgentId, phone_number_jid: remoteJid, last_instance_name: lastInstanceName } = chatInfo;
        
        const instanceName = instanceNameParam || lastInstanceName;

        const isFromHumanAgent = metadata?.sentBy !== 'system_agent';
        if (chatStatus === 'gerais' && !currentAgentId && isFromHumanAgent) {
            console.log(`[SEND_MESSAGE_ACTION] Chat ${chatId} é 'gerais'. Atribuindo agente humano ${senderId}.`);
            await client.query(
                "UPDATE chats SET agent_id = $1, status = 'atendimentos', assigned_at = NOW() WHERE id = $2",
                [senderId, chatId]
            );
        }
        
        if (!remoteJid || !instanceName) {
            throw new Error('Não foi possível encontrar o número de destino ou a instância para este chat.');
        }

        const apiConfigRes = await client.query('SELECT * FROM evolution_api_configs WHERE workspace_id = $1', [workspaceId]);
        
        if (apiConfigRes.rowCount === 0) {
            throw new Error('Configuração da Evolution API não encontrada para este workspace.');
        }
        const apiConfig = apiConfigRes.rows[0];
        
        const correctedRemoteJid = remoteJid.endsWith('@lid') 
            ? remoteJid.replace('@s.whatsapp.net', '@lid') 
            : remoteJid;

        const apiResponse = await fetchEvolutionAPI(
            `/message/sendText/${instanceName}`,
            apiConfig,
            {
                method: 'POST',
                body: JSON.stringify({
                    number: correctedRemoteJid,
                    text: content,
                }),
            }
        );
        
        const senderColumn = metadata?.sentBy === 'system_agent' ? 'sender_system_agent_id' : 'sender_user_id';

        await client.query(
            `INSERT INTO messages (
                workspace_id, chat_id, type, content, from_me, 
                message_id_from_api, api_message_status, instance_name, 
                metadata, is_read, ${senderColumn}
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
            [
                workspaceId, chatId, 'text', content, true,
                apiResponse?.key?.id, 'SENT', instanceName,
                metadata || null, true, senderId
            ]
        );
        
        await client.query('COMMIT');
        revalidatePath(`/api/chats/${workspaceId}`);
        revalidatePath('/', 'layout');

        return { success: true, apiResponse };

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('[SEND_MESSAGE_ACTION] Erro:', error);
        const errorMessage = error instanceof Error ? error.message : "Ocorreu um erro desconhecido.";
        return { success: false, error: `Falha ao enviar mensagem: ${errorMessage}` };
    } finally {
        client.release();
    }
}


/**
 * Internal function to handle media sending logic.
 */
async function internalSendMedia(
    chatId: string,
    caption: string,
    mediaFiles: {
        base64: string;
        mimetype: string;
        filename: string;
        mediatype: 'image' | 'video' | 'document' | 'audio';
        thumbnail?: string; 
    }[],
    senderId: string,
    metadata?: MessageMetadata,
    instanceNameParam?: string,
): Promise<{ success: boolean; error?: string }> {
    if (!chatId || !mediaFiles || mediaFiles.length === 0) {
        return { success: false, error: 'Dados da mídia inválidos.' };
    }
    const client = await db.connect();
    try {
        await client.query('BEGIN');

        const chatInfoRes = await client.query(`
            SELECT c.workspace_id, ct.phone_number_jid, 
                   (SELECT m.instance_name FROM messages m WHERE m.chat_id = c.id AND m.instance_name IS NOT NULL ORDER BY m.created_at DESC LIMIT 1) as last_instance_name
            FROM chats c
            JOIN contacts ct ON c.contact_id = ct.id
            WHERE c.id = $1
        `, [chatId]);

        if (chatInfoRes.rowCount === 0) throw new Error('Chat não encontrado.');
        
        const { workspace_id: workspaceId, phone_number_jid: remoteJid, last_instance_name: lastInstanceName } = chatInfoRes.rows[0];
        const instanceName = instanceNameParam || lastInstanceName;

        if (!remoteJid || !instanceName) throw new Error('Não foi possível encontrar o número de destino ou a instância para este chat.');
        
        const apiConfigRes = await client.query('SELECT * FROM evolution_api_configs WHERE workspace_id = $1', [workspaceId]);
        if (apiConfigRes.rowCount === 0) throw new Error('Configuração da Evolution API não encontrada.');
        const apiConfig = apiConfigRes.rows[0];
        
        const correctedRemoteJid = remoteJid.endsWith('@lid') 
            ? remoteJid.replace('@s.whatsapp.net', '@lid') 
            : remoteJid;
        
        const senderColumn = metadata?.sentBy === 'system_agent' ? 'sender_system_agent_id' : 'sender_user_id';

        for (const file of mediaFiles) {
            let endpoint: string;
            let apiPayload: Record<string, any>;
            let dbMessageType: Message['type'] = 'document';

            if (file.mediatype === 'audio') {
                endpoint = `/message/sendWhatsAppAudio/${instanceName}`;
                apiPayload = { number: correctedRemoteJid, audio: file.base64 };
                dbMessageType = 'audio';
            } else {
                endpoint = `/message/sendMedia/${instanceName}`;
                apiPayload = { number: correctedRemoteJid, mediatype: file.mediatype, mimetype: file.mimetype, media: file.base64, fileName: file.filename, caption: caption || '' };
                 dbMessageType = file.mediatype === 'image' ? 'image' : file.mediatype === 'video' ? 'video' : 'document';
            }

            const apiResponse = await fetchEvolutionAPI(endpoint, apiConfig, { method: 'POST', body: JSON.stringify(apiPayload) });

            const dbContent = caption || '';
            let dbMetadata: MessageMetadata = { ...metadata, thumbnail: file.thumbnail };

            if (apiResponse?.message?.mediaUrl) {
                 dbMetadata.mediaUrl = apiResponse.message.mediaUrl;
            }
             if (apiResponse?.message) {
                const messageTypeKey = Object.keys(apiResponse.message).find(k => k.endsWith('Message'));
                if (messageTypeKey && apiResponse.message[messageTypeKey]) {
                    const mediaDetails = apiResponse.message[messageTypeKey];
                    dbMetadata.mimetype = mediaDetails.mimetype;
                    dbMetadata.fileName = mediaDetails.fileName || file.filename;
                    if (file.mediatype === 'audio' && mediaDetails.seconds) {
                        dbMetadata.duration = mediaDetails.seconds;
                    }
                }
            }


            await client.query(
                `INSERT INTO messages (
                    workspace_id, chat_id, type, content, from_me,
                    message_id_from_api, api_message_status, instance_name,
                    metadata, is_read, ${senderColumn}
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
                [
                    workspaceId, chatId, dbMessageType, dbContent, true,
                    apiResponse?.key?.id, apiResponse?.status || 'SENT', instanceName,
                    dbMetadata, true, senderId
                ]
            );
        }
        
        await client.query('COMMIT');
        revalidatePath(`/api/chats/${workspaceId}`);
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


/**
 * Action specifically for sending messages from the UI (human agents).
 */
export async function sendAgentMessageAction(
    chatId: string,
    content: string,
): Promise<{ success: boolean; error?: string }> {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        return { success: false, error: 'Usuário não autenticado.' };
    }

    return internalSendMessage(chatId, content, user.id);
}

/**
 * Action for sending automated messages.
 */
export async function sendAutomatedMessageAction(
    chatId: string,
    content: string,
    agentId: string,
    isSystemAgent: boolean = false,
    instanceName?: string,
): Promise<{ success: boolean; error?: string, apiResponse?: any }> {
    const metadata = isSystemAgent ? { sentBy: 'system_agent' as const } : { sentBy: 'autopilot' as const };
    return internalSendMessage(chatId, content, agentId, metadata, instanceName);
}


/**
 * Action for sending media from the UI (human agents).
 */
export async function sendMediaAction(
    chatId: string,
    caption: string,
    mediaFiles: {
        base64: string;
        mimetype: string;
        filename: string;
        mediatype: 'image' | 'video' | 'document' | 'audio';
        thumbnail?: string; 
    }[]
): Promise<{ success: boolean; error?: string }> {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        return { success: false, error: 'Usuário não autenticado.' };
    }
    return internalSendMedia(chatId, caption, mediaFiles, user.id);
}

/**
 * Action for sending media from automated systems.
 */
export async function sendAutomatedMediaAction(
     chatId: string,
    caption: string,
    mediaFiles: {
        base64: string;
        mimetype: string;
        filename: string;
        mediatype: 'image' | 'video' | 'document' | 'audio';
        thumbnail?: string; 
    }[],
    agentId: string,
    instanceName?: string,
): Promise<{ success: boolean; error?: string }> {
    return internalSendMedia(chatId, caption, mediaFiles, agentId, { sentBy: 'system_agent' }, instanceName);
}


export async function startNewConversation(
    input: { workspaceId: string, instanceName: string, phoneNumber: string, message: string }
): Promise<{ success: boolean, error?: string }> {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        return { success: false, error: 'Usuário não autenticado.' };
    }
    const senderId = user.id;

    const { workspaceId, instanceName, phoneNumber, message } = input;
    if (!workspaceId || !instanceName || !phoneNumber || !message) {
        return { success: false, error: 'Todos os campos são obrigatórios.' };
    }

    const client = await db.connect();
    try {
        await client.query('BEGIN');
        
        const fullJid = phoneNumber.includes('@') ? phoneNumber : `${phoneNumber}@s.whatsapp.net`;
        
        // 1. Find or create the contact
        let contactRes = await client.query(
            'SELECT * FROM contacts WHERE workspace_id = $1 AND phone_number_jid = $2',
            [workspaceId, fullJid]
        );
        let contactId;
        if (contactRes.rowCount === 0) {
            const newContactRes = await client.query(
                `INSERT INTO contacts (workspace_id, name, phone_number_jid) VALUES ($1, $2, $3) RETURNING id`,
                [workspaceId, phoneNumber, fullJid]
            );
            contactId = newContactRes.rows[0].id;
        } else {
            contactId = contactRes.rows[0].id;
        }
        
        // 2. Find or create the chat
        let chatRes = await client.query(
            `SELECT id FROM chats WHERE workspace_id = $1 AND contact_id = $2 AND status IN ('gerais', 'atendimentos')`,
            [workspaceId, contactId]
        );
        let chatId;
        if (chatRes.rowCount > 0) {
            chatId = chatRes.rows[0].id;
        } else {
            const newChatRes = await client.query(
                `INSERT INTO chats (workspace_id, contact_id, status, agent_id, assigned_at) VALUES ($1, $2, 'atendimentos', $3, NOW()) RETURNING id`,
                [workspaceId, contactId, senderId]
            );
            chatId = newChatRes.rows[0].id;
        }

        await client.query('COMMIT');
        
        // 3. Send the message using the existing internal action
        // We pass the instanceName directly to ensure it's used.
        const sendResult = await internalSendMessage(chatId, message, senderId, {}, instanceName);

        if (sendResult.success) {
            revalidatePath('/', 'layout');
            return { success: true };
        } else {
            return { success: false, error: sendResult.error };
        }
        
    } catch(error) {
        await client.query('ROLLBACK');
        console.error('[START_NEW_CONVERSATION_ACTION] Erro:', error);
        const errorMessage = error instanceof Error ? error.message : "Ocorreu um erro desconhecido.";
        return { success: false, error: `Falha ao iniciar conversa: ${errorMessage}` };
    } finally {
        client.release();
    }
}
