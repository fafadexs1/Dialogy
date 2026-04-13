
'use server';

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { sendAutomatedMessageAction, sendAutomatedMediaAction, sendAgentListAction } from '@/actions/messages';
import { normalizeAgentListPayload } from '@/lib/sgp-payloads';
import { randomUUID } from 'crypto';
import { buildChatProtocol } from '@/lib/utils';
import { findOrCreateWhatsappContact } from '@/lib/whatsapp/contact-identity';

interface MediaFilePayload {
  base64: string;
  mimetype: string;
  filename: string;
  mediatype: 'image' | 'video' | 'document' | 'audio';
}

interface AgentMessagePayload {
  type?: 'text' | 'list';
  chatId?: string;
  phoneNumber?: string; // JID format, e.g., 5511999998888@s.whatsapp.net
  content?: string; // Caption for media, or content for text
  media?: MediaFilePayload[];
  instance?: string; // Specific instance name (e.g., "zap1")
  list?: {
    title?: string;
    description?: string;
    buttonText: string;
    footerText?: string;
    sections: Array<{
      title: string;
      rows: Array<{
        title: string;
        description?: string;
        rowId: string;
      }>;
    }>;
  };
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
    const resolvedContact = await findOrCreateWhatsappContact(client, {
      workspaceId,
      phoneOrJid: phoneNumber,
      fallbackName: phoneNumber,
    });
    const contactId = resolvedContact.contact.id;

    // 2. Look for an existing active chat with this contact
    const chatRes = await client.query(
      `SELECT id FROM chats WHERE contact_id = $1 AND workspace_id = $2 AND status IN ('gerais', 'atendimentos') LIMIT 1`,
      [contactId, workspaceId]
    );

    if ((chatRes.rowCount ?? 0) > 0) {
      return chatRes.rows[0].id;
    }

    // 3. If there is no active chat, prefer reusing the latest closed chat.
    // This avoids resurrecting contacts into the queue due outbound system sends.
    const closedChatRes = await client.query(
      `SELECT id
       FROM chats
       WHERE contact_id = $1
         AND workspace_id = $2
         AND status = 'encerrados'
       ORDER BY closed_at DESC NULLS LAST, created_at DESC
       LIMIT 1`,
      [contactId, workspaceId]
    );

    if ((closedChatRes.rowCount ?? 0) > 0) {
      return closedChatRes.rows[0].id;
    }

    // 4. If there is no active or closed chat, create a new one.
    console.log(`[AGENT_API] No active chat found for ${phoneNumber}. Creating a new one.`);
    const chatId = randomUUID();
    const protocol = buildChatProtocol(chatId);
    const { getMonthlyChatLimitStatus } = await import('@/lib/billing-logic');
    const chatLimitStatus = await getMonthlyChatLimitStatus(workspaceId);
    if (!chatLimitStatus.allowed) {
      throw new Error(`Limite mensal de chats do plano ${chatLimitStatus.plan.toUpperCase()} atingido.`);
    }
    const newChatRes = await client.query(
      `INSERT INTO chats (id, workspace_id, contact_id, status, protocol) VALUES ($1, $2, $3, 'gerais'::chat_status_enum, $4) RETURNING id`,
      [chatId, workspaceId, contactId, protocol]
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
    let { type = 'text', chatId, phoneNumber, content = '', media, instance, list } = body;
    const listPayload = normalizeAgentListPayload({
      ...body,
      list,
    });
    const isMarketing = agent.type === 'marketing';
    const marketingMetadata = isMarketing
      ? {
          isMarketing: true,
          hideFromChatlist: agent.hide_from_chatlist ?? false,
          marketingTargetSystemAgentId: agent.handoff_system_agent_id || null,
        }
      : {};

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

    if (!chatId) {
      // This should theoretically not be reached if the above logic is correct
      return NextResponse.json({ error: 'Could not determine the target chat.' }, { status: 400 });
    }

    if (type === 'list') {
      if (!listPayload) {
        return NextResponse.json({ error: 'List payload is required for type "list".' }, { status: 400 });
      }
      if (!instance) {
        return NextResponse.json({ error: 'instance is required for sending lists.' }, { status: 400 });
      }

      const result = await sendAgentListAction({
        agentId: agent.id,
        workspaceId: agent.workspace_id,
        instanceName: instance,
        chatId,
        numberid: phoneNumber,
        list: listPayload,
        metadata: marketingMetadata as any,
      });

      if (result.success) {
        return NextResponse.json({
          success: true,
          message: 'List sent successfully.',
          chatId: result.chatId,
          apiResponse: result.apiResponse,
        });
      }

      return NextResponse.json({ success: false, error: result.error || 'Failed to send list.' }, { status: 500 });
    }

    let result: { success: boolean; error?: string };

    // If media is present, send it. Content will be used as caption.
    if (media && media.length > 0) {
      result = await sendAutomatedMediaAction(chatId, content, media, agent.id, instance, marketingMetadata as any);
    }
    // Otherwise, send a text message.
    else {
      result = await sendAutomatedMessageAction(chatId, content, agent.id, true, instance, marketingMetadata as any);
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
