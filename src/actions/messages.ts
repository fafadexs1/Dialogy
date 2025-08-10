
'use server';

import { db } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { revalidatePath } from 'next/cache';
import { fetchEvolutionAPI } from './evolution-api'; // Assuming fetchEvolutionAPI is exported and accepts the endpoint as a full URL path

export async function sendMessageAction(
    prevState: any,
    formData: FormData,
): Promise<{ success: boolean; error?: string }> {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
        return { success: false, error: 'Usuário não autenticado.' };
    }
    const currentUserId = session.user.id;

    const content = formData.get('content') as string;
    const chatId = formData.get('chatId') as string;

    if (!content || !chatId) {
        return { success: false, error: 'Conteúdo e ID do chat são obrigatórios.' };
    }

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        // 1. Get chat, contact, instance, and API config info
        const chatInfoRes = await client.query(
            `SELECT
                c.workspace_id,
                ct.phone_number_jid as "remoteJid",
                (SELECT lm.instance_name FROM messages lm WHERE lm.chat_id = c.id ORDER BY lm.created_at DESC LIMIT 1) as "instanceName"
             FROM chats c
             JOIN contacts ct ON c.contact_id = ct.id
             WHERE c.id = $1`,
            [chatId]
        );

        if (chatInfoRes.rowCount === 0) {
            throw new Error('Chat não encontrado.');
        }

        const { workspace_id, remoteJid, instanceName } = chatInfoRes.rows[0];

        if (!remoteJid || !instanceName) {
            throw new Error('Não foi possível encontrar o número de destino ou a instância para este chat.');
        }

        const apiConfigRes = await client.query('SELECT api_url, api_key FROM evolution_api_configs WHERE workspace_id = $1', [workspace_id]);

        if (apiConfigRes.rowCount === 0) {
            throw new Error('Configuração da Evolution API não encontrada para este workspace.');
        }
        const apiConfig = apiConfigRes.rows[0];

        // 2. Send message via Evolution API
        const apiResponse = await fetchEvolutionAPI(
            `/message/sendText/${instanceName}`,
            apiConfig,
            {
                method: 'POST',
                body: JSON.stringify({
                    number: remoteJid,
                    text: content,
                }),
            }
        );

        // 3. Save the message to our database
        await client.query(
            `INSERT INTO messages (
                workspace_id,
                chat_id,
                sender_id,
                type,
                content,
                from_me,
                message_id_from_api,
                api_message_status
             ) VALUES ($1, $2, $3, 'text', $4, true, $5, 'SENT')`,
            [workspace_id, chatId, currentUserId, content, apiResponse?.key?.id]
        );

        await client.query('COMMIT');
        
        revalidatePath(`/api/chats/${workspace_id}`);
        revalidatePath('/', 'layout');

        return { success: true };

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('[SEND_MESSAGE_ACTION] Erro:', error);
        const errorMessage = error instanceof Error ? error.message : "Ocorreu um erro desconhecido.";
        return { success: false, error: `Falha ao enviar mensagem: ${errorMessage}` };
    } finally {
        client.release();
    }
}

    