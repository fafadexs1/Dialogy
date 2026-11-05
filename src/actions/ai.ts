'use server';

import { db } from '@/lib/db';
import { getCurrentUser } from './user';
import { generateSummary } from '@/lib/genkit';
import { getWorkspaceAiRuntimeConfig } from '@/actions/autopilot';

export async function generateChatSummaryAction(chatId: string) {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
        return { success: false, error: 'Usuário não autenticado.' };
    }

    try {
        // Fetch 50 recent messages from the current chat session
        const messagesRes = await db.query(`
            SELECT 
                content, 
                type, 
                sender_user_id,
                created_at,
                from_me
            FROM messages 
            WHERE chat_id = $1 
            ORDER BY created_at DESC 
            LIMIT 50
        `, [chatId]);

        if (messagesRes.rows.length === 0) {
            return { success: false, error: 'Nenhuma mensagem para resumir.' };
        }

        // Fetch API Key from Autopilot Config
        // 1. Get Workspace ID
        const chatRes = await db.query('SELECT workspace_id FROM chats WHERE id = $1', [chatId]);
        const workspaceId = chatRes.rows[0]?.workspace_id;

        if (!workspaceId) {
            return { success: false, error: 'Workspace não encontrado.' };
        }

        // 2. Get Config (Try to find any valid AI config for this workspace)
        const runtimeConfig = await getWorkspaceAiRuntimeConfig(workspaceId);

        if (runtimeConfig.error) {
            return { success: false, error: runtimeConfig.error };
        }

        // Prioritize: workspace key -> global env key (handled downstream if apiKey is undefined)
        const apiKey = runtimeConfig.apiKey;
        const aiModel = runtimeConfig.aiModel;

        // Note: genkit.ts handles undefined apiKey by falling back to env var if initialized there.
        // But if strict mode, we might want to check.
        if (!apiKey && !runtimeConfig.hasGlobalKey) {
            return { success: false, error: 'Chave de API do Gemini não configurada (Integração ou Agente IA).' };
        }

        // Reverse to chronological order
        const recentMessages = messagesRes.rows.reverse();

        // Format for AI
        const conversationText = recentMessages.map((m: any) => {
            const sender = m.from_me ? 'Atendente' : 'Cliente';
            const text = m.type === 'text' ? m.content : `[Mídia: ${m.type}]`;
            return `${sender}: ${text}`;
        }).join('\n');

        const summaryText = await generateSummary(conversationText, undefined, undefined, workspaceId);

        return { success: true, summary: summaryText };

    } catch (error) {
        console.error('[GENERATE_SUMMARY] AI Error:', error);
        return { success: false, error: 'Falha ao gerar resumo via IA.' };
    }
}
