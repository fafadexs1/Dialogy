
'use server';

import { db } from '@/lib/db';
import { revalidatePath } from 'next/cache';
import type { MessageMetadata, Message } from '@/lib/types';
import { createClient } from '@/lib/supabase/server';

// Importando as novas funções de serviço
import { sendTextMessage } from '@/services/whatsapp/send-text-message';
import { sendImageMessage } from '@/services/whatsapp/send-image-message';
import { sendVideoMessage } from '@/services/whatsapp/send-video-message';
import { sendAudioMessage } from '@/services/whatsapp/send-audio-message';
import { sendDocumentMessage } from '@/services/whatsapp/send-document-message';

async function getApiConfigForInstance(instanceName: string): Promise<{ api_url: string; api_key: string; } | null> {
    const instanceRes = await db.query(
      `SELECT c.api_url, c.api_key 
       FROM evolution_api_instances i
       JOIN whatsapp_clusters c ON i.cluster_id = c.id
       WHERE i.instance_name = $1`,
      [instanceName]
    );
     if (instanceRes.rowCount === 0) {
        return null;
    }
    return instanceRes.rows[0];
}


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
    tabId: string | null, // ID da aba que está enviando a mensagem
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

        const apiConfig = await getApiConfigForInstance(instanceName);
        
        if (!apiConfig) {
            throw new Error(`Configuração da API não encontrada para a instância ${instanceName}.`);
        }
        
        const apiResponse = await sendTextMessage(apiConfig, instanceName, remoteJid, content);
        
        const senderColumn = metadata?.sentBy === 'system_agent' ? 'sender_system_agent_id' : 'sender_user_id';

        await client.query(
            `INSERT INTO messages (
                workspace_id, chat_id, type, content, from_me, 
                message_id_from_api, api_message_status, instance_name, 
                metadata, is_read, ${senderColumn}, sent_by_tab
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
            [
                workspaceId, chatId, 'text', content, true,
                apiResponse?.key?.id, 'SENT', instanceName,
                metadata || null, true, senderId, tabId
            ]
        );
        
        await client.query('COMMIT');
        
        // Revalidação manual não é mais necessária com subscriptions.
        // A UI será atualizada via websockets.
        // revalidatePath('/', 'layout');

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
    }[],
    senderId: string,
    tabId: string | null,
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
        
        const apiConfig = await getApiConfigForInstance(instanceName);
        if (!apiConfig) throw new Error(`Configuração da Evolution API não encontrada para a instância ${instanceName}.`);
        
        const senderColumn = metadata?.sentBy === 'system_agent' ? 'sender_system_agent_id' : 'sender_user_id';

        for (const file of mediaFiles) {
            let apiResponse;
            let dbMessageType: Message['type'];

            const base64Data = file.base64; // Already pure base64
            
            switch(file.mediatype) {
                case 'image':
                    apiResponse = await sendImageMessage(apiConfig, instanceName, { number: remoteJid, media: base64Data, mimetype: file.mimetype, filename: file.filename, caption });
                    dbMessageType = 'image';
                    break;
                case 'video':
                    apiResponse = await sendVideoMessage(apiConfig, instanceName, { number: remoteJid, media: base64Data, mimetype: file.mimetype, filename: file.filename, caption });
                    dbMessageType = 'video';
                    break;
                case 'document':
                    apiResponse = await sendDocumentMessage(apiConfig, instanceName, { number: remoteJid, media: base64Data, mimetype: file.mimetype, filename: file.filename, caption });
                    dbMessageType = 'document';
                    break;
                case 'audio':
                     // Special handling for recorded audio to be sent as voice note
                    if (file.filename === 'audio_gravado.mp3') {
                        apiResponse = await sendAudioMessage(apiConfig, instanceName, { number: remoteJid, audio: base64Data });
                    } else {
                        // Send other audio files as documents
                        apiResponse = await sendDocumentMessage(apiConfig, instanceName, { number: remoteJid, media: base64Data, mimetype: file.mimetype, filename: file.filename, caption });
                    }
                    dbMessageType = 'audio';
                    break;
                default:
                    throw new Error(`Unsupported mediatype: ${file.mediatype}`);
            }

            const messageTypeKey = `${dbMessageType}Message` as keyof typeof apiResponse.message;
            const messageDetails = apiResponse.message?.[messageTypeKey] as any;
            
            const dbMetadata: MessageMetadata = {
                ...(metadata || {}),
                mediaUrl: apiResponse?.message?.mediaUrl,
                fileName: messageDetails?.fileName || file.filename,
                mimetype: messageDetails?.mimetype || file.mimetype,
                duration: messageDetails?.seconds,
            };

            await client.query(
                `INSERT INTO messages (
                    workspace_id, chat_id, type, content, from_me,
                    message_id_from_api, api_message_status, instance_name,
                    metadata, is_read, ${senderColumn}, sent_by_tab
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
                [
                    workspaceId, chatId, dbMessageType, caption, true,
                    apiResponse?.key?.id, apiResponse?.status || 'SENT', instanceName,
                    dbMetadata, true, senderId, tabId
                ]
            );
        }
        
        await client.query('COMMIT');
        
        // Revalidação manual não é mais necessária com subscriptions.
        // A UI será atualizada via websockets.
        // revalidatePath('/', 'layout');

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
    tabId: string | null
): Promise<{ success: boolean; error?: string }> {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        return { success: false, error: 'Usuário não autenticado.' };
    }

    return internalSendMessage(chatId, content, user.id, tabId);
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
    // Automated messages don't have a tabId
    return internalSendMessage(chatId, content, agentId, null, metadata, instanceName);
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
    }[],
    tabId: string | null
): Promise<{ success: boolean; error?: string }> {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        return { success: false, error: 'Usuário não autenticado.' };
    }
    return internalSendMedia(chatId, caption, mediaFiles, user.id, tabId);
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
    }[],
    agentId: string,
    instanceName?: string,
): Promise<{ success: boolean; error?: string }> {
    // Automated messages don't have a tabId
    return internalSendMedia(chatId, caption, mediaFiles, agentId, null, { sentBy: 'system_agent' }, instanceName);
}


export async function startNewConversation(
    input: { workspaceId: string, instanceName: string, phoneNumber: string, message: string, tabId: string | null }
): Promise<{ success: boolean, error?: string }> {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        return { success: false, error: 'Usuário não autenticado.' };
    }
    const senderId = user.id;

    const { workspaceId, instanceName, phoneNumber, message, tabId } = input;
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
        const sendResult = await internalSendMessage(chatId, message, senderId, tabId, {}, instanceName);

        if (sendResult.success) {
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

export async function saveTranscriptionAction(messageId: string, transcription: string): Promise<{ success: boolean; error?: string }> {
    if (!messageId || !transcription) {
        return { success: false, error: "ID da mensagem e transcrição são obrigatórios." };
    }

    try {
        const result = await db.query(
            'UPDATE messages SET transcription = $1 WHERE id = $2',
            [transcription, messageId]
        );
        if (result.rowCount === 0) {
            return { success: false, error: "Mensagem não encontrada." };
        }
        // No longer needed with realtime
        // revalidatePath('/', 'layout');
        return { success: true };
    } catch (error: any) {
        console.error("Erro ao salvar transcrição:", error);
        return { success: false, error: "Falha no servidor ao salvar a transcrição." };
    }
}
