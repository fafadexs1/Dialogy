

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
import { generateEmbedding } from '@/lib/embeddings';
import { VectorStore } from '@/lib/vector-store';

const WHATSAPP_STANDARD_JID_SUFFIX = '@s.whatsapp.net';
const DISALLOWED_CONTACT_JID_SUFFIXES = ['@g.us', '@broadcast', '@newsletter'];
const STALE_REPLAY_TOLERANCE_MS = 2_000;
const NON_INBOUND_UPSERT_STATUSES = new Set(['READ', 'PLAYED']);

const parsedLiveEventMaxAgeSeconds = Number(process.env.EVOLUTION_LIVE_EVENT_MAX_AGE_SECONDS ?? 1800);
const LIVE_EVENT_MAX_AGE_MS =
    Number.isFinite(parsedLiveEventMaxAgeSeconds) && parsedLiveEventMaxAgeSeconds >= 0
        ? parsedLiveEventMaxAgeSeconds * 1000
        : 1_800_000;

function isDisallowedInboundJid(jid: string): boolean {
    const normalized = jid.trim().toLowerCase();
    if (!normalized) return true;
    return DISALLOWED_CONTACT_JID_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
}

function isRecentInboundEvent(createdAt: Date): boolean {
    if (!Number.isFinite(createdAt.getTime())) return true;
    const ageMs = Date.now() - createdAt.getTime();
    if (ageMs < -60_000) return false;
    return ageMs <= LIVE_EVENT_MAX_AGE_MS;
}

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

const FAILED_DELIVERY_STATUSES = new Set(['FAILED', 'ERROR']);

function pickFirstNonEmptyString(...values: unknown[]): string | undefined {
    for (const value of values) {
        if (typeof value === 'string') {
            const trimmed = value.trim();
            if (trimmed.length > 0) return trimmed;
        }
    }
    return undefined;
}

function pickFirstCode(...values: unknown[]): string | number | undefined {
    for (const value of values) {
        if (typeof value === 'number' && Number.isFinite(value)) return value;
        if (typeof value === 'string') {
            const trimmed = value.trim();
            if (trimmed.length > 0) return trimmed;
        }
    }
    return undefined;
}

function parseWebhookTimestamp(value: unknown): Date | null {
    if (value === null || value === undefined) return null;

    const parseEpoch = (raw: number): Date | null => {
        if (!Number.isFinite(raw) || raw <= 0) return null;
        const milliseconds = raw > 1_000_000_000_000 ? raw : raw * 1000;
        const parsed = new Date(milliseconds);
        return Number.isFinite(parsed.getTime()) ? parsed : null;
    };

    if (typeof value === 'number') {
        return parseEpoch(value);
    }

    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return null;

        const numericValue = Number(trimmed);
        if (Number.isFinite(numericValue)) {
            return parseEpoch(numericValue);
        }

        const parsedMs = Date.parse(trimmed);
        if (Number.isFinite(parsedMs)) {
            const parsed = new Date(parsedMs);
            return Number.isFinite(parsed.getTime()) ? parsed : null;
        }
    }

    return null;
}

type SharedContactData = {
    displayName?: string;
    fullName?: string;
    organization?: string;
    phones: string[];
    vcard?: string;
};

function normalizePhoneForDisplay(value: string): string | undefined {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    if (trimmed.startsWith('+')) return trimmed;
    const digits = trimmed.replace(/\D/g, '');
    return digits || undefined;
}

function extractPhonesFromVcard(vcard: string): string[] {
    const phones = new Set<string>();
    const lines = vcard.split(/\r?\n/);

    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;
        const telMatch = line.match(/^TEL[^:]*:(.+)$/i) || line.match(/^item\d+\.TEL[^:]*:(.+)$/i);
        if (!telMatch?.[1]) continue;
        const normalized = normalizePhoneForDisplay(telMatch[1]);
        if (normalized) phones.add(normalized);
    }

    return [...phones];
}

function parseSharedContactPayload(rawContact: any): SharedContactData | null {
    if (!rawContact || typeof rawContact !== 'object') return null;

    const vcard = pickFirstNonEmptyString(rawContact.vcard);
    const displayName = pickFirstNonEmptyString(rawContact.displayName);
    let fullName = pickFirstNonEmptyString(rawContact.fullName);
    let organization = pickFirstNonEmptyString(rawContact.organization);
    const phones = new Set<string>();

    const directPhone = pickFirstNonEmptyString(rawContact.phoneNumber, rawContact.waid);
    if (directPhone) {
        const normalized = normalizePhoneForDisplay(directPhone);
        if (normalized) phones.add(normalized);
    }

    if (vcard) {
        for (const phone of extractPhonesFromVcard(vcard)) {
            phones.add(phone);
        }
        for (const rawLine of vcard.split(/\r?\n/)) {
            const line = rawLine.trim();
            if (!line) continue;
            if (!fullName) {
                const fnMatch = line.match(/^FN:(.+)$/i);
                if (fnMatch?.[1]) fullName = fnMatch[1].trim();
            }
            if (!organization) {
                const orgMatch = line.match(/^ORG:(.+)$/i);
                if (orgMatch?.[1]) organization = orgMatch[1].trim();
            }
        }
    }

    if (!displayName && !fullName && phones.size === 0 && !organization) {
        return null;
    }

    return {
        displayName,
        fullName,
        organization,
        phones: [...phones],
        vcard,
    };
}

function extractSharedContactsFromMessage(rawMessage: any): SharedContactData[] {
    const contacts: SharedContactData[] = [];
    const single = parseSharedContactPayload(rawMessage?.contactMessage);
    if (single) contacts.push(single);

    const contactsArray = rawMessage?.contactsArrayMessage?.contacts;
    if (Array.isArray(contactsArray)) {
        for (const rawContact of contactsArray) {
            const parsed = parseSharedContactPayload(rawContact);
            if (parsed) contacts.push(parsed);
        }
    }

    return contacts;
}

type ReplyContextData = {
    messageIdFromApi?: string;
    participantJid?: string;
    previewContent?: string;
};

function extractMessagePreviewFromEnvelope(rawMessage: any): string | undefined {
    if (!rawMessage || typeof rawMessage !== 'object') return undefined;

    const locationDetails = rawMessage.locationMessage;
    const mediaDetails =
        rawMessage.imageMessage ||
        rawMessage.videoMessage ||
        rawMessage.documentMessage ||
        rawMessage.audioMessage ||
        rawMessage.extendedTextMessage;

    const latitude = locationDetails?.degreesLatitude !== undefined ? Number(locationDetails.degreesLatitude) : undefined;
    const longitude = locationDetails?.degreesLongitude !== undefined ? Number(locationDetails.degreesLongitude) : undefined;
    const hasNumericCoords = Number.isFinite(latitude) && Number.isFinite(longitude);
    const locationLabel = locationDetails
        ? locationDetails.name ||
        locationDetails.address ||
        (hasNumericCoords
            ? `Localizacao: ${latitude!.toFixed(5)}, ${longitude!.toFixed(5)}`
            : 'Localizacao enviada')
        : undefined;

    const sharedContacts = extractSharedContactsFromMessage(rawMessage);
    const primarySharedContact = sharedContacts.length > 0 ? sharedContacts[0] : null;
    const sharedContactLabel = primarySharedContact
        ? primarySharedContact.displayName ||
        primarySharedContact.fullName ||
        (primarySharedContact.phones[0]
            ? `Contato: ${primarySharedContact.phones[0]}`
            : 'Contato compartilhado')
        : undefined;

    return pickFirstNonEmptyString(
        rawMessage.conversation,
        mediaDetails?.text,
        mediaDetails?.caption,
        mediaDetails?.fileName,
        mediaDetails?.filename,
        locationLabel,
        sharedContactLabel
    );
}

function extractReplyContextFromPayload(data: any, message: any): ReplyContextData {
    const contexts: any[] = [];
    const pushContext = (value: any) => {
        if (value && typeof value === 'object') contexts.push(value);
    };

    pushContext(data?.contextInfo);
    pushContext(message?.contextInfo);

    const messageContextCandidates = [
        message?.extendedTextMessage,
        message?.imageMessage,
        message?.videoMessage,
        message?.documentMessage,
        message?.audioMessage,
        message?.locationMessage,
        message?.contactMessage,
        message?.contactsArrayMessage,
        message?.buttonsResponseMessage,
        message?.listResponseMessage,
        message?.templateButtonReplyMessage,
        message?.reactionMessage,
        message?.stickerMessage,
    ];

    for (const candidate of messageContextCandidates) {
        pushContext(candidate?.contextInfo);
    }

    const messageIdFromApi = pickFirstNonEmptyString(
        ...contexts.map((context) => context?.stanzaId),
        ...contexts.map((context) => context?.quotedMessageId),
        ...contexts.map((context) => context?.key?.id)
    );

    const participantJid = resolveWhatsappJid(
        ...contexts.map((context) => context?.participant),
        ...contexts.map((context) => context?.remoteJid)
    );

    const previewContent = pickFirstNonEmptyString(
        ...contexts.map((context) => extractMessagePreviewFromEnvelope(context?.quotedMessage))
    );

    return {
        messageIdFromApi,
        participantJid: participantJid ?? undefined,
        previewContent,
    };
}

type FailedMessageInspection = {
    messageUpdates?: Array<Record<string, unknown>>;
    findMessagesPayload?: unknown;
    findStatusPayload?: unknown;
};

async function inspectFailedMessageFromEvolution(
    instanceName: string,
    keyId: string,
    remoteJid?: string | null
): Promise<FailedMessageInspection | undefined> {
    const apiConfig = await getApiConfigForInstance(instanceName);
    if (!apiConfig) return undefined;

    const inspection: FailedMessageInspection = {};

    try {
        const where: Record<string, unknown> = {
            key: {
                id: keyId,
                ...(remoteJid ? { remoteJid } : {}),
            },
        };

        const response = await fetchEvolutionAPI(
            `/chat/findMessages/${instanceName}`,
            apiConfig,
            {
                method: 'POST',
                body: JSON.stringify({ where }),
            }
        );
        inspection.findMessagesPayload = response;

        const record = Array.isArray(response?.messages?.records)
            ? response.messages.records[0]
            : null;

        if (Array.isArray(record?.MessageUpdate)) {
            inspection.messageUpdates = record.MessageUpdate
                .filter((item: unknown) => item && typeof item === 'object')
                .slice(-10) as Array<Record<string, unknown>>;
        }
    } catch (error: any) {
        console.error(`[WEBHOOK_MSG_UPDATE] Falha ao enriquecer detalhes do FAILED para ${keyId}:`, error);
    }

    try {
        const statusWhere: Record<string, unknown> = {
            id: keyId,
            ...(remoteJid ? { remoteJid } : {}),
        };
        const statusPayload = await fetchEvolutionAPI(
            `/chat/findStatusMessage/${instanceName}`,
            apiConfig,
            {
                method: 'POST',
                body: JSON.stringify({ where: statusWhere }),
            }
        );
        inspection.findStatusPayload = statusPayload;
    } catch (error) {
        console.error(`[WEBHOOK_MSG_UPDATE] Falha ao obter findStatusMessage para ${keyId}:`, error);
    }

    return inspection;
}

async function buildFailedDeliveryDetails(
    payload: any,
    instanceName: string,
    keyId: string,
    normalizedStatus: string
): Promise<{
    summary: string;
    details: NonNullable<MessageMetadata['send_error_details']>;
}> {
    const data = payload?.data || {};
    const keyData = data?.key || {};
    const remoteJid = pickFirstNonEmptyString(data?.remoteJid, keyData?.remoteJid, data?.jid);

    const reason = pickFirstNonEmptyString(
        data?.reason,
        data?.failureReason,
        data?.details?.reason,
        data?.details?.message,
        data?.error?.reason,
        data?.error?.message,
        data?.errorMessage,
        data?.message,
        data?.statusReason,
        payload?.error?.message,
        payload?.message
    );
    const providerMessage = pickFirstNonEmptyString(
        data?.providerMessage,
        data?.details?.providerMessage,
        data?.error?.error_user_msg
    );
    const code = pickFirstCode(
        data?.error?.code,
        data?.details?.code,
        data?.errorCode,
        data?.statusCode,
        data?.code,
        payload?.error?.code
    );

    const summaryParts: string[] = [];
    if (reason) summaryParts.push(reason);
    if (providerMessage && providerMessage !== reason) summaryParts.push(providerMessage);
    if (code !== undefined) summaryParts.push(`Cod. ${code}`);

    const summary = summaryParts.length > 0
        ? summaryParts.join(' | ')
        : `WhatsApp retornou status ${normalizedStatus} para esta mensagem.`;

    const inspection = await inspectFailedMessageFromEvolution(instanceName, keyId, remoteJid);
    const messageUpdates = inspection?.messageUpdates;
    const providerPayload = {
        findMessages: inspection?.findMessagesPayload,
        findStatusMessage: inspection?.findStatusPayload,
    };
    const hasProviderPayload = Object.values(providerPayload).some((value) => value !== undefined);

    const details: NonNullable<MessageMetadata['send_error_details']> = {
        source: 'evolution_webhook',
        status: normalizedStatus,
        reason,
        code,
        provider_message: providerMessage,
        webhook_event: payload?.event,
        key_id: keyId,
        captured_at: new Date().toISOString(),
        raw_data: {
            keyId: data?.keyId,
            id: data?.id,
            status: data?.status,
            remoteJid,
            fromMe: data?.fromMe,
            reason: data?.reason,
            message: data?.message,
            details: data?.details,
            error: data?.error,
        },
        raw_payload: payload,
        provider_payload: hasProviderPayload ? providerPayload : undefined,
        message_updates: messageUpdates,
    };

    return { summary, details };
}

const DEFAULT_QUEUE_AUTO_CLOSE_MS = 0;

async function getQueueAutoCloseMs(workspaceId: string): Promise<number> {
    try {
        const res = await db.query(
            'SELECT queue_auto_close_seconds FROM workspaces WHERE id = $1',
            [workspaceId]
        );
        if ((res.rowCount ?? 0) === 0) return DEFAULT_QUEUE_AUTO_CLOSE_MS;
        const raw = res.rows[0].queue_auto_close_seconds;
        if (raw === null || raw === undefined) return DEFAULT_QUEUE_AUTO_CLOSE_MS;
        const seconds = Number(raw);
        if (!Number.isFinite(seconds) || seconds <= 0) return 0;
        return Math.round(seconds) * 1000;
    } catch (error) {
        console.error('[QUEUE_AUTO_CLOSE] Falha ao buscar configuracao:', error);
        return DEFAULT_QUEUE_AUTO_CLOSE_MS;
    }
}

async function scheduleQueueAutoClose(
    chatId: string,
    workspaceId: string,
    lastIncomingAt: Date,
    autoCloseMs: number
) {
    if (!autoCloseMs || autoCloseMs <= 0) return;
    const anchor = Number.isFinite(lastIncomingAt.getTime()) ? lastIncomingAt : new Date();

    setTimeout(async () => {
        const client = await db.connect();
        try {
            await client.query('BEGIN');

            const chatRes = await client.query(
                `SELECT status, agent_id FROM chats WHERE id = $1 FOR UPDATE`,
                [chatId]
            );
            if ((chatRes.rowCount ?? 0) === 0) {
                await client.query('ROLLBACK');
                return;
            }

            const { status, agent_id } = chatRes.rows[0];
            if (status !== 'gerais' || agent_id) {
                await client.query('ROLLBACK');
                return;
            }

            const hasNewInbound = await client.query(
                `SELECT 1
                 FROM messages
                 WHERE chat_id = $1
                   AND from_me = FALSE
                   AND created_at > $2
                 LIMIT 1`,
                [chatId, anchor.toISOString()]
            );

            if ((hasNewInbound.rowCount ?? 0) > 0) {
                await client.query('ROLLBACK');
                return;
            }

            const closeRes = await client.query(
                `UPDATE chats
                 SET status = 'encerrados', closed_at = NOW()
                 WHERE id = $1
                   AND status = 'gerais'
                   AND agent_id IS NULL`,
                [chatId]
            );

            if ((closeRes.rowCount ?? 0) === 0) {
                await client.query('ROLLBACK');
                return;
            }

            const seconds = Math.max(1, Math.round(autoCloseMs / 1000));
            await client.query(
                `INSERT INTO messages (
                    workspace_id, chat_id, type, content, from_me, is_read, metadata
                 ) VALUES ($1, $2, 'system', $3, true, true, $4)`,
                [
                    workspaceId,
                    chatId,
                    `Atendimento encerrado automaticamente apos ${seconds} segundos na fila sem atendimento.`,
                    {
                        event: 'queue_auto_close',
                        autoClosedAfterMs: autoCloseMs,
                        lastIncomingAt: anchor.toISOString(),
                    },
                ]
            );

            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK');
            console.error('[QUEUE_AUTO_CLOSE] Falha ao encerrar chat da fila:', error);
        } finally {
            client.release();
        }
    }, autoCloseMs).unref?.();
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
        console.error(`[WEBHOOK] Conflito de nome de instancia. URL: ${instanceNameFromUrl}, Payload: ${instanceNameFromPayload}`);
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
        console.error('[WEBHOOK] Erro: Evento nao encontrado no payload.');
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

    const queuedAt = Date.now();
    const runWebhookProcessing = async (executionMode: 'queue' | 'overflow_fallback') => {
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
                    execution_mode: executionMode,
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
                    execution_mode: executionMode,
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
    };

    void evolutionWebhookQueue
        .add(() => runWebhookProcessing('queue'))
        .then(() => {
            console.log(`[WEBHOOK][${jobId}] Evento '${event}' concluido em ${Date.now() - queuedAt}ms.`);
        })
        .catch(async (error) => {
            try {
                const isQueueFull = error instanceof Error && error.message.includes('Queue is full');

                if (isQueueFull) {
                    console.warn(`[WEBHOOK][${jobId}] Fila cheia. Processando '${event}' em fallback para evitar perda.`);
                    try {
                        await runWebhookProcessing('overflow_fallback');
                        console.log(`[WEBHOOK][${jobId}] Evento '${event}' concluido via fallback.`);
                    } catch (fallbackError) {
                        console.error(`[WEBHOOK][${jobId}] Falha no fallback do evento '${event}':`, fallbackError);
                    }
                    return;
                }

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
                            execution_mode: 'queue',
                        },
                    });
                    recordWebhookMetrics({
                        source: 'evolution',
                        status: 'fail',
                        event,
                        durationMs: Date.now() - receivedAt,
                    });
                }
            } catch (catchHandlerError) {
                console.error(`[WEBHOOK][${jobId}] Falha no handler de erro do webhook:`, catchHandlerError);
            }
        });

    return NextResponse.json(
        {
            message: 'Webhook aceito para processamento',
            jobId,
            requestId,
            queue: evolutionWebhookQueue.stats,
        },
        { status: 202 }
    );
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
            console.log(`[WEBHOOK] Evento '${event}' recebido, mas nao ha handler implementado.`);
    }
}


async function handleMessagesUpdate(payload: any) {
    const { instance: instanceName, data } = payload;

    if (!data || !data.keyId || !data.status) {
        console.log('[WEBHOOK_MSG_UPDATE] Payload invalido, keyId ou status ausente.');
        return;
    }

    const { keyId, status } = data;
    const normalizedStatus = status.toUpperCase();
    const isFailureStatus = FAILED_DELIVERY_STATUSES.has(normalizedStatus);

    console.log(`[WEBHOOK_MSG_UPDATE] Atualizando status da mensagem ${keyId} para ${normalizedStatus} na instancia ${instanceName}`);
    if (normalizedStatus === 'READ' || normalizedStatus === 'PLAYED') {
        console.log(`[WEBHOOK_MSG_VIEWED] Mensagem ${keyId} foi visualizada/reproduzida pelo contato.`);
    }

    let failedDeliveryDetails: Awaited<ReturnType<typeof buildFailedDeliveryDetails>> | null = null;
    if (isFailureStatus) {
        failedDeliveryDetails = await buildFailedDeliveryDetails(payload, instanceName, keyId, normalizedStatus);
    }

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        // 1. Update the specific message
        const updateRes = isFailureStatus && failedDeliveryDetails
            ? await client.query(
                `UPDATE messages
                 SET api_message_status = $1,
                     metadata = jsonb_set(
                        jsonb_set(COALESCE(metadata, '{}'::jsonb), '{send_error}', to_jsonb($3::text), true),
                        '{send_error_details}',
                        $4::jsonb,
                        true
                     )
                 WHERE message_id_from_api = $2
                 RETURNING chat_id, created_at, from_me`,
                [
                    normalizedStatus,
                    keyId,
                    failedDeliveryDetails.summary,
                    JSON.stringify(failedDeliveryDetails.details),
                ]
            )
            : await client.query(
                `UPDATE messages
                 SET api_message_status = $1,
                     metadata = COALESCE(metadata, '{}'::jsonb) - 'send_error' - 'send_error_details'
                 WHERE message_id_from_api = $2
                 RETURNING chat_id, created_at, from_me`,
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
        if (isFailureStatus && failedDeliveryDetails) {
            console.log(
                `[WEBHOOK_MSG_UPDATE] FAILED detalhado para ${keyId}: ${failedDeliveryDetails.summary}`
            );
        }
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
    let isNewContact = false;
    let shouldRunRealtimeSideEffects = true;
    let sideEffectSkipReason: string | null = null;
    const contactJid = resolveWhatsappJid(
        data?.key?.remoteJid,
        data?.key?.remoteJidAlt,
        data?.remoteJid,
        data?.remoteJidAlt
    );

    if (!data || !data.key || !data.message) {
        console.log('[WEBHOOK_MSG_UPSERT] Payload invalido, data, key ou message ausente.');
        return;
    }

    const { key, pushName, message, messageType } = data;
    if (key.fromMe) {
        console.log('[WEBHOOK_MSG_UPSERT] Mensagem ignorada (fromMe=true).');
        return;
    }

    const normalizedUpsertStatus =
        typeof data?.status === 'string' ? data.status.trim().toUpperCase() : '';
    if (normalizedUpsertStatus && NON_INBOUND_UPSERT_STATUSES.has(normalizedUpsertStatus)) {
        console.log(
            `[WEBHOOK_MSG_UPSERT] Evento ignorado por status nao-inbound (${normalizedUpsertStatus}).`
        );
        return;
    }

    const externalMessageId = pickFirstNonEmptyString(key?.id, data?.id, data?.keyId);
    if (!externalMessageId) {
        console.log('[WEBHOOK_MSG_UPSERT] Mensagem ignorada por falta de identificador externo (key.id).');
        return;
    }

    const duplicateMessageRes = await db.query(
        'SELECT id FROM messages WHERE message_id_from_api = $1 LIMIT 1',
        [externalMessageId]
    );
    if ((duplicateMessageRes.rowCount ?? 0) > 0) {
        console.log(
            `[WEBHOOK_MSG_UPSERT] Mensagem ${externalMessageId} ja processada (${duplicateMessageRes.rows[0].id}). Ignorando duplicata.`
        );
        return;
    }
    const rawMessageCreatedAt = parseWebhookTimestamp(
        data?.messageTimestamp ??
        data?.messageTimestampMs ??
        data?.timestamp ??
        payload?.date_time ??
        payload?.dateTime ??
        payload?.timestamp
    ) ?? new Date();

    const messageCreatedAt = new Date(Math.min(rawMessageCreatedAt.getTime(), Date.now()));
    const isLiveInbound = isRecentInboundEvent(messageCreatedAt);

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
            ? `Localizacao: ${latitude!.toFixed(5)}, ${longitude!.toFixed(5)}`
            : 'Localizacao enviada')
        : '';

    const sharedContacts = extractSharedContactsFromMessage(message);
    const hasSharedContacts = sharedContacts.length > 0;
    const primarySharedContact = hasSharedContacts ? sharedContacts[0] : null;
    const sharedContactLabel = primarySharedContact
        ? primarySharedContact.displayName ||
        primarySharedContact.fullName ||
        (primarySharedContact.phones[0]
            ? `Contato: ${primarySharedContact.phones[0]}`
            : 'Contato compartilhado')
        : '';

    content =
        message.conversation ||
        mediaDetails?.text ||
        mediaDetails?.caption ||
        locationLabel ||
        sharedContactLabel;

    const replyContext = extractReplyContextFromPayload(data, message);

    // A URL da midia esta no nivel superior do objeto `message`
    const mediaUrl = sanitizeUrl(message.mediaUrl) || null;
    console.log('[WEBHOOK_MSG_UPSERT] Message Object Keys:', Object.keys(message));
    console.log('[WEBHOOK_MSG_UPSERT] Extracted mediaUrl:', mediaUrl);
    console.log('[WEBHOOK_MSG_UPSERT] Message Type:', messageType);

    if (messageDetails) {
        console.log('[WEBHOOK_MSG_UPSERT] Message Details Keys:', Object.keys(messageDetails));
        console.log('[WEBHOOK_MSG_UPSERT] Raw Mimetype:', messageDetails.mimetype);
        console.log('[WEBHOOK_MSG_UPSERT] Raw Mime_type:', messageDetails.mime_type);
    }

    const effectiveMessageType = messageType || (locationDetails ? 'locationMessage' : hasSharedContacts ? 'contactMessage' : undefined);

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
            case 'contactMessage':
            case 'contactsArrayMessage':
                dbMessageType = 'text';
                break;
            case 'conversation': case 'extendedTextMessage': break;
            default:
                console.log(`[WEBHOOK_MSG_UPSERT] Tipo de mensagem nao suportado: ${effectiveMessageType}. Ignorando.`);
                return;
        }
    }

    if (!content.trim() && !mediaUrl && !locationDetails && !hasSharedContacts) {
        console.log('[WEBHOOK_MSG_UPSERT] Mensagem sem conteudo textual ou de midia. Ignorando.');
        return;
    }

    if (!contactJid) {
        console.log('[WEBHOOK_MSG_UPSERT] Nao foi possivel determinar o JID do contato. Payload ignorado.');
        return;
    }

    if (isDisallowedInboundJid(contactJid)) {
        console.log(`[WEBHOOK_MSG_UPSERT] JID ${contactJid} nao elegivel para processamento inbound. Ignorando.`);
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
            console.error('[WEBHOOK_MSG_UPSERT] Erro ao converter thumbnail de localizacao:', thumbErr);
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

    if (hasSharedContacts) {
        metadata = {
            ...metadata,
            sharedContactName: primarySharedContact?.displayName || primarySharedContact?.fullName,
            sharedContactPhones: primarySharedContact?.phones || [],
            sharedContactVcard: primarySharedContact?.vcard,
            sharedContacts: sharedContacts.map((item) => ({
                displayName: item.displayName,
                fullName: item.fullName,
                organization: item.organization,
                phones: item.phones,
                vcard: item.vcard,
            })),
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
        if (instanceRes.rowCount === 0) throw new Error(`Workspace para a instancia '${instanceName}' nao encontrado.`);

        workspaceId = instanceRes.rows[0].workspace_id;
        apiConfig = await getApiConfigForInstance(instanceName);

        let contactRes = await client.query(
            'SELECT * FROM contacts WHERE workspace_id = $1 AND phone_number_jid = $2', [workspaceId, contactJid]
        );

        if ((contactRes.rowCount ?? 0) === 0) {
            console.log(`[WEBHOOK_MSG_UPSERT] Contato com JID ${contactJid} nao encontrado no workspace ${workspaceId}. Criando novo contato...`);
            contactRes = await client.query(
                `INSERT INTO contacts (workspace_id, name, phone, phone_number_jid, avatar_url) VALUES ($1, $2, $3, $4, $5)
                 RETURNING *`,
                [workspaceId, pushName || contactPhone, contactPhone, contactJid, null]
            );
            isNewContact = true;
        }

        if ((contactRes.rowCount ?? 0) === 0) throw new Error(`Falha ao encontrar ou criar o contato com JID ${contactJid}`);
        contactData = contactRes.rows[0];

        // contactData is guaranteed to be non-null here because of the check above
        if (!contactData) throw new Error("Contact data is null despite rowCount > 0");

        let chatRes = await client.query(
            `SELECT * FROM chats WHERE workspace_id = $1 AND contact_id = $2 ORDER BY created_at DESC LIMIT 1`, [workspaceId, contactData.id]
        );

        let chat: Chat = {} as Chat;
        let latestChatStatus: Chat['status'] | null = null;
        let requiresNewChat = false;

        if ((chatRes.rowCount ?? 0) > 0) {
            const recentChat = chatRes.rows[0];
            latestChatStatus = recentChat.status as Chat['status'];
            if (recentChat.status === 'gerais' || recentChat.status === 'atendimentos') {
                chat = recentChat;
            } else if (recentChat.status === 'encerrados') {
                const closedAt = recentChat.closed_at ? new Date(recentChat.closed_at).getTime() : 0;
                const msgTime = messageCreatedAt.getTime();

                // If message was sent before chat was closed, or within 15s (race condition / quick "thank you"), 
                // append to the closed chat rather than spamming a new chat in the queue.
                if (msgTime <= closedAt + 15000) {
                    chat = recentChat;
                    console.log(`[WEBHOOK_MSG_UPSERT] Mensagem dentro da tolerancia de encerramento (${msgTime <= closedAt ? 'atrasada' : 'grace period'}). Reutilizando chat encerrado ${chat.id}.`);
                } else if (!isLiveInbound) {
                    // Historical/replayed events must not reopen queue chats.
                    chat = recentChat;
                    shouldRunRealtimeSideEffects = false;
                    sideEffectSkipReason = `stale_inbound_after_close_${recentChat.id}`;
                    console.log(`[WEBHOOK_MSG_UPSERT] Evento stale apos encerramento. Mantendo no chat encerrado ${chat.id}.`);
                } else {
                    requiresNewChat = true;
                }
            } else {
                requiresNewChat = true;
            }
        } else {
            requiresNewChat = true;
        }

        if (requiresNewChat) {
            if (latestChatStatus === 'encerrados') {
                const trimmedContent = content.trim();
                const likelyOutboundEchoRes = await client.query(
                    `SELECT m.id
                     FROM messages m
                     JOIN chats c ON c.id = m.chat_id
                     WHERE c.workspace_id = $1
                       AND c.contact_id = $2
                       AND m.from_me = TRUE
                       AND m.created_at BETWEEN ($3::timestamptz - interval '2 minutes')
                                             AND ($3::timestamptz + interval '30 seconds')
                       AND (
                            m.message_id_from_api = $4
                            OR ($5 <> '' AND lower(trim(COALESCE(m.content, ''))) = lower($5))
                       )
                     ORDER BY m.created_at DESC
                     LIMIT 1`,
                    [
                        workspaceId,
                        contactData.id,
                        messageCreatedAt.toISOString(),
                        externalMessageId,
                        trimmedContent,
                    ]
                );

                if ((likelyOutboundEchoRes.rowCount ?? 0) > 0) {
                    console.log(
                        `[WEBHOOK_MSG_UPSERT] Evento potencialmente echo/outbound apos encerramento (${externalMessageId}). Ignorando para nao reabrir fila.`
                    );
                    await client.query('ROLLBACK');
                    return;
                }
            }

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

        let replyReferenceRow: {
            id: string;
            chat_id: string;
            content: string | null;
            type: Message['type'];
            from_me: boolean;
            created_at: string | Date;
        } | null = null;

        if (replyContext.messageIdFromApi) {
            const replyReferenceRes = await client.query(
                `SELECT m.id, m.chat_id, m.content, m.type, m.from_me, m.created_at
                 FROM messages m
                 JOIN chats c ON c.id = m.chat_id
                 WHERE m.workspace_id = $1
                   AND m.message_id_from_api = $2
                   AND c.contact_id = $3
                 ORDER BY m.created_at DESC
                 LIMIT 1`,
                [workspaceId, replyContext.messageIdFromApi, contactData.id]
            );
            if ((replyReferenceRes.rowCount ?? 0) > 0) {
                replyReferenceRow = replyReferenceRes.rows[0];
            }

            const replyCreatedAtRaw = replyReferenceRow?.created_at;
            const replyCreatedAt = replyCreatedAtRaw ? new Date(replyCreatedAtRaw) : null;
            const resolvedReplyContent = pickFirstNonEmptyString(
                replyReferenceRow?.content,
                replyContext.previewContent
            );

            metadata = {
                ...metadata,
                replyToMessageIdFromApi: replyContext.messageIdFromApi,
                ...(replyContext.participantJid ? { replyToParticipantJid: replyContext.participantJid } : {}),
                ...(replyReferenceRow?.id ? { replyToMessageId: replyReferenceRow.id } : {}),
                ...(replyReferenceRow?.chat_id ? { replyToChatId: replyReferenceRow.chat_id } : {}),
                ...(replyReferenceRow?.type ? { replyToType: replyReferenceRow.type } : {}),
                ...(typeof replyReferenceRow?.from_me === 'boolean' ? { replyToFromMe: replyReferenceRow.from_me } : {}),
                ...(replyCreatedAt && Number.isFinite(replyCreatedAt.getTime())
                    ? { replyToCreatedAt: replyCreatedAt.toISOString() }
                    : {}),
                ...(resolvedReplyContent ? { replyToContent: resolvedReplyContent } : {}),
            };
        }

        const latestInboundRes = await client.query(
            `SELECT created_at
             FROM messages
             WHERE chat_id = $1
               AND from_me = FALSE
             ORDER BY created_at DESC
             LIMIT 1`,
            [chat.id]
        );
        const latestInboundAtRaw = latestInboundRes.rows[0]?.created_at;
        const latestInboundAt = latestInboundAtRaw ? new Date(latestInboundAtRaw) : null;

        if (
            latestInboundAt &&
            Number.isFinite(latestInboundAt.getTime()) &&
            messageCreatedAt.getTime() + STALE_REPLAY_TOLERANCE_MS < latestInboundAt.getTime()
        ) {
            shouldRunRealtimeSideEffects = false;
            sideEffectSkipReason = `historical_replay_before_${latestInboundAt.toISOString()}`;
        }

        if (shouldRunRealtimeSideEffects && !isRecentInboundEvent(messageCreatedAt)) {
            shouldRunRealtimeSideEffects = false;
            const ageMs = Date.now() - messageCreatedAt.getTime();
            sideEffectSkipReason = `stale_inbound_event_age_ms_${Math.round(ageMs)}`;
        }

        const messageResult = await client.query(
            `INSERT INTO messages (
                workspace_id, chat_id, type, content, metadata,
                message_id_from_api, sender_from_api, instance_name,
                source_from_api, from_me,
                api_message_status, raw_payload, created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
            [
                workspaceId, chat.id, dbMessageType, content, JSON.stringify(metadata ?? {}), externalMessageId, sender,
                instanceName, data.source, key.fromMe,
                data.status?.toUpperCase() || 'SENT', JSON.stringify(payload ?? {}), messageCreatedAt
            ]
        );

        await client.query('COMMIT');

        savedChat = chat;
        savedMessage = messageResult.rows[0];

    } catch (error: any) {
        await client.query('ROLLBACK');
        const isDuplicateExternalMessage =
            error?.code === '23505' &&
            typeof error?.constraint === 'string' &&
            error.constraint.includes('message_id_from_api');
        if (isDuplicateExternalMessage) {
            console.log(
                '[WEBHOOK_MSG_UPSERT] Mensagem duplicada ignorada por duplicidade concorrente.'
            );
            return;
        }
        console.error('[WEBHOOK_MSG_UPSERT] Erro ao processar a mensagem na transacao:', error);
        return;
    } finally {
        client.release();
    }

    if (savedChat && savedMessage) {
        const postTransactionTasks: Promise<any>[] = [];

        if (!shouldRunRealtimeSideEffects) {
            console.log(
                `[WEBHOOK_MSG_UPSERT] Side-effects em tempo real desativados para ${savedMessage.id}. Motivo: ${sideEffectSkipReason || 'unknown'}`
            );
        } else {
            const webhookTask = shouldEnqueueJob('webhook_outbound')
                ? enqueueWebhookOutbound({
                    chatId: savedChat.id,
                    messageId: savedMessage.id,
                    instanceName,
                })
                : dispatchMessageToWebhooks(savedChat, savedMessage, instanceName);
            postTransactionTasks.push(webhookTask);
        }

        // Auto-capture: fire contact_created automations for new contacts
        if (isNewContact && workspaceId && contactData) {
            postTransactionTasks.push((async () => {
                try {
                    const { evaluateAutomations } = await import('@/lib/automation-engine');
                    await evaluateAutomations({
                        type: 'contact_created',
                        contactId: contactData!.id,
                        workspaceId: workspaceId!,
                        data: { name: contactData!.name, phone: (contactData as any)?.phone },
                    });
                    console.log(`[AUTO_CAPTURE] Automacoes contact_created disparadas para ${contactData!.id}`);
                } catch (err) {
                    console.error('[AUTO_CAPTURE] Erro ao disparar automacoes:', err);
                }
            })());
        }

        // WhatsApp profile pic fetching disabled — Meta does not allow fetching profile pictures
        // for WhatsApp contacts (only Instagram/Messenger), and these requests overload the system.



        // ... existing code ...

        // Trigger Autopilot for incoming messages
        if (!key.fromMe && shouldRunRealtimeSideEffects) {
            const queueStatus = (savedChat as any).status;
            const queueAgent = (savedChat as any).agent_id || (savedChat as any).agentId || null;
            if (workspaceId && queueStatus === 'gerais' && !queueAgent) {
                postTransactionTasks.push((async () => {
                    const autoCloseMs = await getQueueAutoCloseMs(workspaceId as string);
                    if (!autoCloseMs || autoCloseMs <= 0) return;
                    const rawCreatedAt = (savedMessage as any)?.created_at || (savedMessage as any)?.createdAt;
                    const anchor = rawCreatedAt ? new Date(rawCreatedAt) : new Date();
                    await scheduleQueueAutoClose(savedChat.id, workspaceId as string, anchor, autoCloseMs);
                })());
            }

            if (savedChat.is_autopilot_active) {
                console.log(`[WEBHOOK_MSG_UPSERT] Enqueueing Autopilot for chat ${savedChat.id}`);
                postTransactionTasks.push(
                    processAutopilotForChat(savedChat.workspace_id, savedChat, content, instanceName)
                );
            } else {
                console.log(`[WEBHOOK_MSG_UPSERT] Autopilot SKIPPED (Inactive) for chat ${savedChat.id}`);
            }

            // --- RAG INGESTION (INBOUND) ---
            if (dbMessageType === 'text' && content) {
                postTransactionTasks.push((async () => {
                    try {
                        console.log(`[RAG] Embedding inbound message: ${savedMessage?.id} (user)`);
                        const vector = await generateEmbedding(content, 'chat');
                        if (vector.length > 0 && savedMessage) {
                            await VectorStore.addMessageEmbedding(
                                savedMessage.id,
                                savedChat!.id,
                                content,
                                'user',
                                vector
                            );
                        }
                    } catch (ragError) {
                        console.error(`[RAG] Failed to embed inbound message:`, ragError);
                    }
                })());
            }
            // --- END RAG ---
        }

        await Promise.all(postTransactionTasks).catch(err => {
            console.error("[WEBHOOK_POST_TRANSACTION] Erro ao executar tarefas em paralelo:", err);
        });
    }
}

// updateProfilePicture disabled — Meta does not allow fetching WhatsApp profile pictures.
// Only Instagram and Messenger support profile picture access.


async function handleContactsUpdate(_payload: any) {
    // WhatsApp contact profile picture updates disabled.
    // Meta does not allow fetching profile pictures for WhatsApp contacts.
    // Only Instagram and Messenger support profile picture access.
    // This handler now intentionally does nothing to avoid unnecessary API calls.
    return;
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
            console.log(`[WEBHOOK_CHAT_UPSERT] Recebido evento de arquivamento para ${remoteJid}. Esta funcionalidade ainda nao esta implementada.`);
        }
    }
}
