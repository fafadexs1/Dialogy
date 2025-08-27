
'use server';

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { revalidatePath } from 'next/cache';
import { fetchEvolutionAPI } from '@/actions/evolution-api';
import type { Message, MessageMetadata, Chat, Contact, User } from '@/lib/types';
import { dispatchMessageToWebhooks } from '@/services/webhook-dispatcher';


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
    } else if (event === 'chats.upsert') {
      await handleChatsUpsert(payload);
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

async function handleMessagesUpdate(payload: any) {
    const { instance: instanceName, data } = payload;
    
    if (!data || !data.keyId || !data.status) {
        console.log('[WEBHOOK_MSG_UPDATE] Payload inválido, keyId ou status ausente.');
        return;
    }

    const { keyId, status } = data;

    console.log(`[WEBHOOK_MSG_UPDATE] Atualizando status da mensagem ${keyId} para ${status} na instância ${instanceName}`);
    
    try {
        await prisma.message.update({
            where: { messageIdFromApi: keyId },
            data: { apiMessageStatus: status.toUpperCase() },
        });
        console.log(`[WEBHOOK_MSG_UPDATE] Status da mensagem ${keyId} atualizado com sucesso.`);
    } catch (error) {
        console.error('[WEBHOOK_MSG_UPDATE] Erro ao atualizar status da mensagem:', error);
    }
}

async function handleMessagesUpsert(payload: any) {
    const { instance: instanceName, data, sender, server_url } = payload;
    
    let savedChat: Chat | null = null;
    let savedMessage: Message | null = null;
    let workspaceId: string | null = null;
    let apiConfig: { api_url: string; api_key: string; } | null = null;
    let contactData: Contact | null = null;
    const contactJid = data?.key?.remoteJid;

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
    let metadata: MessageMetadata = {};
    let dbMessageType: Message['type'] = 'text';

    const messageDetails = message.imageMessage || message.videoMessage || message.documentMessage || message.audioMessage || message.extendedTextMessage;
    
    content = message.conversation || messageDetails?.text || messageDetails?.caption || '';

    if (message.mediaUrl) metadata.mediaUrl = message.mediaUrl;
    
    if (messageType) {
        switch (messageType) {
            case 'audioMessage':
                dbMessageType = 'audio';
                metadata.mimetype = messageDetails?.mimetype;
                metadata.duration = messageDetails?.seconds;
                break;
            case 'imageMessage': case 'videoMessage': case 'documentMessage':
                metadata.mimetype = messageDetails?.mimetype;
                metadata.fileName = messageDetails?.fileName;
                break;
            case 'conversation': case 'extendedTextMessage': break;
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
    const contactPhone = sender || contactJid.split('@')[0];
    
    try {
        const instance = await prisma.evolutionApiInstance.findFirst({
            where: { name: instanceName },
            include: { config: true },
        });

        if (!instance) throw new Error(`Instância '${instanceName}' não encontrada.`);
        workspaceId = instance.config.workspaceId;
        apiConfig = { api_url: instance.config.apiUrl!, api_key: instance.config.apiKey! };

        // Upsert contact
        contactData = await prisma.contact.upsert({
            where: { phoneNumberJid_workspaceId: { phoneNumberJid: contactJid, workspaceId } },
            update: { name: pushName || contactPhone },
            create: {
                workspaceId,
                name: pushName || contactPhone,
                phone: contactPhone,
                phoneNumberJid: contactJid,
            },
        });

        if (!contactData) throw new Error(`Falha ao encontrar ou criar o contato com JID ${contactJid}`);

        let chat = await prisma.chat.findFirst({
            where: {
                workspaceId,
                contactId: contactData.id,
                status: { in: ['gerais', 'atendimentos'] }
            },
            orderBy: { assignedAt: 'desc' },
            include: { contact: true, agent: true }
        });

        if (!chat) {
            chat = await prisma.chat.create({
                data: {
                    workspaceId,
                    contactId: contactData.id,
                    status: 'gerais',
                },
                 include: { contact: true, agent: true }
            });
        }
        
        const messageResult = await prisma.message.create({
            data: {
                workspaceId,
                chatId: chat.id,
                // Mensagens de webhook são sempre do contato, nunca de um User ou SystemAgent.
                // O sender é inferido pelo chat->contact
                type: dbMessageType,
                content,
                metadata: JSON.stringify(metadata),
                createdAt: new Date(),
                messageIdFromApi: key.id,
                senderFromApi: sender,
                instanceName: instanceName,
                statusFromApi: data.status,
                sourceFromApi: data.source,
                serverUrl: parsedUrl,
                fromMe: key.fromMe,
                apiMessageStatus: data.status?.toUpperCase(),
                rawPayload: JSON.stringify(payload),
            },
            include: { sender: true, systemAgentSender: true }
        });

        savedChat = chat as any; // Cast because Prisma type is slightly different from our app type
        savedMessage = messageResult as any;

    } catch (error) {
        console.error('[WEBHOOK_MSG_UPSERT] Erro ao processar a mensagem na transação:', error);
        return;
    }
    
    if (savedChat && savedMessage) {
        const postTransactionTasks: Promise<any>[] = [
            dispatchMessageToWebhooks(savedChat, savedMessage, instanceName),
        ];

        if (contactData?.id && apiConfig && !contactData.avatarUrl) {
            postTransactionTasks.push(
                updateProfilePicture(contactData.id, contactJid, instanceName, apiConfig)
            );
        }
        
        Promise.all(postTransactionTasks).catch(err => {
            console.error("[WEBHOOK_POST_TRANSACTION] Erro ao executar tarefas em paralelo:", err);
        });
    }


    if (workspaceId) {
        revalidatePath(`/api/chats/${workspaceId}`);
    }
}

/**
 * Busca a foto de perfil de um contato e atualiza no banco de dados.
 */
async function updateProfilePicture(contactId: string, contactJid: string, instanceName: string, apiConfig: { api_url: string; api_key: string; }) {
    try {
        console.log(`[WEBHOOK_PROFILE_PIC] Buscando foto para JID: ${contactJid}`);
        const profilePicRes = await fetchEvolutionAPI(
            `/chat/fetchProfilePictureUrl/${instanceName}`,
            apiConfig,
            { method: 'POST', body: JSON.stringify({ number: contactJid }) }
        );
        if (profilePicRes?.profilePictureUrl) {
            await prisma.contact.update({
                where: { id: contactId },
                data: { avatarUrl: profilePicRes.profilePictureUrl }
            });
            console.log(`[WEBHOOK_PROFILE_PIC] Foto de perfil atualizada para o contato ${contactId}`);
        }
    } catch (picError) {
        console.error(`[WEBHOOK_PROFILE_PIC] Erro ao buscar foto de perfil para ${contactJid}:`, picError);
    }
}


async function handleContactsUpdate(payload: any) {
    const { instance: instanceName, data } = payload;
    if (!Array.isArray(data) || data.length === 0) {
        console.log('[WEBHOOK_CONTACT_UPDATE] Payload inválido ou vazio.');
        return;
    }
    
    const contactUpdate = data[0];
    const { id: remoteJid, profilePicUrl } = contactUpdate;

    if (!remoteJid || !profilePicUrl) {
        console.log('[WEBHOOK_CONTACT_UPDATE] JID ou URL da foto de perfil ausente.');
        return;
    }

    try {
        const instance = await prisma.evolutionApiInstance.findFirst({ where: { name: instanceName } });
        if (!instance) return;

        const result = await prisma.contact.updateMany({
            where: { phoneNumberJid: remoteJid, workspaceId: instance.workspaceId },
            data: { avatarUrl: profilePicUrl }
        });

        if (result.count > 0) {
            console.log(`[WEBHOOK_CONTACT_UPDATE] Foto de perfil atualizada para o contato ${remoteJid}.`);
        }
    } catch (error) {
        console.error('[WEBHOOK_CONTACT_UPDATE] Erro ao atualizar foto de perfil:', error);
    }
}

async function handleChatsUpsert(payload: any) {
    const { instance: instanceName, data } = payload;
     if (!Array.isArray(data) || data.length === 0) {
        console.log('[WEBHOOK_CHAT_UPSERT] Payload inválido ou vazio.');
        return;
    }
    
    for (const chatUpdate of data) {
        const { id: remoteJid, archive } = chatUpdate;
        if (!remoteJid) continue;

        if (archive) {
             console.log(`[WEBHOOK_CHAT_UPSERT] Recebido evento de arquivamento para ${remoteJid}. Esta funcionalidade ainda não está implementada.`);
        }
    }
}
