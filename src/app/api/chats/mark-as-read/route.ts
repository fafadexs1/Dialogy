
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { fetchEvolutionAPI } from '@/actions/evolution-api';
import { createClient } from '@/lib/supabase/server';
import type { Message } from '@/lib/types';
import { revalidatePath } from 'next/cache';

interface MarkAsReadPayload {
    chatId: string;
}

export async function POST(request: Request) {
    const supabase = createClient();
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
            
            // 1. Find all unread messages for this chat
            const unreadMessagesRes = await client.query(
                `SELECT id, message_id_from_api, from_me FROM messages WHERE chat_id = $1 AND from_me = FALSE AND is_read = FALSE`,
                [chatId]
            );
            const unreadMessages: Pick<Message, 'id' | 'message_id_from_api' | 'from_me'>[] = unreadMessagesRes.rows;
            
            if (unreadMessages.length === 0) {
                 await client.query('ROLLBACK');
                 return NextResponse.json({ success: true, message: 'No unread messages.' });
            }

            const messageIdsToUpdate = unreadMessages.map(m => m.id);

            // 2. Primary Action: Update our database
            await client.query(
                'UPDATE messages SET is_read = TRUE WHERE id::text = ANY($1::text[])',
                [messageIdsToUpdate]
            );
            console.log(`[MARK_AS_READ_API] ${messageIdsToUpdate.length} messages marked as read in the database for chat ${chatId}.`);
            
            // 3. Secondary Action (Fire and Forget): Send read receipt to WhatsApp API
            const chatInfoRes = await client.query(
                 `SELECT ct.phone_number_jid as "remoteJid", m.instance_name 
                 FROM chats c 
                 JOIN contacts ct on c.contact_id = ct.id 
                 JOIN messages m on c.id = m.chat_id
                 WHERE c.id = $1 
                 AND m.instance_name IS NOT NULL
                 ORDER BY m.created_at DESC
                 LIMIT 1`,
                 [chatId]
            );

            if (chatInfoRes.rowCount > 0) {
                 const { instance_name: instanceName, remoteJid } = chatInfoRes.rows[0];
                 const messagesToMarkForApi = unreadMessages
                    .map(m => ({ id: m.message_id_from_api, remoteJid, fromMe: false }))
                    .filter(m => m.id);

                if (instanceName && remoteJid && messagesToMarkForApi.length > 0) {
                     sendReceiptToWhatsApp(instanceName, messagesToMarkForApi).catch(error => {
                        console.error(`[MARK_AS_READ_API] Non-critical error sending WhatsApp read receipt for instance ${instanceName}:`, error.message);
                    });
                }
            }

            await client.query('COMMIT');
            
            // Revalidate the main path to trigger data refetch on the client.
            revalidatePath('/', 'layout');

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
    messagesToMark: { remoteJid: string; fromMe: boolean; id: string | undefined }[]
): Promise<void> {
    
    // Find the API config for the given instance
    const instanceRes = await db.query(`
        SELECT c.api_url, c.api_key 
        FROM evolution_api_instances i
        JOIN evolution_api_configs c ON i.config_id = c.id
        WHERE i.name = $1
    `, [instanceName]);

    if (instanceRes.rowCount === 0) {
        console.warn(`[MARK_AS_READ_API] API config not found for instance ${instanceName}. Cannot send read receipt.`);
        return;
    }
    
    const { api_url, api_key } = instanceRes.rows[0];
    const apiConfig = { api_url, api_key };
    
    if (!apiConfig.api_url || !apiConfig.api_key) {
      console.warn(`[MARK_AS_READ_API] API config incomplete for instance ${instanceName}.`);
      return;
    }

    const payload = {
        read: {
            remoteJid: messagesToMark[0].remoteJid,
            fromMe: messagesToMark[0].fromMe,
            id: messagesToMark.map(m => m.id),
        }
    };
    
    await fetchEvolutionAPI(`/chat/sendRead/${instanceName}`, apiConfig, {
        method: 'POST',
        body: JSON.stringify(payload),
    });
    console.log(`[MARK_AS_READ_API] Read receipt sent to WhatsApp API successfully for instance ${instanceName}.`);
}
