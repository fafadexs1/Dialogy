
'use server';

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { sendAutomatedMessageAction, sendAutomatedMediaAction } from '@/actions/messages';

interface MediaFilePayload {
    base64: string;
    mimetype: string;
    filename: string;
    mediatype: 'image' | 'video' | 'document' | 'audio';
}

interface AgentMessagePayload {
  chatId?: string;
  phoneNumber?: string; // JID format, e.g., 5511999998888@s.whatsapp.net
  content?: string; // Caption for media, or content for text
  media?: MediaFilePayload[];
}

/**
 * Finds or creates a chat ID based on a phone number for a given workspace.
 * @param phoneNumber The JID of the contact.
 * @param workspaceId The ID of the workspace.
 * @returns The ID of an active or newly created chat.
 * @throws An error if the contact is not found or a chat cannot be created.
 */
async function findOrCreateChatByPhoneNumber(phoneNumber: string, workspaceId: string): Promise<string> {
    const client = await db.connect();
    try {
        // 1. Find the contact by phone number in the specified workspace
        const contactRes = await client.query(
            'SELECT id FROM contacts WHERE phone_number_jid = $1 AND workspace_id = $2',
            [phoneNumber, workspaceId]
        );

        if (contactRes.rowCount === 0) {
            throw new Error(`Contact with phone number ${phoneNumber} not found in this workspace.`);
        }
        const contactId = contactRes.rows[0].id;

        // 2. Look for an existing active chat with this contact
        const chatRes = await client.query(
            `SELECT id FROM chats WHERE contact_id = $1 AND workspace_id = $2 AND status IN ('gerais', 'atendimentos') LIMIT 1`,
            [contactId, workspaceId]
        );
        
        if (chatRes.rowCount > 0) {
            return chatRes.rows[0].id;
        }

        // 3. If no active chat, create a new one
        console.log(`[AGENT_API] No active chat found for ${phoneNumber}. Creating a new one.`);
        const newChatRes = await client.query(
            `INSERT INTO chats (workspace_id, contact_id, status) VALUES ($1, $2, 'gerais'::chat_status_enum) RETURNING id`,
            [workspaceId, contactId]
        );

        if (newChatRes.rowCount === 0) {
            throw new Error(`Failed to create a new chat for contact ${contactId}.`);
        }
        
        return newChatRes.rows[0].id;

    } finally {
        client.release();
    }
}


export async function POST(request: Request) {
  const token = request.headers.get('Authorization')?.replace('Bearer ', '');

  if (!token) {
    return NextResponse.json({ error: 'Authorization token is required.' }, { status: 401 });
  }

  try {
    const agentRes = await db.query('SELECT * FROM system_agents WHERE token = $1', [token]);
    if (agentRes.rowCount === 0) {
      return NextResponse.json({ error: 'Invalid token.' }, { status: 403 });
    }
    const agent = agentRes.rows[0];

    if (!agent.is_active) {
       return NextResponse.json({ error: 'Agent is not active.' }, { status: 403 });
    }
    
    const body: AgentMessagePayload = await request.json();
    let { chatId, phoneNumber, content = '', media } = body;

    if (!chatId && !phoneNumber) {
      return NextResponse.json({ error: 'Either chatId or phoneNumber is required.' }, { status: 400 });
    }

    if (!content && (!media || media.length === 0)) {
       return NextResponse.json({ error: 'Either content or media must be provided.' }, { status: 400 });
    }

    // If phoneNumber is provided and chatId is not, find or create the chat
    if (phoneNumber && !chatId) {
        chatId = await findOrCreateChatByPhoneNumber(phoneNumber, agent.workspace_id);
    }
    
    if(!chatId) {
        // This should theoretically not be reached if the above logic is correct
        return NextResponse.json({ error: 'Could not determine the target chat.' }, { status: 400 });
    }
    
    let result: { success: boolean; error?: string };

    // If media is present, send it. Content will be used as caption.
    if (media && media.length > 0) {
        result = await sendAutomatedMediaAction(chatId, content, media, agent.id);
    } 
    // Otherwise, send a text message.
    else {
        result = await sendAutomatedMessageAction(chatId, content, agent.id, true);
    }


    if (result.success) {
      return NextResponse.json({ success: true, message: 'Message sent successfully.' });
    } else {
      return NextResponse.json({ success: false, error: result.error || 'Failed to send message.' }, { status: 500 });
    }
    
  } catch (error: any) {
    console.error('[AGENT_MESSAGE_API] Error:', error);
    if (error instanceof SyntaxError) {
        return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 });
    }
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
