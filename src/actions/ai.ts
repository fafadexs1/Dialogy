'use server';

import { db } from '@/lib/db';
import { getCurrentUser } from './user';
import { generateSummary } from '@/lib/genkit';

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

        // 2. Get Config from workspace_integrations
        const configRes = await db.query(`
            SELECT config->>'apiKey' as api_key 
            FROM workspace_integrations 
            WHERE workspace_id = $1 AND provider = 'gemini' AND is_active = true 
            LIMIT 1
        `, [workspaceId]);

        const apiKey = configRes.rows[0]?.api_key;

        // Reverse to chronological order
        const recentMessages = messagesRes.rows.reverse();

        // Format for AI
        const conversationText = recentMessages.map((m: any) => {
            const sender = m.from_me ? 'Atendente' : 'Cliente';
            const text = m.type === 'text' ? m.content : `[Mídia: ${m.type}]`;
            return `${sender}: ${text}`;
        }).join('\n');

        const summaryText = await generateSummary(conversationText, apiKey);

        return { success: true, summary: summaryText };

    } catch (error) {
        console.error('[GENERATE_SUMMARY] AI Error:', error);
        return { success: false, error: 'Falha ao gerar resumo via IA.' };
    }
}
