
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { fetchEvolutionAPI } from '@/actions/evolution-api';
import { createClient } from '@/lib/supabase/server';
import { cookies } from 'next/headers';

interface MarkAsReadPayload {
    messageIds: string[];
    instanceName?: string;
    messagesToMark?: {
        remoteJid: string;
        fromMe: boolean;
        id: string;
    }[];
}

export async function POST(request: Request) {
    const cookieStore = cookies();
    const supabase = createClient(cookieStore);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    try {
        const body: MarkAsReadPayload = await request.json();
        const { messageIds, instanceName, messagesToMark } = body;

        if (!messageIds || messageIds.length === 0) {
            return NextResponse.json({ error: 'Message IDs are required.' }, { status: 400 });
        }

        // --- 1. Primary Action: Update our database ---
        // This is the most critical part.
        await db.query(
            'UPDATE messages SET is_read = TRUE WHERE id = ANY($1::uuid[])',
            [messageIds]
        );
        console.log(`[MARK_AS_READ_API] ${messageIds.length} messages marked as read in the database.`);

        // --- 2. Secondary Action: Send read receipt to WhatsApp API ---
        // This is "fire and forget". We don't block the response for this.
        // It's a nice-to-have for the user on the other end.
        if (instanceName && messagesToMark && messagesToMark.length > 0) {
            sendReceiptToWhatsApp(instanceName, messagesToMark).catch(error => {
                // We only log the error, we don't fail the request because of it.
                console.error(`[MARK_AS_READ_API] Non-critical error sending WhatsApp read receipt for instance ${instanceName}:`, error.message);
            });
        }
        
        return NextResponse.json({ success: true });

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
    messagesToMark: { remoteJid: string; fromMe: boolean; id: string }[]
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
