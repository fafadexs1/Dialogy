
'use server';

import { prisma } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { revalidatePath } from 'next/cache';
import { fetchEvolutionAPI } from './evolution-api';
import type { MessageMetadata } from '@/lib/types';


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

    try {
        const chatInfo = await prisma.chat.findUnique({
            where: { id: chatId },
            select: {
                workspaceId: true,
                status: true,
                agentId: true,
                contact: {
                    select: { phoneNumberJid: true }
                },
                messages: {
                    where: { instanceName: { not: null } },
                    orderBy: { createdAt: 'desc' },
                    take: 1,
                    select: { instanceName: true }
                }
            }
        });

        if (!chatInfo) {
            throw new Error('Chat não encontrado.');
        }

        const { workspaceId, status: chatStatus, agentId: currentAgentId } = chatInfo;
        const remoteJid = chatInfo.contact.phoneNumberJid;
        const lastInstanceName = chatInfo.messages[0]?.instanceName;

        // Define a instância a ser usada: a fornecida como parâmetro tem prioridade.
        const instanceName = instanceNameParam || lastInstanceName;

        const isFromHumanAgent = metadata?.sentBy !== 'system_agent';
        if (chatStatus === 'gerais' && !currentAgentId && isFromHumanAgent) {
            console.log(`[SEND_MESSAGE_ACTION] Chat ${chatId} é 'gerais'. Atribuindo agente humano ${senderId}.`);
            await prisma.chat.update({
                where: { id: chatId },
                data: {
                    agentId: senderId,
                    status: 'atendimentos',
                    assignedAt: new Date(),
                }
            });
        }
        
        if (!remoteJid || !instanceName) {
            throw new Error('Não foi possível encontrar o número de destino ou a instância para este chat.');
        }

        const apiConfig = await prisma.evolutionApiConfig.findUnique({
             where: { workspaceId: workspaceId }
        });

        if (!apiConfig) {
            throw new Error('Configuração da Evolution API não encontrada para este workspace.');
        }
        
        const correctedRemoteJid = remoteJid.endsWith('@lid') 
            ? remoteJid.replace('@lid', '@s.whatsapp.net') 
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

        // Identifica se o sender é um SystemAgent ou um User
        let messageData: any = {
            workspaceId: workspaceId,
            chatId: chatId,
            type: 'text',
            content: content,
            fromMe: true,
            messageIdFromApi: apiResponse?.key?.id,
            apiMessageStatus: 'SENT',
            instanceName: instanceName,
            metadata: metadata || undefined,
            isRead: true,
        };

        if (metadata?.sentBy === 'system_agent') {
            messageData.senderSystemAgentId = senderId;
        } else {
            messageData.senderUserId = senderId;
        }
        
        await prisma.message.create({ data: messageData });
        
        revalidatePath(`/api/chats/${workspaceId}`);
        revalidatePath('/', 'layout');

        return { success: true, apiResponse };

    } catch (error) {
        console.error('[SEND_MESSAGE_ACTION] Erro:', error);
        const errorMessage = error instanceof Error ? error.message : "Ocorreu um erro desconhecido.";
        return { success: false, error: `Falha ao enviar mensagem: ${errorMessage}` };
    }
}


/**
 * Internal function to handle media sending logic.
 * Can be called by agent-triggered actions or automated system actions.
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
    instanceNameParam?: string, // Opcional: nome da instância para usar
): Promise<{ success: boolean; error?: string }> {
     if (!chatId || !mediaFiles || mediaFiles.length === 0) {
        return { success: false, error: 'Dados da mídia inválidos.' };
    }

    try {
        const chatInfo = await prisma.chat.findUnique({
            where: { id: chatId },
            select: {
                workspaceId: true,
                contact: { select: { phoneNumberJid: true } },
                messages: {
                    where: { instanceName: { not: null } },
                    orderBy: { createdAt: 'desc' },
                    take: 1,
                    select: { instanceName: true }
                }
            }
        });

        if (!chatInfo) throw new Error('Chat não encontrado.');
        const { workspaceId } = chatInfo;
        const remoteJid = chatInfo.contact.phoneNumberJid;
        const lastInstanceName = chatInfo.messages[0]?.instanceName;
        const instanceName = instanceNameParam || lastInstanceName;

        if (!remoteJid || !instanceName) throw new Error('Não foi possível encontrar o número de destino ou a instância para este chat.');
        
        const apiConfig = await prisma.evolutionApiConfig.findUnique({ where: { workspaceId } });
        if (!apiConfig) throw new Error('Configuração da Evolution API não encontrada.');
        
        const correctedRemoteJid = remoteJid.endsWith('@lid') 
            ? remoteJid.replace('@lid', '@s.whatsapp.net') 
            : remoteJid;

        for (const file of mediaFiles) {
            let endpoint: string;
            let apiPayload: Record<string, any>;
            let dbMessageType: 'audio' | 'text' = 'text';

            if (file.mediatype === 'audio') {
                endpoint = `/message/sendWhatsAppAudio/${instanceName}`;
                apiPayload = { number: correctedRemoteJid, audio: file.base64 };
                dbMessageType = 'audio';
            } else {
                endpoint = `/message/sendMedia/${instanceName}`;
                apiPayload = { number: correctedRemoteJid, mediatype: file.mediatype, mimetype: file.mimetype, media: file.base64, fileName: file.filename, caption: caption || '' };
            }

            const apiResponse = await fetchEvolutionAPI(endpoint, apiConfig, { method: 'POST', body: JSON.stringify(apiPayload) });

            const dbContent = caption || '';
            let dbMetadata: MessageMetadata = { ...metadata, thumbnail: file.thumbnail };

            if (apiResponse?.message) {
                 dbMetadata.mediaUrl = apiResponse.message.mediaUrl;
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

            let messageData: any = {
                workspaceId: workspaceId,
                chatId: chatId,
                type: dbMessageType,
                content: dbContent,
                fromMe: true,
                messageIdFromApi: apiResponse?.key?.id,
                apiMessageStatus: apiResponse?.status || 'SENT',
                metadata: dbMetadata,
                instanceName: instanceName,
                isRead: true,
            };

            if (metadata?.sentBy === 'system_agent') {
                messageData.senderSystemAgentId = senderId;
            } else {
                messageData.senderUserId = senderId;
            }

            await prisma.message.create({ data: messageData });
        }
        
        revalidatePath(`/api/chats/${workspaceId}`);
        revalidatePath('/', 'layout');

        return { success: true };

    } catch (error) {
        console.error('[SEND_MEDIA_ACTION] Erro:', error);
        const errorMessage = error instanceof Error ? error.message : "Ocorreu um erro desconhecido ao enviar mídia.";
        return { success: false, error: errorMessage };
    } 
}


/**
 * Action specifically for sending messages from the UI (human agents).
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
 * Action for sending automated messages (e.g., from Autopilot or System Agents).
 * The senderId is passed explicitly.
 */
export async function sendAutomatedMessageAction(
    chatId: string,
    content: string,
    agentId: string,
    isSystemAgent: boolean = false,
    instanceName?: string, // Opcional
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
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
        return { success: false, error: 'Usuário não autenticado.' };
    }
    return internalSendMedia(chatId, caption, mediaFiles, session.user.id);
}

/**
 * Action for sending media from automated systems (System Agents).
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
    instanceName?: string, // Opcional
): Promise<{ success: boolean; error?: string }> {
    return internalSendMedia(chatId, caption, mediaFiles, agentId, { sentBy: 'system_agent' }, instanceName);
}
