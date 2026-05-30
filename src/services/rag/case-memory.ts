import { db } from '@/lib/db';
import { DOCUMENT_EMBEDDING_DIMENSIONS, DOCUMENT_EMBEDDING_MODEL, generateDocumentPassageEmbedding } from '@/lib/embeddings';
import { VectorStore } from '@/lib/vector-store';
import { summarizeCaseMemory } from '@/ai/flows/case-memory-summarization';
import { resolveWorkspaceAiExecutionContext } from '@/services/ai/runtime';

type RefreshCaseMemoryInput = {
    chatId: string;
    workspaceId: string;
    closedAt?: string | null;
    force?: boolean;
};

type ChatResolutionContext = {
    id: string;
    workspace_id: string;
    contact_id: string | null;
    contact_name: string | null;
    autopilot_config_id: string | null;
    close_reason_tag_id: string | null;
    close_reason_label: string | null;
    close_notes: string | null;
    status: string;
    closed_at: string | null;
    source: string | null;
};

function normalizeText(value?: string | null) {
    return (value || '').replace(/\s+/g, ' ').trim();
}

function buildSearchableContent(input: {
    summary: string;
    problem: string;
    resolution: string;
    outcome: string;
    closeReasonLabel?: string | null;
    keywords?: string[];
}) {
    return [
        `Resumo: ${input.summary}`,
        `Problema: ${input.problem}`,
        `Resolucao: ${input.resolution}`,
        `Resultado: ${input.outcome}`,
        input.closeReasonLabel ? `Motivo de encerramento: ${input.closeReasonLabel}` : '',
        (input.keywords ?? []).length > 0 ? `Palavras-chave: ${(input.keywords ?? []).join(', ')}` : '',
    ]
        .filter(Boolean)
        .join('\n');
}

async function loadChatResolutionContext(chatId: string): Promise<ChatResolutionContext | null> {
    const { rows } = await db.query(
        `SELECT
            c.id,
            c.workspace_id,
            c.contact_id,
            ct.name AS contact_name,
            c.autopilot_config_id,
            c.close_reason_tag_id,
            t.label AS close_reason_label,
            c.close_notes,
            c.status,
            c.closed_at,
            c.source
         FROM chats c
         LEFT JOIN contacts ct ON ct.id = c.contact_id
         LEFT JOIN tags t ON t.id = c.close_reason_tag_id
         WHERE c.id = $1
         LIMIT 1`,
        [chatId]
    );

    return rows[0] ?? null;
}

async function loadTranscript(chatId: string) {
    const { rows } = await db.query(
        `SELECT content, from_me, type
         FROM messages
         WHERE chat_id = $1
           AND content IS NOT NULL
           AND btrim(content) <> ''
         ORDER BY created_at ASC
         LIMIT 120`,
        [chatId]
    );

    return rows
        .map((row) => {
            const sender = row.type === 'system' ? 'Sistema' : row.from_me ? 'Agente' : 'Cliente';
            return `${sender}: ${row.content}`;
        })
        .join('\n');
}

export async function refreshCaseMemoryForChat(input: RefreshCaseMemoryInput) {
    const chat = await loadChatResolutionContext(input.chatId);
    if (!chat) {
        return;
    }

    if (chat.workspace_id !== input.workspaceId) {
        console.warn(
            `[CASE_MEMORY] Skipping chat ${input.chatId}. Workspace mismatch ${chat.workspace_id} != ${input.workspaceId}.`
        );
        return;
    }

    if (!input.force && chat.status !== 'encerrados') {
        await VectorStore.deleteCaseMemoryByChatId(input.chatId);
        return;
    }

    if (!input.force && input.closedAt && chat.closed_at && chat.closed_at !== input.closedAt) {
        console.log(
            `[CASE_MEMORY] Skipping stale refresh for chat ${input.chatId}. payload=${input.closedAt} current=${chat.closed_at}`
        );
        return;
    }

    const transcript = await loadTranscript(input.chatId);
    const compactTranscript = normalizeText(transcript);

    if (!compactTranscript || compactTranscript.length < 80) {
        await VectorStore.deleteCaseMemoryByChatId(input.chatId);
        return;
    }

    const aiContext = await resolveWorkspaceAiExecutionContext(chat.workspace_id, chat.autopilot_config_id);
    const caseSummary = await summarizeCaseMemory({
        workspaceId: chat.workspace_id,
        chatHistory: transcript,
        closeReasonLabel: chat.close_reason_label || undefined,
        closeNotes: chat.close_notes || undefined,
        contactName: chat.contact_name || undefined,
        channel: chat.source || undefined,
        model: aiContext.workspaceGeminiModel,
        apiKey: aiContext.workspaceGeminiApiKey || aiContext.autopilotConfig?.gemini_api_key || undefined,
        autopilotConfigId: aiContext.autopilotConfig?.id || undefined,
    });

    const summary = normalizeText(caseSummary.summary);
    const problem = normalizeText(caseSummary.problem);
    const resolution = normalizeText(caseSummary.resolution);
    const outcome = normalizeText(caseSummary.outcome);
    const keywords = (caseSummary.keywords || []).map((keyword) => normalizeText(keyword)).filter(Boolean);

    if (!caseSummary.shouldStore || !summary || !resolution) {
        await VectorStore.deleteCaseMemoryByChatId(input.chatId);
        return;
    }

    const searchableContent = buildSearchableContent({
        summary,
        problem,
        resolution,
        outcome,
        closeReasonLabel: chat.close_reason_label,
        keywords,
    });

    const vector = await generateDocumentPassageEmbedding(searchableContent);
    if (vector.length === 0) {
        return;
    }

    await VectorStore.upsertCaseMemory({
        chatId: input.chatId,
        workspaceId: chat.workspace_id,
        contactId: chat.contact_id,
        autopilotConfigId: chat.autopilot_config_id,
        summary,
        problem: problem || null,
        resolution: resolution || null,
        outcome: outcome || null,
        closeReasonTagId: chat.close_reason_tag_id,
        closeReasonLabel: chat.close_reason_label,
        keywords,
        searchableContent,
        vector,
        metadata: {
            source: chat.source,
            closedAt: chat.closed_at,
            closeReasonLabel: chat.close_reason_label,
            embeddingModel: DOCUMENT_EMBEDDING_MODEL,
            embeddingDimensions: DOCUMENT_EMBEDDING_DIMENSIONS,
        },
    });

    console.log(`[CASE_MEMORY] Refreshed case memory for chat ${input.chatId}.`);
}
