

'use server';

import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { db } from '@/lib/db';
import { fetchEvolutionAPI } from '@/actions/evolution-api';
import type { Message, MessageMetadata, Chat, Contact } from '@/lib/types';
import { dispatchMessageToWebhooks } from '@/services/webhook-dispatcher';
import { enqueueWebhookOutbound, shouldEnqueueJob } from '@/lib/queue';
import { evolutionWebhookQueue } from '@/lib/task-queue';
import { buildChatProtocol, sanitizeUrl } from '@/lib/utils';
import { processAutopilotForChat } from '@/services/autopilot-service';
import { normalizeMimeType, resolveMediaMessageType } from '@/lib/media-message-type';

const WHATSAPP_STANDARD_JID_SUFFIX = '@s.whatsapp.net';

function resolveWhatsappJid(...candidates: Array<string | null | undefined>): string | null {
    const sanitized = candidates
        .map(candidate => (typeof candidate === 'string' ? candidate.trim() : ''))
        .filter((jid): jid is string => Boolean(jid));
    if (sanitized.length === 0) return null;
    const preferred = sanitized.find(jid => jid.toLowerCase().endsWith(WHATSAPP_STANDARD_JID_SUFFIX));
    return preferred ?? sanitized[0];
}

async function getApiConfigForInstance(instanceName: string): Promise<{ api_url: string, api_key: string } | null> {
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

import { logAction } from '@/lib/observability/logger';
import { recordWebhookMetrics } from '@/lib/observability/metrics';

// ... imports

export async function POST(
    request: Request,
    props: { params: Promise<{ instanceName: string }> }
) {
    const params = await props.params;
    const instanceNameFromUrl = params.instanceName;
    const requestId = randomUUID();
    const receivedAt = Date.now();
    let payload: any;

    let outcomeLogged = false;
    try {
        payload = await request.json();
    } catch (error) {
        console.error('[WEBHOOK] Erro ao converter o payload em JSON:', error);
        await logAction({
            action: 'webhook_processed_fail',
            payload: {
                request_id: requestId,
                source: 'evolution',
                status_code: 400,
                error: 'invalid_json',
                duration_ms: Date.now() - receivedAt,
            },
        });
        recordWebhookMetrics({
            source: 'evolution',
            status: 'fail',
            event: 'invalid_json',
            durationMs: Date.now() - receivedAt,
        });
        return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
    }

    const { event, instance: instanceNameFromPayload } = payload || {};
    const payloadBytes = Buffer.byteLength(JSON.stringify(payload ?? {}));

    if (instanceNameFromUrl !== instanceNameFromPayload) {
        console.error(`[WEBHOOK] Conflito de nome de instância. URL: ${instanceNameFromUrl}, Payload: ${instanceNameFromPayload}`);
        await logAction({
            action: 'webhook_processed_fail',
            payload: {
                request_id: requestId,
                source: 'evolution',
                status_code: 400,
                error: 'instance_name_mismatch',
                instance_url: instanceNameFromUrl,
                instance_payload: instanceNameFromPayload,
                duration_ms: Date.now() - receivedAt,
            },
        });
        recordWebhookMetrics({
            source: 'evolution',
            status: 'fail',
            event: 'instance_name_mismatch',
            durationMs: Date.now() - receivedAt,
        });
        return NextResponse.json({ error: 'Instance name mismatch' }, { status: 400 });
    }

    if (!event) {
        console.error('[WEBHOOK] Erro: Evento não encontrado no payload.');
        await logAction({
            action: 'webhook_processed_fail',
            payload: {
                request_id: requestId,
                source: 'evolution',
                status_code: 400,
                error: 'event_missing',
                instance: instanceNameFromUrl,
                duration_ms: Date.now() - receivedAt,
            },
        });
        recordWebhookMetrics({
            source: 'evolution',
            status: 'fail',
            event: 'event_missing',
            durationMs: Date.now() - receivedAt,
        });
        return NextResponse.json({ error: 'Event not found' }, { status: 400 });
    }

    // Resolve workspace_id for logging
    let workspaceId: string | null = null;
    try {
        const instanceRes = await db.query(
            'SELECT workspace_id FROM evolution_api_instances WHERE instance_name = $1',
            [instanceNameFromUrl]
        );
        workspaceId = instanceRes.rows[0]?.workspace_id || null;
    } catch (err) {
        console.error('[WEBHOOK] Failed to resolve workspace_id for logging', err);
    }

    const statsBefore = evolutionWebhookQueue.stats;
    // Log the incoming webhook event
    await logAction({
        action: 'webhook_received',
        workspaceId,
        payload: {
            request_id: requestId,
            source: 'evolution',
            event,
            instance: instanceNameFromUrl,
            payload_bytes: payloadBytes,
            data_present: Boolean(payload?.data),
            queue: statsBefore,
            // Keep full payload for traceability (logger will summarize).
            full_payload: payload,
        },
    });

    const jobId = requestId;
    console.log(`[WEBHOOK][${jobId}] Evento '${event}' recebido para ${instanceNameFromUrl}. Fila: ativos=${statsBefore.active}, pendentes=${statsBefore.pending}`);

    try {
        const queuedAt = Date.now();
        await evolutionWebhookQueue.add(async () => {
            const processingStartedAt = Date.now();
            const queueWaitMs = processingStartedAt - queuedAt;
            try {
                await processEvolutionEvent(payload);
                const completedAt = Date.now();
                await logAction({
                    action: 'webhook_processed_success',
                    workspaceId,
                    payload: {
                        request_id: requestId,
                        source: 'evolution',
                        event,
                        instance: instanceNameFromUrl,
                        status_code: 200,
                        duration_ms: completedAt - receivedAt,
                        processing_ms: completedAt - processingStartedAt,
                        queue_wait_ms: queueWaitMs,
                    },
                });
                recordWebhookMetrics({
                    source: 'evolution',
                    status: 'success',
                    event,
                    durationMs: completedAt - receivedAt,
                    queueWaitMs,
                });
                outcomeLogged = true;
            } catch (error) {
                const completedAt = Date.now();
                await logAction({
                    action: 'webhook_processed_fail',
                    workspaceId,
                    payload: {
                        request_id: requestId,
                        source: 'evolution',
                        event,
                        instance: instanceNameFromUrl,
                        status_code: 500,
                        duration_ms: completedAt - receivedAt,
                        processing_ms: completedAt - processingStartedAt,
                        queue_wait_ms: queueWaitMs,
                        error: error instanceof Error ? error.message : 'unknown_error',
                    },
                });
                recordWebhookMetrics({
                    source: 'evolution',
                    status: 'fail',
                    event,
                    durationMs: completedAt - receivedAt,
                    queueWaitMs,
                });
                outcomeLogged = true;
                throw error;
            }
        });
        console.log(`[WEBHOOK][${jobId}] Evento '${event}' concluído em ${Date.now() - queuedAt}ms.`);
        return NextResponse.json({
            message: 'Webhook processado com sucesso',
            jobId,
            requestId,
            queue: evolutionWebhookQueue.stats,
        });
    } catch (error) {
        console.error(`[WEBHOOK][${jobId}] Erro ao processar evento '${event}':`, error);
        if (!outcomeLogged) {
            await logAction({
                action: 'webhook_processed_fail',
                workspaceId,
                payload: {
                    request_id: requestId,
                    source: 'evolution',
                    event,
                    instance: instanceNameFromUrl,
                    status_code: 500,
                    duration_ms: Date.now() - receivedAt,
                    error: error instanceof Error ? error.message : 'unknown_error',
                },
            });
            recordWebhookMetrics({
                source: 'evolution',
                status: 'fail',
                event,
                durationMs: Date.now() - receivedAt,
            });
        }
        return NextResponse.json({ error: 'Internal Server Error', jobId, requestId }, { status: 500 });
    }
}

async function processEvolutionEvent(payload: any) {
    const { event } = payload;

    switch (event) {
        case 'messages.upsert':
            await handleMessagesUpsert(payload);
            break;
        case 'messages.update':
            await handleMessagesUpdate(payload);
            break;
        case 'contacts.update':
            await handleContactsUpdate(payload);
            break;
        case 'chats.upsert':
            await handleChatsUpsert(payload);
            break;
        default:
            console.log(`[WEBHOOK] Evento '${event}' recebido, mas não há handler implementado.`);
    }
}


async function handleMessagesUpdate(payload: any) {
    const { instance: instanceName, data } = payload;

    if (!data || !data.keyId || !data.status) {
        console.log('[WEBHOOK_MSG_UPDATE] Payload inválido, keyId ou status ausente.');
        return;
    }

    const { keyId, status } = data;
    const normalizedStatus = status.toUpperCase();

    console.log(`[WEBHOOK_MSG_UPDATE] Atualizando status da mensagem ${keyId} para ${normalizedStatus} na instância ${instanceName}`);
    if (normalizedStatus === 'READ' || normalizedStatus === 'PLAYED') {
        console.log(`[WEBHOOK_MSG_VIEWED] Mensagem ${keyId} foi visualizada/reproduzida pelo contato.`);
    }

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        // 1. Update the specific message
        const updateRes = await client.query(
            `UPDATE messages SET api_message_status = $1 WHERE message_id_from_api = $2 RETURNING chat_id, created_at, from_me`,
            [normalizedStatus, keyId]
        );

        if ((updateRes.rowCount ?? 0) > 0 && (normalizedStatus === 'READ' || normalizedStatus === 'PLAYED')) {
            const { chat_id, created_at, from_me } = updateRes.rows[0];

            // 2. If it's a read receipt for a message sent by us, mark all older messages in the same chat as READ
            if (from_me) {
                const olderMessagesRes = await client.query(
                    `UPDATE messages 
                     SET api_message_status = 'READ' 
                     WHERE chat_id = $1 
                       AND from_me = TRUE 
                       AND created_at <= $2 
                       AND (api_message_status IS NULL OR api_message_status NOT IN ('READ', 'PLAYED'))`,
                    [chat_id, created_at]
                );
                if ((olderMessagesRes.rowCount ?? 0) > 0) {
                    console.log(`[WEBHOOK_MSG_UPDATE] Propagado status READ para ${olderMessagesRes.rowCount} mensagens anteriores no chat ${chat_id}.`);
                }
            }
        }

        await client.query('COMMIT');
        console.log(`[WEBHOOK_MSG_UPDATE] Status da mensagem ${keyId} atualizado com sucesso.`);
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('[WEBHOOK_MSG_UPDATE] Erro ao atualizar status da mensagem:', error);
    } finally {
        client.release();
    }
}

async function handleMessagesUpsert(payload: any) {
    const { instance: instanceName, data, sender, server_url } = payload;

    let savedChat: Chat | null = null;
    let savedMessage: Message | null = null;
    let workspaceId: string | null = null;
    let apiConfig: { api_url: string; api_key: string; } | null = null;
    let contactData: Contact | null = null;
    const contactJid = resolveWhatsappJid(
        data?.key?.remoteJid,
        data?.key?.remoteJidAlt,
        data?.remoteJid,
        data?.remoteJidAlt
    );

    if (!data || !data.key || !data.message) {
        console.log('[WEBHOOK_MSG_UPSERT] Payload inválido, data, key ou message ausente.');
        return;
    }

    const { key, pushName, message, messageType } = data;

    if (key.fromMe) {
        console.log('[WEBHOOK_MSG_UPSERT] Mensagem ignorada (fromMe=true).');
        return;
    }

    // Log payload for incoming messages as requested
    console.log('[WEBHOOK_MSG_UPSERT] Incoming Message Payload:', JSON.stringify(payload, null, 2));

    let content = '';
    let dbMessageType: Message['type'] = 'text';

    const locationDetails = message.locationMessage;
    const mediaDetails = message.imageMessage || message.videoMessage || message.documentMessage || message.audioMessage || message.extendedTextMessage;
    const messageDetails = mediaDetails || locationDetails;

    const latitude = locationDetails?.degreesLatitude !== undefined ? Number(locationDetails.degreesLatitude) : undefined;
    const longitude = locationDetails?.degreesLongitude !== undefined ? Number(locationDetails.degreesLongitude) : undefined;
    const hasNumericCoords = Number.isFinite(latitude) && Number.isFinite(longitude);
    const locationLabel = locationDetails
        ? locationDetails.name ||
        (locationDetails as any)?.address ||
        (hasNumericCoords
            ? `Localização: ${latitude!.toFixed(5)}, ${longitude!.toFixed(5)}`
            : 'Localização enviada')
        : '';

    content = message.conversation || mediaDetails?.text || mediaDetails?.caption || locationLabel;

    // A URL da mídia está no nível superior do objeto `message`
    const mediaUrl = sanitizeUrl(message.mediaUrl) || null;
    console.log('[WEBHOOK_MSG_UPSERT] Message Object Keys:', Object.keys(message));
    console.log('[WEBHOOK_MSG_UPSERT] Extracted mediaUrl:', mediaUrl);
    console.log('[WEBHOOK_MSG_UPSERT] Message Type:', messageType);

    if (messageDetails) {
        console.log('[WEBHOOK_MSG_UPSERT] Message Details Keys:', Object.keys(messageDetails));
        console.log('[WEBHOOK_MSG_UPSERT] Raw Mimetype:', messageDetails.mimetype);
        console.log('[WEBHOOK_MSG_UPSERT] Raw Mime_type:', messageDetails.mime_type);
    }

    const effectiveMessageType = messageType || (locationDetails ? 'locationMessage' : undefined);

    if (effectiveMessageType) {
        switch (effectiveMessageType) {
            case 'audioMessage':
                dbMessageType = 'audio';
                break;
            case 'imageMessage':
                dbMessageType = 'image';
                break;
            case 'videoMessage':
                dbMessageType = 'video';
                break;
            case 'documentMessage':
                dbMessageType = 'document';
                break;
            case 'locationMessage':
                dbMessageType = 'location';
                break;
            case 'conversation': case 'extendedTextMessage': break;
            default:
                console.log(`[WEBHOOK_MSG_UPSERT] Tipo de mensagem não suportado: ${effectiveMessageType}. Ignorando.`);
                return;
        }
    }

    if (!content.trim() && !mediaUrl && !locationDetails) {
        console.log('[WEBHOOK_MSG_UPSERT] Mensagem sem conteúdo textual ou de mídia. Ignorando.');
        return;
    }

    if (!contactJid) {
        console.log('[WEBHOOK_MSG_UPSERT] Nao foi possivel determinar o JID do contato. Payload ignorado.');
        return;
    }

    // Construir o objeto metadata
    let mimetype = mediaDetails?.mimetype || mediaDetails?.mime_type;

    if (!mimetype && effectiveMessageType) {
        if (effectiveMessageType === 'imageMessage') mimetype = 'image/jpeg';
        else if (effectiveMessageType === 'videoMessage') mimetype = 'video/mp4';
        else if (effectiveMessageType === 'audioMessage') mimetype = 'audio/mp4';
    }

    const normalizedMime = normalizeMimeType(mimetype);
    const fileName = (mediaDetails as any)?.fileName || (mediaDetails as any)?.filename || null;
    const resolvedType = resolveMediaMessageType({
        currentType: dbMessageType,
        mimetype: normalizedMime || mimetype,
        fileName,
    });
    if (resolvedType !== dbMessageType) {
        console.log(`[WEBHOOK_MSG_UPSERT] Ajustando tipo de mensagem: ${dbMessageType} -> ${resolvedType}`);
        dbMessageType = resolvedType;
    }

    let locationThumbnail: string | undefined;
    const rawLocationThumb = locationDetails?.jpegThumbnail;
    if (rawLocationThumb) {
        try {
            if (typeof rawLocationThumb === 'string') {
                locationThumbnail = rawLocationThumb.startsWith('data:') ? rawLocationThumb : `data:image/jpeg;base64,${rawLocationThumb}`;
            } else if (Array.isArray(rawLocationThumb)) {
                locationThumbnail = `data:image/jpeg;base64,${Buffer.from(rawLocationThumb).toString('base64')}`;
            } else {
                locationThumbnail = `data:image/jpeg;base64,${Buffer.from(Object.values(rawLocationThumb) as any[]).toString('base64')}`;
            }
        } catch (thumbErr) {
            console.error('[WEBHOOK_MSG_UPSERT] Erro ao converter thumbnail de localização:', thumbErr);
        }
    }

    const safeLatitude = hasNumericCoords ? latitude : undefined;
    const safeLongitude = hasNumericCoords ? longitude : undefined;
    const mapsUrl = hasNumericCoords
        ? `https://www.google.com/maps?q=${latitude},${longitude}`
        : undefined;

    let metadata: MessageMetadata = {
        mediaUrl: mediaUrl || undefined,
        mimetype: normalizedMime || mimetype,
        fileName,
        duration: mediaDetails?.seconds,
        thumbnail: (mediaDetails as any)?.thumbnail || (mediaDetails as any)?.jpegThumbnail,
    };

    if (locationDetails) {
        metadata = {
            ...metadata,
            latitude: safeLatitude,
            longitude: safeLongitude,
            address: locationDetails.name || (locationDetails as any)?.address,
            locationName: locationDetails.name,
            locationDescription: (locationDetails as any)?.description,
            mapUrl: mapsUrl,
            thumbnail: locationThumbnail || metadata.thumbnail,
        };
    }

    const contactPhone = contactJid.split('@')[0];

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        const instanceRes = await client.query(
            `SELECT workspace_id
             FROM evolution_api_instances
             WHERE instance_name = $1`, [instanceName]
        );
        if (instanceRes.rowCount === 0) throw new Error(`Workspace para a instância '${instanceName}' não encontrado.`);

        workspaceId = instanceRes.rows[0].workspace_id;
        apiConfig = await getApiConfigForInstance(instanceName);

        let contactRes = await client.query(
            'SELECT * FROM contacts WHERE workspace_id = $1 AND phone_number_jid = $2', [workspaceId, contactJid]
        );

        if ((contactRes.rowCount ?? 0) === 0) {
            console.log(`[WEBHOOK_MSG_UPSERT] Contato com JID ${contactJid} não encontrado no workspace ${workspaceId}. Criando novo contato...`);
            contactRes = await client.query(
                `INSERT INTO contacts (workspace_id, name, phone, phone_number_jid, avatar_url) VALUES ($1, $2, $3, $4, $5)
                 RETURNING *`,
                [workspaceId, pushName || contactPhone, contactPhone, contactJid, null]
            );
        }

        if ((contactRes.rowCount ?? 0) === 0) throw new Error(`Falha ao encontrar ou criar o contato com JID ${contactJid}`);
        contactData = contactRes.rows[0];

        // contactData is guaranteed to be non-null here because of the check above
        if (!contactData) throw new Error("Contact data is null despite rowCount > 0");

        let chatRes = await client.query(
            `SELECT * FROM chats WHERE workspace_id = $1 AND contact_id = $2 AND status IN ('gerais', 'atendimentos') ORDER BY created_at DESC LIMIT 1`, [workspaceId, contactData.id]
        );

        let chat: Chat;
        if ((chatRes.rowCount ?? 0) > 0) {
            chat = chatRes.rows[0];
        } else {
            console.log(`[WEBHOOK_MSG_UPSERT] Nenhum chat ativo encontrado para ${contactJid}. Criando um novo.`);
            const chatId = randomUUID();
            const protocol = buildChatProtocol(chatId);
            console.log(`[WEBHOOK_MSG_UPSERT] Generated protocol for chat ${chatId}: ${protocol}`);
            const newChatRes = await client.query(
                `INSERT INTO chats (id, workspace_id, contact_id, status, protocol) VALUES ($1, $2, $3, 'gerais'::chat_status_enum, $4) RETURNING *`,
                [chatId, workspaceId, contactData.id, protocol]
            );
            chat = newChatRes.rows[0];
        }
        chat.contact = contactData;
        console.log(`[WEBHOOK_MSG_UPSERT] Chat loaded - is_autopilot_active: ${chat.is_autopilot_active}, copilot_mode: ${(chat as any).copilot_mode}`);

        const messageResult = await client.query(
            `INSERT INTO messages (
                workspace_id, chat_id, type, content, metadata,
                message_id_from_api, sender_from_api, instance_name,
                source_from_api, from_me,
                api_message_status, raw_payload
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
            [
                workspaceId, chat.id, dbMessageType, content, JSON.stringify(metadata ?? {}), key.id, sender,
                instanceName, data.source, key.fromMe,
                data.status?.toUpperCase() || 'SENT', JSON.stringify(payload ?? {})
            ]
        );

        await client.query('COMMIT');

        savedChat = chat;
        savedMessage = messageResult.rows[0];

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('[WEBHOOK_MSG_UPSERT] Erro ao processar a mensagem na transação:', error);
        return;
    } finally {
        client.release();
    }

    if (savedChat && savedMessage) {
        const webhookTask = shouldEnqueueJob('webhook_outbound')
            ? enqueueWebhookOutbound({
                chatId: savedChat.id,
                messageId: savedMessage.id,
                instanceName,
            })
            : dispatchMessageToWebhooks(savedChat, savedMessage, instanceName);

        const postTransactionTasks: Promise<any>[] = [
            webhookTask,
        ];

        if (contactData?.id && apiConfig && !contactData.avatar_url) {
            postTransactionTasks.push(
                updateProfilePicture(contactData.id, contactJid, instanceName, apiConfig)
            );
        }

        // Trigger Autopilot for incoming messages
        if (!key.fromMe) {
            postTransactionTasks.push(
                processAutopilotForChat(savedChat.workspace_id, savedChat, content, instanceName)
            );
        }

        await Promise.all(postTransactionTasks).catch(err => {
            console.error("[WEBHOOK_POST_TRANSACTION] Erro ao executar tarefas em paralelo:", err);
        });
    }
}

async function updateProfilePicture(contactId: string, contactJid: string, instanceName: string, apiConfig: { api_url: string; api_key: string; }) {
    try {
        console.log(`[WEBHOOK_PROFILE_PIC] Buscando foto para JID: ${contactJid}`);
        const profilePicRes = await fetchEvolutionAPI(
            `/chat/fetchProfilePictureUrl/${instanceName}`,
            apiConfig,
            { method: 'POST', body: JSON.stringify({ number: contactJid }) }
        );
        const profileUrl = sanitizeUrl(profilePicRes?.profilePictureUrl);

        if (profileUrl) {
            await db.query('UPDATE contacts SET avatar_url = $1 WHERE id = $2', [profileUrl, contactId]);
            console.log(`[WEBHOOK_PROFILE_PIC] Foto de perfil atualizada para o contato ${contactId}`);
        }
    } catch (picError) {
        console.error(`[WEBHOOK_PROFILE_PIC] Erro ao buscar foto de perfil para ${contactJid}:`, picError);
    }
}


async function handleContactsUpdate(payload: any) {
    const { instance: instanceName, data } = payload;
    if (!Array.isArray(data) || data.length === 0) return;

    const contactUpdate = data[0];
    const profilePicUrl = sanitizeUrl(contactUpdate?.profilePicUrl);
    const remoteJid = resolveWhatsappJid(
        contactUpdate?.id,
        contactUpdate?.remoteJid,
        contactUpdate?.remoteJidAlt
    );

    if (!remoteJid || !profilePicUrl) return;

    try {
        const instanceRes = await db.query('SELECT workspace_id FROM evolution_api_instances WHERE instance_name = $1', [instanceName]);
        if ((instanceRes.rowCount ?? 0) === 0) return;
        const workspaceId = instanceRes.rows[0].workspace_id;

        const result = await db.query(
            `UPDATE contacts SET avatar_url = $1 WHERE phone_number_jid = $2 AND workspace_id = $3`,
            [profilePicUrl, remoteJid, workspaceId]
        );

        if ((result.rowCount ?? 0) > 0) {
            console.log(`[WEBHOOK_CONTACT_UPDATE] Foto de perfil atualizada para o contato ${remoteJid}.`);
        }
    } catch (error) {
        console.error('[WEBHOOK_CONTACT_UPDATE] Erro ao atualizar foto de perfil:', error);
    }
}

async function handleChatsUpsert(payload: any) {
    const { instance: instanceName, data } = payload;
    if (!Array.isArray(data) || data.length === 0) return;

    for (const chatUpdate of data) {
        const remoteJid = resolveWhatsappJid(
            chatUpdate?.id,
            chatUpdate?.remoteJid,
            chatUpdate?.remoteJidAlt
        );
        const archive = chatUpdate?.archive;
        if (!remoteJid) continue;

        if (archive) {
            console.log(`[WEBHOOK_CHAT_UPSERT] Recebido evento de arquivamento para ${remoteJid}. Esta funcionalidade ainda não está implementada.`);
        }
    }
}


