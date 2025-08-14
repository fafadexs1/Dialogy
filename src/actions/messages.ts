
'use server';

import { db } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { revalidatePath } from 'next/cache';
import { fetchEvolutionAPI } from './evolution-api';
import type { Message, MessageMetadata } from '@/lib/types';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { randomBytes } from 'crypto';


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
    metadata?: MessageMetadata
): Promise<{ success: boolean; error?: string }> {
    if (!content || !chatId) {
        return { success: false, error: 'Conteúdo e ID do chat são obrigatórios.' };
    }

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        // 1. Obter informações do chat, contato, instância e API
        const chatInfoRes = await client.query(
            `SELECT
                c.workspace_id,
                c.status,
                c.agent_id,
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

        const { workspace_id, status: chatStatus, agent_id: currentAgentId, remoteJid, instanceName } = chatInfoRes.rows[0];

        // Atribui o agente se o chat estiver na fila 'gerais' e ainda não tiver um.
        if (chatStatus === 'gerais' && !currentAgentId) {
            console.log(`[SEND_MESSAGE_ACTION] Chat ${chatId} é 'gerais'. Atribuindo agente ${senderId}.`);
            await client.query(
                `UPDATE chats SET agent_id = $1, status = 'atendimentos', assigned_at = NOW() WHERE id = $2`,
                [senderId, chatId]
            );
        }

        if (!remoteJid || !instanceName) {
            throw new Error('Não foi possível encontrar o número de destino ou a instância para este chat.');
        }

        const apiConfigRes = await client.query('SELECT api_url, api_key FROM evolution_api_configs WHERE workspace_id = $1', [workspace_id]);

        if (apiConfigRes.rowCount === 0) {
            throw new Error('Configuração da Evolution API não encontrada para este workspace.');
        }
        const apiConfig = apiConfigRes.rows[0];

        // Corrige o JID se for do tipo @lid para @s.whatsapp.net
        const correctedRemoteJid = remoteJid.endsWith('@lid') 
            ? remoteJid.replace('@lid', '@s.whatsapp.net') 
            : remoteJid;
        
        console.log(`[SEND_MESSAGE_ACTION] JID Original: ${remoteJid}, JID Corrigido: ${correctedRemoteJid}`);

        // 2. Enviar mensagem via API da Evolution com o payload simples
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
        
        // 3. Salvar a mensagem no nosso banco de dados
        await client.query(
            `INSERT INTO messages (
                workspace_id, chat_id, sender_id, type, content, from_me,
                message_id_from_api, api_message_status, instance_name, metadata, is_read
             ) VALUES ($1, $2, $3, 'text', $4, true, $5, $6, $7, $8, true)`,
            [workspace_id, chatId, senderId, content, apiResponse?.key?.id, 'SENT', instanceName, metadata || null]
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
        mediatype: 'image' | 'video' | 'document' | 'audio';
        thumbnail?: string; 
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

        const correctedRemoteJid = remoteJid.endsWith('@lid') 
            ? remoteJid.replace('@lid', '@s.whatsapp.net') 
            : remoteJid;

        for (const file of mediaFiles) {
            let apiResponse: any;
            const dbMessageType: Message['type'] = file.mediatype === 'audio' ? 'audio' : 'text'; // Simplified for DB
            let dbMetadata: MessageMetadata = { thumbnail: file.thumbnail };

            try {
                 if (file.mediatype === 'audio') {
                    // Use the specific audio endpoint
                    const apiPayload = {
                        number: correctedRemoteJid,
                        audio: `data:${file.mimetype};base64,${file.base64}`,
                    };
                     apiResponse = await fetchEvolutionAPI(
                        `/message/sendWhatsAppAudio/${instanceName}`,
                        apiConfig,
                        { method: 'POST', body: JSON.stringify(apiPayload) }
                    );

                } else {
                    // Use the generic media endpoint for images, videos, documents
                    const apiPayload = {
                        number: correctedRemoteJid,
                        options: {
                            delay: 1200,
                            presence: "composing"
                        },
                        mediaMessage: {
                            mediatype: file.mediatype,
                            media: `data:${file.mimetype};base64,${file.base64}`,
                            fileName: file.filename,
                            caption: caption || '',
                        }
                    };
                    apiResponse = await fetchEvolutionAPI(
                        `/message/sendMedia/${instanceName}`,
                        apiConfig,
                        { method: 'POST', body: JSON.stringify(apiPayload) }
                    );
                }

            } catch (error: any) {
                await client.query('ROLLBACK');
                console.error('[SEND_MEDIA_ACTION] Erro na chamada da API:', error);
                const errorMessage = error.message || "Ocorreu um erro desconhecido ao enviar mídia.";
                return { success: false, error: `Erro da API Evolution: ${errorMessage}` };
            }
            
            const dbContent = caption || '';
           
            // Normalize metadata saving from API response
            if (apiResponse?.message) {
                const messageTypeKey = Object.keys(apiResponse.message).find(k => k.endsWith('Message'));
                if (messageTypeKey && apiResponse.message[messageTypeKey]) {
                    const mediaDetails = apiResponse.message[messageTypeKey];
                     dbMetadata = {
                        ...dbMetadata,
                        mediaUrl: mediaDetails.url, 
                        mimetype: mediaDetails.mimetype,
                        fileName: mediaDetails.fileName || file.filename,
                        ...(file.mediatype === 'audio' && { duration: mediaDetails.seconds }),
                    };
                }
            }
            
            await client.query(
                `INSERT INTO messages (
                    workspace_id, chat_id, sender_id, type, content, from_me,
                    message_id_from_api, api_message_status, metadata, instance_name, is_read
                 ) VALUES ($1, $2, $3, $4, $5, true, $6, $7, $8, $9, true)`,
                [
                    workspace_id, 
                    chatId, 
                    currentUserId, 
                    dbMessageType,
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

    } catch (error: any) {
        await client.query('ROLLBACK');
        console.error('[SEND_MEDIA_ACTION] Erro:', error);
        const errorMessage = error.message || "Ocorreu um erro desconhecido ao enviar mídia.";
        return { success: false, error: `Erro da API Evolution: ${errorMessage}` };
    } finally {
        client.release();
    }
}


/**
 * Action specifically for sending messages from the UI (agents).
 * It gets the senderId from the session.
 */
export async function sendAgentMessageAction(
    chatId: string,
    content: string,
): Promise<{ success: boolean; error?: string }> {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
        return { success: false, error: 'Usuário não autenticado.' };
    }

    return internalSendMessage(chatId, content, session.user.id);
}

/**
 * Action for sending automated messages (e.g., from Autopilot).
 * The senderId is passed explicitly as the agent responsible for the chat.
 */
export async function sendAutomatedMessageAction(
    chatId: string,
    content: string,
    agentId: string
): Promise<{ success: boolean; error?: string }> {
    return internalSendMessage(chatId, content, agentId, { sentBy: 'autopilot' });
}
