
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { fetchEvolutionAPI } from '@/lib/whatsapp/evolution-api-client';
import { createClient } from '@/lib/supabase/server';
import type { Message } from '@/lib/types';
import { getEvolutionApiConfig } from '@/lib/whatsapp/evolution-config';
import { broadcastChatUpdate } from '@/lib/realtime/chat-broadcast';

interface MarkAsReadPayload {
    chatId: string;
}

export async function POST(request: Request) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const body: MarkAsReadPayload = await request.json();
        const { chatId } = body;

        if (!chatId) {
            return NextResponse.json({ error: 'Chat ID is required.' }, { status: 400 });
        }

        const client = await db.connect();
        try {
            await client.query('BEGIN');

            const chatAccessRes = await client.query(
                `
                SELECT
                    c.workspace_id,
                    ct.phone_number_jid AS "remoteJid",
                    lci.instance_name
                FROM chats c
                LEFT JOIN contacts ct
                  ON ct.id = c.contact_id
                 AND ct.workspace_id = c.workspace_id
                LEFT JOIN LATERAL (
                    SELECT m.instance_name
                    FROM messages m
                    WHERE m.chat_id = c.id
                      AND m.instance_name IS NOT NULL
                    ORDER BY m.created_at DESC, m.id DESC
                    LIMIT 1
                ) lci ON TRUE
                JOIN user_workspace_roles uwr
                  ON uwr.workspace_id = c.workspace_id
                 AND uwr.user_id = $2
                WHERE c.id = $1
                LIMIT 1
                `,
                [chatId, user.id]
            );

            if ((chatAccessRes.rowCount ?? 0) === 0) {
                await client.query('ROLLBACK');
                return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
            }
            const {
                workspace_id: workspaceId,
                remoteJid,
                instance_name: latestInstanceName,
            } = chatAccessRes.rows[0] as {
                workspace_id: string;
                remoteJid?: string | null;
                instance_name?: string | null;
            };

            // Wait for concurrent webhook writes instead of skipping locked rows. A skipped row
            // could otherwise remain unread after the client optimistically clears its badge.
            const unreadMessagesRes = await client.query(
                `UPDATE messages
                 SET is_read = TRUE
                 WHERE chat_id = $1
                   AND from_me = FALSE
                   AND COALESCE(is_read, FALSE) = FALSE
                 RETURNING id, message_id_from_api, from_me`,
                [chatId]
            );
            const unreadMessages: Pick<Message, 'id' | 'message_id_from_api' | 'from_me'>[] = unreadMessagesRes.rows;

            if (unreadMessages.length === 0) {
                await client.query('COMMIT');
                await broadcastChatUpdate(workspaceId, chatId, {
                    unread_count: 0,
                });
                return NextResponse.json({ success: true, message: 'No unread messages.' });
            }

            const messageIdsToUpdate = unreadMessages.map(m => m.id);

            console.log(`[MARK_AS_READ_API] ${messageIdsToUpdate.length} messages marked as read in the database for chat ${chatId}.`);

            // 3. Secondary Action (Fire and Forget): Send read receipt to WhatsApp API
            if (latestInstanceName && remoteJid) {
                const messagesToMarkForApi = unreadMessages
                    .map(m => ({ id: m.message_id_from_api, remoteJid, fromMe: false }))
                    .filter(m => m.id);

                if (messagesToMarkForApi.length > 0) {
                    sendReceiptToWhatsApp(latestInstanceName, workspaceId, messagesToMarkForApi).catch(error => {
                        console.error(`[MARK_AS_READ_API] Non-critical error sending WhatsApp read receipt for instance ${latestInstanceName}:`, error.message);
                    });
                }
            }

            await client.query('COMMIT');
            await broadcastChatUpdate(workspaceId, chatId, {
                unread_count: 0,
            });

            // Revalidation removed to prevent performance issues.
            // Client updates optimistic state via store and Realtime handles sync.
            // revalidatePath('/', 'layout');

            return NextResponse.json({ success: true });
        } catch (dbError) {
            await client.query('ROLLBACK');
            throw dbError; // Rethrow to be caught by the outer catch block
        } finally {
            client.release();
        }

    } catch (error: any) {
        console.error('[MARK_AS_READ_API] Error processing request:', error);
        return NextResponse.json({ error: 'Internal Server Error', details: error.message }, { status: 500 });
    }
}


/**
 * Sends the read receipt to the Evolution API. This is a helper function.
 * It's designed to not throw errors up, just log them.
 */
async function sendReceiptToWhatsApp(
    instanceName: string,
    workspaceId: string,
    messagesToMark: { remoteJid: string; fromMe: boolean; id: string | undefined }[]
): Promise<void> {
    const apiConfig = await getEvolutionApiConfig(instanceName, { workspaceId });
    if (!apiConfig || !apiConfig.api_url || !apiConfig.api_key) {
        return;
    }

    const validMessages = messagesToMark.filter((m) => m.id && m.remoteJid);
    if (validMessages.length === 0) return;

    // Evolution API v2 standard payload format for marking messages as read
    const payload = {
        readMessages: validMessages.map((m) => ({
            id: m.id,
            fromMe: Boolean(m.fromMe),
            remoteJid: m.remoteJid,
        })),
    };

    const encodedInstance = encodeURIComponent(instanceName);

    try {
        // Standard Evolution API v2 endpoint (POST /chat/markMessageAsRead/{instance})
        await fetchEvolutionAPI(`/chat/markMessageAsRead/${encodedInstance}`, apiConfig, {
            method: 'POST',
            body: JSON.stringify(payload),
            silent: true,
        });
        return;
    } catch {
        // Fallback for Evolution API installations expecting PUT
        try {
            await fetchEvolutionAPI(`/chat/markMessageAsRead/${encodedInstance}`, apiConfig, {
                method: 'PUT',
                body: JSON.stringify(payload),
                silent: true,
            });
            return;
        } catch {
            // Ignored gracefully: instance offline, webhook-only, or unsupported by this Evolution version
        }
    }
}
