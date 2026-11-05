import 'server-only';

import { db } from '@/lib/db';
import type { Message, MessageMetadata } from '@/lib/types';
import { analyzeMediaForAutopilot } from '@/ai/flows/analyze-media';
import { createPrivateObjectDownloadUrl } from '@/lib/storage/private-s3';

const MAX_AI_ANALYSIS_CHARS = 8000;

function resolveAnalysisKind(type: Message['type']): MessageMetadata['analysisKind'] {
    if (type === 'audio') return 'transcription';
    if (type === 'image') return 'visual_summary';
    if (type === 'video') return 'video_summary';
    return 'media_summary';
}

export async function buildMediaAnalysisContext(input: {
    workspaceId: string;
    chatId: string;
    messageId?: string | null;
    systemAgentId: string;
    model?: string | null;
    recordAnalysis?: boolean;
    assertCurrent?: () => Promise<void>;
}): Promise<string> {
    if (!input.messageId) return '';
    await input.assertCurrent?.();

    // Apenas executar analise quando a IA estiver em atendimento ativo no chat
    const chatRes = await db.query(
        `SELECT id, status, is_autopilot_active, assigned_system_agent_id
         FROM chats
         WHERE id = $1 AND workspace_id = $2
         LIMIT 1`,
        [input.chatId, input.workspaceId]
    );
    const chat = chatRes.rows[0];
    if (!chat || !chat.is_autopilot_active || chat.status === 'encerrados') {
        return '';
    }

    const { rows } = await db.query(
        `SELECT id, type, content, metadata, media_url, raw_payload
         FROM messages
         WHERE id = $1
           AND chat_id = $2 AND workspace_id = $3 AND from_me = FALSE
         LIMIT 1`,
        [input.messageId, input.chatId, input.workspaceId]
    );
    const message = rows[0];
    if (!message) return '';

    const type = message.type as Message['type'];
    if (!['audio', 'image', 'video', 'document'].includes(type)) return '';

    let metadata: MessageMetadata = {};
    try {
        metadata = typeof message.metadata === 'string'
            ? JSON.parse(message.metadata)
            : message.metadata || {};
    } catch {
        metadata = {};
    }

    let mediaUrl = metadata.signedMediaUrl || metadata.originalMediaUrl || metadata.mediaUrl || message.media_url;
    if (!mediaUrl && metadata.base64) {
        mediaUrl = metadata.base64.startsWith('data:') ? metadata.base64 : `data:${metadata.mimetype || 'audio/ogg'};base64,${metadata.base64}`;
    }
    if (!mediaUrl && message.raw_payload) {
        try {
            const raw = typeof message.raw_payload === 'string' ? JSON.parse(message.raw_payload) : message.raw_payload;
            mediaUrl = raw?.data?.message?.mediaUrl || raw?.message?.mediaUrl || null;
        } catch {
            // ignore
        }
    }
    if (metadata.storageKey) {
        try {
            mediaUrl = await createPrivateObjectDownloadUrl(metadata.storageKey);
        } catch (error) {
            console.error('[AUTOPILOT_MEDIA_ANALYSIS] Failed to sign private media:', error);
        }
    }
    if (!mediaUrl) {
        return `[Midia recebida: ${type}. Nao foi possivel localizar URL publica para analise automatica.]`;
    }

    try {
        const result = await analyzeMediaForAutopilot({
            workspaceId: input.workspaceId,
            mediaUrl,
            mediaType: type as 'audio' | 'image' | 'video' | 'document',
            mimetype: metadata.mimetype,
            caption: message.content,
            model: input.model,
        });
        await input.assertCurrent?.();
        const compact = compactAiAnalysis(result.analysis);

        // Salva a descricao na mensagem para exibir diretamente abaixo da imagem/audio/documento na interface
        if (type === 'image' || type === 'audio' || type === 'document') {
            await db.query(
                `UPDATE messages
                 SET transcription = $1
                 WHERE id = $2 AND workspace_id = $3`,
                [compact, message.id, input.workspaceId]
            );
        }

        const label = type === 'audio'
            ? 'Audio do cliente'
            : type === 'image'
                ? 'Imagem do cliente'
                : type === 'document'
                    ? 'Documento/PDF do cliente'
                    : 'Video do cliente';
        const content = `${label}: ${compact}`;
        if (input.recordAnalysis !== false) await insertAiAnalysisMessage({
            workspaceId: input.workspaceId,
            chatId: input.chatId,
            systemAgentId: input.systemAgentId,
            content,
            sourceMessageId: message.id,
            sourceType: type,
            analysisKind: resolveAnalysisKind(type) as NonNullable<MessageMetadata['analysisKind']>,
        });
        return `[Analise automatica de ${type}] ${compact}`;
    } catch (error) {
        console.error('[AUTOPILOT_MEDIA_ANALYSIS] Failed:', error);
        await input.assertCurrent?.();
        return `[Midia recebida: ${type}. A analise automatica falhou; se necessario, peca ao cliente para descrever o conteudo.]`;
    }
}

function compactAiAnalysis(value: string): string {
    const normalized = value.replace(/\s+/g, ' ').trim();
    if (normalized.length <= MAX_AI_ANALYSIS_CHARS) return normalized;
    return `${normalized.slice(0, MAX_AI_ANALYSIS_CHARS - 1).trim()}…`;
}

async function insertAiAnalysisMessage(input: {
    workspaceId: string;
    chatId: string;
    systemAgentId: string;
    content: string;
    sourceMessageId: string;
    sourceType: Message['type'];
    analysisKind: NonNullable<MessageMetadata['analysisKind']>;
}) {
    await db.query(
        `INSERT INTO messages (
            workspace_id,
            chat_id,
            type,
            content,
            from_me,
            api_message_status,
            metadata,
            is_read,
            sender_system_agent_id,
            created_at
         ) VALUES ($1, $2, 'text', $3, true, 'internal', $4, true, $5, clock_timestamp())`,
        [
            input.workspaceId,
            input.chatId,
            input.content,
            JSON.stringify({
                isAiAnalysis: true,
                analysisKind: input.analysisKind,
                sourceMessageId: input.sourceMessageId,
                sourceType: input.sourceType,
                sentBy: 'system_agent',
                tool: 'ai_media_analysis',
            } satisfies MessageMetadata),
            input.systemAgentId,
        ]
    );
}
