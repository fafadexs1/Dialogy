import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { db } from '@/lib/db';
import { fetchEvolutionAPI } from '@/lib/whatsapp/evolution-api-client';
import type { Message, MessageMetadata, Chat, Contact } from '@/lib/types';
import { dispatchMessageToWebhooks } from '@/services/webhook-dispatcher';
import {
    enqueueAiAutopilotProcess,
    enqueueEvolutionWebhookProcess,
    enqueueQueueAutoClose,
    enqueueWebhookOutbound,
    shouldEnqueueJob
} from '@/lib/queue';
import { evolutionWebhookQueue } from '@/lib/task-queue';
import { buildChatProtocol, sanitizeUrl } from '@/lib/utils';
import { normalizeStoredMediaUrl } from '@/lib/storage-url';
import { normalizeMimeType, resolveMediaMessageType } from '@/lib/media-message-type';
import { normalizeImageThumbnailSource } from '@/lib/storage-url';
import {
    AmbiguousEvolutionInstanceError,
    getEvolutionApiConfig,
    resolveEvolutionInstance,
} from '@/lib/whatsapp/evolution-config';
import {
    extractEvolutionInteractiveResponseId,
    extractEvolutionInteractiveResponseText,
    mapEvolutionInboundMessageTypeToDbType,
    resolveEvolutionInteractiveSelectionFromQuotedMessage,
    resolveEvolutionInboundMessageType,
    shouldAppendInboundToClosedWhatsappChat,
} from '@/lib/whatsapp/evolution-inbound-message';
import { extractAttributionToken } from '@/lib/marketing-attribution';
import {
    attributeInboundWhatsappMessageByProximity,
    attributeInboundWhatsappMessageByToken,
} from '@/lib/marketing-attribution-server';
import {
    findOrCreateWhatsappContact,
    findWhatsappChatByIdentity,
    lockWhatsappIdentityTransaction,
} from '@/lib/whatsapp/contact-identity';
import { rememberSendDigits } from '@/lib/whatsapp/number-form-memory';
import {
    claimEvolutionWebhookEvent,
    markEvolutionWebhookEventFailed,
    markEvolutionWebhookEventProcessed,
    persistEvolutionWebhookEvent,
} from '@/services/whatsapp/evolution-webhook-inbox';
import { verifyDialogyRequest } from '@/services/meta/dialogy-hmac';
import { broadcastHydratedChatUpdate } from '@/lib/realtime/chat-broadcast';
import { createNexusChatAdapters } from '@/modules/nexus/services/chat-adapters';
import { dispatchPublishedNexusMessage } from '@/modules/nexus/services/message-dispatcher';

const WHATSAPP_STANDARD_JID_SUFFIX = '@s.whatsapp.net';
const DISALLOWED_CONTACT_JID_SUFFIXES = ['@g.us', '@broadcast', '@newsletter'];
const STALE_REPLAY_TOLERANCE_MS = 2_000;
const NON_INBOUND_UPSERT_STATUSES = new Set(['READ', 'PLAYED']);

function normalizeInboundThumbnail(value: unknown): string | undefined {
    if (!value) return undefined;

    try {
        if (typeof value === 'string') {
            return normalizeImageThumbnailSource(value) || undefined;
        }

        if (Array.isArray(value)) {
            return `data:image/jpeg;base64,${Buffer.from(value).toString('base64')}`;
        }

        if (typeof value === 'object') {
            return `data:image/jpeg;base64,${Buffer.from(Object.values(value) as any[]).toString('base64')}`;
        }
    } catch (thumbErr) {
        console.error('[WEBHOOK_MSG_UPSERT] Erro ao converter thumbnail:', thumbErr);
    }

    return undefined;
}

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

async function getApiConfigForInstance(
    instanceIdentifier: string,
    workspaceId?: string | null
): Promise<{ api_url: string, api_key: string } | null> {
    return getEvolutionApiConfig(instanceIdentifier, { workspaceId });
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
    const interactiveText = extractEvolutionInteractiveResponseText(rawMessage);
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
        interactiveText,
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
        message?.buttonMessage,
        message?.locationMessage,
        message?.contactMessage,
        message?.contactsArrayMessage,
        message?.buttonsResponseMessage,
        message?.listResponseMessage,
        message?.templateButtonReplyMessage,
        message?.interactiveResponseMessage,
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
    remoteJid?: string | null,
    workspaceId?: string | null
): Promise<FailedMessageInspection | undefined> {
    const apiConfig = await getApiConfigForInstance(instanceName, workspaceId);
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
    const resolvedWorkspaceId = pickFirstNonEmptyString(payload?.__resolved_workspace_id);
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

    const inspection = await inspectFailedMessageFromEvolution(instanceName, keyId, remoteJid, resolvedWorkspaceId);
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

    const timerHandle = setTimeout(async () => {
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

            const queueRes = await client.query(
                `UPDATE chats
                 SET status = 'gerais',
                     closed_at = NULL,
                     assigned_system_agent_id = NULL,
                     assigned_at = NULL,
                     is_autopilot_active = FALSE,
                     copilot_mode = 'off'
                 WHERE id = $1
                   AND status = 'gerais'
                   AND agent_id IS NULL
                 RETURNING id`,
                [chatId]
            );

            if ((queueRes.rowCount ?? 0) === 0) {
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
                    `Atendimento mantido na fila apos ${seconds} segundos sem atendimento.`,
                    {
                        event: 'queue_timeout_kept_in_queue',
                        queueTimeoutMs: autoCloseMs,
                        lastIncomingAt: anchor.toISOString(),
                    },
                ]
            );

            await client.query('COMMIT');

            await broadcastHydratedChatUpdate(workspaceId, chatId);
        } catch (error) {
            await client.query('ROLLBACK');
            console.error('[QUEUE_AUTO_CLOSE] Falha ao encerrar chat da fila:', error);
        } finally {
            client.release();
        }
    }, autoCloseMs);

    (timerHandle as unknown as { unref?: () => void }).unref?.();
}

async function scheduleQueueAutoCloseAsync(
    chatId: string,
    workspaceId: string,
    lastIncomingAt: Date,
    autoCloseMs: number
) {
    if (!autoCloseMs || autoCloseMs <= 0) return;

    if (!shouldEnqueueJob('queue_auto_close')) {
        await scheduleQueueAutoClose(chatId, workspaceId, lastIncomingAt, autoCloseMs);
        return;
    }

    const anchor = Number.isFinite(lastIncomingAt.getTime()) ? lastIncomingAt : new Date();
    await enqueueQueueAutoClose(
        {
            chatId,
            workspaceId,
            lastIncomingAt: anchor.toISOString(),
            autoCloseMs,
        },
        {
            runAt: new Date(anchor.getTime() + autoCloseMs),
            maxAttempts: 1,
        }
    );
}

import { logAction } from '@/lib/observability/logger';
import { recordWebhookMetrics } from '@/lib/observability/metrics';

// ... imports

export async function POST(
    request: Request,
    props: { params: Promise<{ instanceName: string }> }
) {
    const params = await props.params;
    const instanceIdentifierFromUrl = params.instanceName;
    const requestId = randomUUID();
    const receivedAt = Date.now();
    let payload: any;
    const rawBody = await request.text();
    const keyId = request.headers.get('x-dialogy-key-id');
    const timestamp = request.headers.get('x-dialogy-timestamp');
    const deliveryId = request.headers.get('x-dialogy-delivery-id');
    const signature = request.headers.get('x-dialogy-signature');
    const hasAnySignatureHeader = Boolean(keyId || timestamp || deliveryId || signature);
    const requireHmac = process.env.EVOLUTION_WEBHOOK_REQUIRE_HMAC === 'true';
    if (hasAnySignatureHeader || requireHmac) {
        if (!keyId || !timestamp || !deliveryId || !signature) {
            return NextResponse.json({ error: 'Missing webhook signature headers' }, { status: 401 });
        }
        const verification = verifyDialogyRequest({ keyId, timestamp, deliveryId, signature, rawBody });
        if (!verification.ok) {
            return NextResponse.json(
                { error: verification.reason },
                { status: verification.reason === 'unknown_key' ? 403 : 401 },
            );
        }
    }

    let outcomeLogged = false;
    try {
        payload = JSON.parse(rawBody);
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
    let workspaceId: string | null = null;
    let resolvedInstanceName = instanceNameFromPayload || instanceIdentifierFromUrl;

    try {
        const resolvedInstance = await resolveEvolutionInstance(instanceIdentifierFromUrl, { allowLegacyInstanceName: true });
        if (!resolvedInstance) {
            await logAction({
                action: 'webhook_processed_fail',
                payload: {
                    request_id: requestId,
                    source: 'evolution',
                    status_code: 404,
                    error: 'instance_not_found',
                    instance_identifier: instanceIdentifierFromUrl,
                    instance_payload: instanceNameFromPayload,
                    duration_ms: Date.now() - receivedAt,
                },
            });
            recordWebhookMetrics({
                source: 'evolution',
                status: 'fail',
                event: 'instance_not_found',
                durationMs: Date.now() - receivedAt,
            });
            return NextResponse.json({ error: 'Instance not found' }, { status: 404 });
        }

        workspaceId = resolvedInstance.workspace_id;
        resolvedInstanceName = resolvedInstance.instance_name;
    } catch (error) {
        if (error instanceof AmbiguousEvolutionInstanceError) {
            console.error(`[WEBHOOK] Identificador de instancia ambiguo: ${instanceIdentifierFromUrl}`, error.matches);
            await logAction({
                action: 'webhook_processed_fail',
                payload: {
                    request_id: requestId,
                    source: 'evolution',
                    status_code: 409,
                    error: 'ambiguous_instance_identifier',
                    instance_identifier: instanceIdentifierFromUrl,
                    instance_payload: instanceNameFromPayload,
                    matches: error.matches,
                    duration_ms: Date.now() - receivedAt,
                },
            });
            recordWebhookMetrics({
                source: 'evolution',
                status: 'fail',
                event: 'ambiguous_instance_identifier',
                durationMs: Date.now() - receivedAt,
            });
            return NextResponse.json({ error: 'Ambiguous instance identifier' }, { status: 409 });
        }

        throw error;
    }

    if (resolvedInstanceName !== instanceNameFromPayload) {
        console.error(`[WEBHOOK] Conflito de nome de instancia. URL: ${instanceIdentifierFromUrl}, Resolvida: ${resolvedInstanceName}, Payload: ${instanceNameFromPayload}`);
        await logAction({
            action: 'webhook_processed_fail',
            payload: {
                request_id: requestId,
                source: 'evolution',
                status_code: 400,
                error: 'instance_name_mismatch',
                instance_url: instanceIdentifierFromUrl,
                instance_resolved: resolvedInstanceName,
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
                instance: resolvedInstanceName,
                instance_identifier: instanceIdentifierFromUrl,
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

    payload.__resolved_workspace_id = workspaceId;
    payload.__resolved_instance_name = resolvedInstanceName;
    payload.__instance_identifier = instanceIdentifierFromUrl;
    payload.__request_id = requestId;

    let durableEvent;
    try {
        durableEvent = await persistEvolutionWebhookEvent({
            workspaceId,
            instanceName: resolvedInstanceName,
            eventName: event,
            payload,
        });
    } catch (error) {
        console.error('[WEBHOOK] Falha ao persistir evento Evolution antes do aceite:', error);
        await logAction({
            action: 'webhook_processed_fail',
            workspaceId,
            payload: {
                request_id: requestId,
                source: 'evolution',
                event,
                instance: resolvedInstanceName,
                status_code: 503,
                error: 'durable_inbox_persist_failed',
                duration_ms: Date.now() - receivedAt,
            },
        });
        return NextResponse.json(
            { error: 'Webhook temporarily unavailable' },
            { status: 503 },
        );
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
            instance: resolvedInstanceName,
            instance_identifier: instanceIdentifierFromUrl,
            payload_bytes: payloadBytes,
            data_present: Boolean(payload?.data),
            queue: statsBefore,
            durable_event_id: durableEvent.id,
            durable_event_status: durableEvent.status,
        },
    });

    const jobId = requestId;
    console.log(`[WEBHOOK][${jobId}] Evento '${event}' recebido para ${resolvedInstanceName} (identifier=${instanceIdentifierFromUrl}). Fila: ativos=${statsBefore.active}, pendentes=${statsBefore.pending}`);

    if (durableEvent.status === 'processed' || durableEvent.status === 'dead_letter') {
        return NextResponse.json(
            {
                message: durableEvent.status === 'processed'
                    ? 'Webhook ja processado'
                    : 'Webhook registrado como dead letter',
                jobId,
                requestId,
                durableEventId: durableEvent.id,
                durableStatus: durableEvent.status,
            },
            { status: 202 },
        );
    }

    if (shouldEnqueueJob('evolution_webhook_process')) {
        try {
            const queued = await enqueueEvolutionWebhookProcess(
                { eventId: durableEvent.id },
                { maxAttempts: durableEvent.maxAttempts },
            );
            return NextResponse.json(
                {
                    message: 'Webhook persistido e aceito para processamento',
                    jobId: queued.id,
                    requestId,
                    durableEventId: durableEvent.id,
                    durableStatus: durableEvent.status,
                },
                { status: 202 },
            );
        } catch (error) {
            console.error('[WEBHOOK] Evento persistido, mas a fila duravel recusou o job:', error);
            await logAction({
                action: 'webhook_processed_fail',
                workspaceId,
                payload: {
                    request_id: requestId,
                    source: 'evolution',
                    event,
                    instance: resolvedInstanceName,
                    status_code: 503,
                    error: 'durable_queue_enqueue_failed',
                    durable_event_id: durableEvent.id,
                    duration_ms: Date.now() - receivedAt,
                },
            });
            return NextResponse.json(
                {
                    error: 'Webhook persisted but queue is temporarily unavailable',
                    durableEventId: durableEvent.id,
                },
                { status: 503 },
            );
        }
    }

    const queuedAt = Date.now();
    const runWebhookProcessing = async (executionMode: 'queue' | 'overflow_fallback') => {
        const processingStartedAt = Date.now();
        const queueWaitMs = processingStartedAt - queuedAt;
        try {
            await processPersistedEvolutionWebhookEvent(durableEvent.id, `inline:${requestId}`);
            const completedAt = Date.now();
            await logAction({
                action: 'webhook_processed_success',
                workspaceId,
                payload: {
                    request_id: requestId,
                    source: 'evolution',
                    event,
                    instance: resolvedInstanceName,
                    instance_identifier: instanceIdentifierFromUrl,
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
                    instance: resolvedInstanceName,
                    instance_identifier: instanceIdentifierFromUrl,
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
                            instance: resolvedInstanceName,
                            instance_identifier: instanceIdentifierFromUrl,
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
            durableEventId: durableEvent.id,
        },
        { status: 202 }
    );
}

export async function processPersistedEvolutionWebhookEvent(
    eventId: string,
    workerId: string,
): Promise<'processed' | 'skipped'> {
    const claimed = await claimEvolutionWebhookEvent({
        eventId,
        workerId,
    });
    if (!claimed) return 'skipped';

    try {
        await processEvolutionEvent(claimed.payload);
        await markEvolutionWebhookEventProcessed({
            eventId,
            workerId,
        });
        return 'processed';
    } catch (error) {
        await markEvolutionWebhookEventFailed({
            eventId,
            workerId,
            error,
        });
        throw error;
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
            console.log(`[WEBHOOK] Evento '${event}' recebido, mas nao ha handler implementado.`);
    }
}


function resolveMessageUpdateStatus(data: any): string | null {
    const rawStatus = data?.status ?? data?.update?.status;
    if (typeof rawStatus === 'number') {
        return ({ 0: 'ERROR', 1: 'PENDING', 2: 'SENT', 3: 'DELIVERED', 4: 'READ', 5: 'PLAYED' } as Record<number, string>)[rawStatus] ?? null;
    }
    return typeof rawStatus === 'string' && rawStatus.trim() ? rawStatus.trim().toUpperCase() : null;
}

async function handleMessagesUpdate(payload: any) {
    const { instance: instanceName, data } = payload;
    const keyId = pickFirstNonEmptyString(data?.keyId, data?.key?.id, data?.update?.key?.id);
    const normalizedStatus = resolveMessageUpdateStatus(data);

    if (!keyId || !normalizedStatus) {
        console.log('[WEBHOOK_MSG_UPDATE] Payload invalido, keyId ou status ausente.');
        return;
    }

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
                   AND UPPER(COALESCE(api_message_status, '')) NOT IN ('DELIVERED', 'READ', 'PLAYED')
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
                   AND CASE UPPER(COALESCE(api_message_status, ''))
                         WHEN 'PLAYED' THEN 5
                         WHEN 'READ' THEN 4
                         WHEN 'DELIVERED' THEN 3
                         WHEN 'SENT' THEN 2
                         WHEN 'PENDING' THEN 1
                         ELSE 0
                       END <= CASE $1
                         WHEN 'PLAYED' THEN 5
                         WHEN 'READ' THEN 4
                         WHEN 'DELIVERED' THEN 3
                         WHEN 'SENT' THEN 2
                         WHEN 'PENDING' THEN 1
                         ELSE 0
                       END
                 RETURNING chat_id, created_at, from_me`,
                [normalizedStatus, keyId]
            );

        if ((updateRes.rowCount ?? 0) > 0 && (normalizedStatus === 'READ' || normalizedStatus === 'PLAYED')) {
            const { chat_id, created_at, from_me } = updateRes.rows[0];

            // 2. If it's a read receipt for a message sent by us, mark all older messages in the same chat as READ
            if (from_me) {
                const olderMessagesRes = await client.query(
                    `UPDATE messages
                      SET api_message_status = 'READ',
                          metadata = COALESCE(metadata, '{}'::jsonb) - 'send_error' - 'send_error_details'
                      WHERE chat_id = $1
                        AND from_me = TRUE
                        AND created_at <= $2
                        AND message_id_from_api IS NOT NULL
                        AND UPPER(COALESCE(api_message_status, '')) IN ('SENT', 'DELIVERED')`,
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

async function dispatchPersistedInboundRealtimeEffects(input: {
    chat: Chat;
    message: Message;
    workspaceId: string;
    content: string;
    instanceName: string;
}): Promise<void> {
    const tasks: Promise<any>[] = [];
    const { chat, message, workspaceId, content, instanceName } = input;
    const queueStatus = (chat as any).status;
    const queueAgent = (chat as any).agent_id || (chat as any).agentId || null;

    if (queueStatus === 'encerrados') {
        return;
    }

    const webhookTask = shouldEnqueueJob('webhook_outbound')
        ? enqueueWebhookOutbound({
            chatId: chat.id,
            messageId: message.id,
            instanceName,
        })
        : dispatchMessageToWebhooks(chat, message, instanceName);
    tasks.push(webhookTask);

    if (queueStatus === 'gerais' && !queueAgent) {
        tasks.push((async () => {
            const autoCloseMs = await getQueueAutoCloseMs(workspaceId);
            if (!autoCloseMs || autoCloseMs <= 0) return;
            const rawCreatedAt = (message as any)?.created_at || (message as any)?.createdAt;
            const anchor = rawCreatedAt ? new Date(rawCreatedAt) : new Date();
            await scheduleQueueAutoCloseAsync(chat.id, workspaceId, anchor, autoCloseMs);
        })());
    }

    let nexusHandled = false;
    try {
        const nexus = await dispatchPublishedNexusMessage({
            workspaceId,
            chatId: chat.id,
            message: content,
            sourceMessageId: message.id,
            instanceName,
            metadata: {
                platform: 'whatsapp',
                messageType: message.type,
                selectedOptionId: message.metadata?.interactiveSelectionId,
            },
            adapters: () => createNexusChatAdapters({ workspaceId, chatId: chat.id, instanceName }),
        });
        nexusHandled = nexus.handled;
        if (nexusHandled) console.log(`[NEXUS_MESSAGE] Message ${message.id} handled by a native Nexus flow.`);
    } catch (error) {
        console.error('[NEXUS_MESSAGE] Failed to dispatch inbound message:', error);
    }

    if (chat.is_autopilot_active && !nexusHandled) {
        console.log(`[WEBHOOK_MSG_UPSERT] Scheduling Autopilot for chat ${chat.id}`);
        const autopilotTask = shouldEnqueueJob('ai_autopilot_process')
            ? enqueueAiAutopilotProcess({
                workspaceId: chat.workspace_id,
                chatId: chat.id,
                messageId: message.id,
                lastMessageContent: content,
                instanceName,
            })
            : (async () => {
                const { processAutopilotForChat } = await import('@/services/autopilot-service');
                return processAutopilotForChat(
                    chat.workspace_id,
                    chat,
                    content,
                    instanceName,
                    message.id,
                );
            })();
        tasks.push(autopilotTask);
    } else if (!nexusHandled) {
        console.log(`[WEBHOOK_MSG_UPSERT] Autopilot SKIPPED (Inactive) for chat ${chat.id}`);
    }

    await Promise.all(tasks);
}

async function resumePersistedInboundRealtimeEffects(input: {
    externalMessageId: string;
    instanceName: string;
}): Promise<boolean> {
    const existing = await db.query(
        `SELECT
           m.id AS message_id,
           m.workspace_id,
           m.chat_id,
           m.type AS message_type,
           m.content,
           m.metadata,
           m.from_me,
           m.created_at AS message_created_at,
           m.direction,
           m.instance_name,
           m.api_message_status,
           c.status AS chat_status,
           c.agent_id,
           c.assigned_system_agent_id,
           c.is_autopilot_active,
           c.autopilot_config_id,
           c.copilot_mode,
           c.source AS chat_source,
           c.instance_type,
           ct.id AS contact_id,
           ct.name AS contact_name,
           ct.email AS contact_email,
           ct.phone_number_jid,
           ct.avatar_url,
           ct.address
         FROM messages m
         JOIN chats c ON c.id = m.chat_id
         JOIN contacts ct ON ct.id = c.contact_id
         WHERE m.message_id_from_api = $1
         LIMIT 1`,
        [input.externalMessageId],
    );
    const row = existing.rows[0];
    if (!row) return false;

    const metadata = typeof row.metadata === 'string'
        ? JSON.parse(row.metadata)
        : (row.metadata || {});
    if (metadata.evolutionRealtimeSideEffectsEligible !== true) {
        return true;
    }

    const chat = {
        id: row.chat_id,
        workspace_id: row.workspace_id,
        status: row.chat_status,
        agent_id: row.agent_id,
        agentId: row.agent_id,
        assigned_system_agent_id: row.assigned_system_agent_id,
        is_autopilot_active: row.is_autopilot_active,
        autopilot_config_id: row.autopilot_config_id,
        copilot_mode: row.copilot_mode,
        source: row.chat_source,
        instance_type: row.instance_type,
        messages: [],
        contact: {
            id: row.contact_id,
            workspace_id: row.workspace_id,
            name: row.contact_name,
            email: row.contact_email,
            phone_number_jid: row.phone_number_jid,
            avatar_url: row.avatar_url,
            address: row.address,
        } as Contact,
    } as Chat;
    const message = {
        id: row.message_id,
        workspace_id: row.workspace_id,
        chat_id: row.chat_id,
        type: row.message_type,
        content: row.content || '',
        metadata,
        from_me: row.from_me,
        direction: row.direction,
        instance_name: row.instance_name || input.instanceName,
        api_message_status: row.api_message_status,
        status: 'default',
        transcription: null,
        timestamp: '',
        formattedDate: '',
        createdAt: new Date(row.message_created_at).toISOString(),
        created_at: row.message_created_at,
    } as Message;

    await dispatchPersistedInboundRealtimeEffects({
        chat,
        message,
        workspaceId: row.workspace_id,
        content: row.content || '',
        instanceName: row.instance_name || input.instanceName,
    });
    return true;
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
            `[WEBHOOK_MSG_UPSERT] Mensagem ${externalMessageId} ja persistida (${duplicateMessageRes.rows[0].id}). Retomando efeitos idempotentes.`
        );
        await resumePersistedInboundRealtimeEffects({
            externalMessageId,
            instanceName,
        });
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

    // Log payload for incoming messages as requested
    console.log('[WEBHOOK_MSG_UPSERT] Incoming message received.', {
        instanceName,
        event: payload?.event || null,
        hasData: Boolean(payload?.data),
    });

    // O JID com que o WhatsApp entregou e a fonte mais confiavel sobre qual
    // forma do numero (com/sem nono digito) a conta realmente usa.
    if (contactJid) {
        await rememberSendDigits(contactJid, contactJid, 'inbound');
    }

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
    const interactiveText = extractEvolutionInteractiveResponseText(message);
    const interactiveSelectionId = extractEvolutionInteractiveResponseId(message);

    content = pickFirstNonEmptyString(
        message.conversation,
        mediaDetails?.text,
        mediaDetails?.caption,
        interactiveText,
        locationLabel,
        sharedContactLabel
    ) || '';

    const replyContext = extractReplyContextFromPayload(data, message);

    // A URL da midia esta no nivel superior do objeto `message`
    // A Evolution entrega a midia do MinIO como URL assinada de 7 dias
    // (`presignedGetObject` sem prazo explicito). Guardar a assinatura junto faz
    // a midia "expirar" com o arquivo intacto no bucket, entao gravamos so o
    // caminho do objeto — que e de leitura publica e nao vence.
    const mediaUrl = normalizeStoredMediaUrl(sanitizeUrl(message.mediaUrl)) || null;
    console.log('[WEBHOOK_MSG_UPSERT] Message Object Keys:', Object.keys(message));
    console.log('[WEBHOOK_MSG_UPSERT] Extracted mediaUrl:', mediaUrl);
    console.log('[WEBHOOK_MSG_UPSERT] Message Type:', messageType);

    if (messageDetails) {
        console.log('[WEBHOOK_MSG_UPSERT] Message Details Keys:', Object.keys(messageDetails));
        console.log('[WEBHOOK_MSG_UPSERT] Raw Mimetype:', messageDetails.mimetype);
        console.log('[WEBHOOK_MSG_UPSERT] Raw Mime_type:', messageDetails.mime_type);
    }

    const effectiveMessageType = resolveEvolutionInboundMessageType({
        messageType,
        rawMessage: message,
        hasLocation: Boolean(locationDetails),
        hasSharedContacts,
    });

    if (effectiveMessageType) {
        const mappedDbMessageType = mapEvolutionInboundMessageTypeToDbType(effectiveMessageType);
        if (mappedDbMessageType === 'unsupported') {
            console.log(`[WEBHOOK_MSG_UPSERT] Tipo de mensagem nao suportado: ${effectiveMessageType}. Ignorando.`);
            return;
        }
        dbMessageType = mappedDbMessageType;
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

    const locationThumbnail = normalizeInboundThumbnail(locationDetails?.jpegThumbnail);

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
        thumbnail: normalizeInboundThumbnail((mediaDetails as any)?.thumbnail || (mediaDetails as any)?.jpegThumbnail),
        interactiveSelectionId,
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

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        const routedWorkspaceId = pickFirstNonEmptyString(payload?.__resolved_workspace_id);
        if (routedWorkspaceId) {
            workspaceId = routedWorkspaceId;
        } else {
            const instanceRes = await client.query(
                `SELECT workspace_id
                 FROM evolution_api_instances
                 WHERE instance_name = $1
                 LIMIT 1`, [instanceName]
            );
            if (instanceRes.rowCount === 0) throw new Error(`Workspace para a instancia '${instanceName}' nao encontrado.`);
            workspaceId = instanceRes.rows[0].workspace_id;
        }

        apiConfig = await getApiConfigForInstance(instanceName, workspaceId);
        if (!workspaceId) {
            throw new Error(`Workspace para a instancia '${instanceName}' nao encontrado.`);
        }

        await lockWhatsappIdentityTransaction(client, { workspaceId, phoneOrJid: contactJid });

        const resolvedContact = await findOrCreateWhatsappContact(client, {
            workspaceId,
            phoneOrJid: contactJid,
            fallbackName: pushName || contactJid.split('@')[0],
            fallbackPhone: contactJid.split('@')[0],
            avatarUrl: null,
        });

        contactData = resolvedContact.contact;
        isNewContact = resolvedContact.created;

        // contactData is guaranteed to be non-null here because of the check above
        if (!contactData) throw new Error("Contact data is null despite rowCount > 0");

        let chat: Chat = {} as Chat;
        let latestChatStatus: Chat['status'] | null = null;
        let requiresNewChat = false;
        const activeChat = await findWhatsappChatByIdentity(client, {
            workspaceId,
            phoneOrJid: contactJid,
            statuses: ['gerais', 'atendimentos'],
            preferOpen: true,
        });
        const recentChat = activeChat || await findWhatsappChatByIdentity(client, {
            workspaceId,
            phoneOrJid: contactJid,
            statuses: ['encerrados'],
        });

        if (recentChat) {
            latestChatStatus = recentChat.status as Chat['status'];
            if (recentChat.status === 'gerais' || recentChat.status === 'atendimentos') {
                chat = recentChat;
            } else if (recentChat.status === 'encerrados') {
                const closedAt = recentChat.closed_at ? new Date(recentChat.closed_at).getTime() : 0;
                const msgTime = messageCreatedAt.getTime();
                const isDelayedMessage = shouldAppendInboundToClosedWhatsappChat({
                    closedAt,
                    messageCreatedAt: msgTime,
                });

                if (isDelayedMessage) {
                    // Eventos atrasados, com timestamp anterior ao encerramento,
                    // pertencem apenas ao historico e nao reabrem a conversa.
                    chat = recentChat;
                    shouldRunRealtimeSideEffects = false;
                    sideEffectSkipReason = `delayed_inbound_after_close_${recentChat.id}`;
                } else {
                    // Uma mensagem realmente nova inicia outro atendimento.
                    // Reutilizar o chat encerrado herdava tag, setor e contexto
                    // da conversa anterior antes de o cliente escolher uma opção.
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
            if (!workspaceId) {
                throw new Error('Workspace nao encontrado para aplicar o limite mensal de chats.');
            }
            const { getMonthlyChatLimitStatus } = await import('@/lib/billing-logic');
            const chatLimitStatus = await getMonthlyChatLimitStatus(workspaceId);
            if (!chatLimitStatus.allowed) {
                throw new Error(`Limite mensal de chats do plano ${chatLimitStatus.plan.toUpperCase()} atingido.`);
            }
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
            metadata: MessageMetadata | string | null;
        } | null = null;

        if (replyContext.messageIdFromApi) {
            const replyReferenceRes = await client.query(
                `SELECT m.id, m.chat_id, m.content, m.type, m.from_me, m.created_at, m.metadata
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
                interactiveSelectionId: metadata.interactiveSelectionId
                    || resolveEvolutionInteractiveSelectionFromQuotedMessage(content, replyReferenceRow?.metadata),
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

        metadata = {
            ...metadata,
            evolutionRealtimeSideEffectsEligible: shouldRunRealtimeSideEffects,
            ...(sideEffectSkipReason
                ? { evolutionRealtimeSideEffectsSkipReason: sideEffectSkipReason }
                : {}),
        } as MessageMetadata;

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

        const attributionToken = !key.fromMe ? extractAttributionToken(content) : null;
        if (!key.fromMe) {
            await client.query('SAVEPOINT ad_attribution');
            try {
                const attributionInput = {
                    client,
                    workspaceId,
                    instanceName,
                    contactId: contactData.id,
                    chatId: chat.id,
                    messageId: messageResult.rows[0].id,
                };

                // Token e deterministico. Sem ele, cai no casamento por
                // proximidade, que ja se recusa a atuar quando o contato tem
                // atribuicao — caso contrario cada mensagem roubaria um clique.
                const attribution = attributionToken
                    ? await attributeInboundWhatsappMessageByToken({ ...attributionInput, token: attributionToken })
                    : await attributeInboundWhatsappMessageByProximity(attributionInput);

                await client.query('RELEASE SAVEPOINT ad_attribution');
                if (attribution) {
                    messageResult.rows[0].metadata = {
                        ...(messageResult.rows[0].metadata || {}),
                        attribution,
                    };
                }
            } catch (attributionError) {
                await client.query('ROLLBACK TO SAVEPOINT ad_attribution');
                await client.query('RELEASE SAVEPOINT ad_attribution');
                console.error('[AD_ATTRIBUTION] Falha ao vincular clique a mensagem inbound:', attributionError);
            }
        }

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
        throw error;
    } finally {
        client.release();
    }

    if (savedChat && savedMessage) {
        if (!shouldRunRealtimeSideEffects) {
            console.log(
                `[WEBHOOK_MSG_UPSERT] Side-effects em tempo real desativados para ${savedMessage.id}. Motivo: ${sideEffectSkipReason || 'unknown'}`
            );
        } else {
            await dispatchPersistedInboundRealtimeEffects({
                chat: savedChat,
                message: savedMessage,
                workspaceId: workspaceId!,
                content,
                instanceName,
            });
        }

        // Auto-capture: fire contact_created automations for new contacts
        if (isNewContact && workspaceId && contactData) {
            void (async () => {
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
            })();
        }

        // WhatsApp profile pic fetching disabled — Meta does not allow fetching profile pictures
        // for WhatsApp contacts (only Instagram/Messenger), and these requests overload the system.



        // ... existing code ...

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
