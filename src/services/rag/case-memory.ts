import { db } from '@/lib/db';
import { DOCUMENT_EMBEDDING_DIMENSIONS, DOCUMENT_EMBEDDING_MODEL, generateDocumentPassageEmbedding } from '@/lib/embeddings';
import { VectorStore } from '@/lib/vector-store';
import { summarizeCaseMemory } from '@/ai/flows/case-memory-summarization';
import { resolveWorkspaceAiExecutionContext } from '@/services/ai/runtime';
import { loadCaseMemoryTranscript } from './case-transcript';

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
    autopilot_config_id: string | null;
    close_reason_tag_id: string | null;
    close_reason_label: string | null;
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

async function loadChatResolutionContext(workspaceId: string, chatId: string): Promise<ChatResolutionContext | null> {
    const { rows } = await db.query(
        `SELECT
            c.id,
            c.workspace_id,
            c.contact_id,
            c.autopilot_config_id,
            c.close_reason_tag_id,
            t.label AS close_reason_label,
            c.status,
            c.closed_at,
            c.source
         FROM chats c
         LEFT JOIN tags t ON t.id = c.close_reason_tag_id AND t.workspace_id = c.workspace_id
         WHERE c.id = $1 AND c.workspace_id = $2
         LIMIT 1`,
        [chatId, workspaceId]
    );

    return rows[0] ?? null;
}

export async function refreshCaseMemoryForChat(input: RefreshCaseMemoryInput) {
    const chat = await loadChatResolutionContext(input.workspaceId, input.chatId);
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

    const transcript = await loadCaseMemoryTranscript(input.workspaceId, input.chatId);
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
        channel: chat.source || undefined,
        model: aiContext.model,
        apiKey: aiContext.workspaceGeminiApiKey,
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
