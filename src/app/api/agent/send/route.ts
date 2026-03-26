import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { sendAutomatedMessageAction, sendAutomatedMediaAction, sendAgentTemplateAction, sendAgentListAction } from '@/actions/messages';
import { isSGPPayload, adaptSGPPayload, normalizeAgentListPayload, AgentSendPayload } from '@/lib/sgp-payloads';
import { randomUUID } from 'crypto';
import { buildChatProtocol } from '@/lib/utils';

interface MediaFilePayload {
    base64: string;
    mimetype: string;
    filename: string;
    mediatype: 'image' | 'video' | 'document' | 'audio';
}



/**
 * Finds or creates a chat ID based on a phone number for a given workspace.
 */
async function findOrCreateChatByPhoneNumber(phoneNumber: string, workspaceId: string): Promise<string> {
    const client = await db.connect();
    try {
        const fullJid = phoneNumber.includes('@') ? phoneNumber : `${phoneNumber}@s.whatsapp.net`;
        const rawDigits = phoneNumber.replace(/\D/g, '') || phoneNumber;

        // 1. Find or create the contact
        let contactRes = await client.query(
            'SELECT id FROM contacts WHERE phone_number_jid = $1 AND workspace_id = $2',
            [fullJid, workspaceId]
        );

        if (contactRes.rowCount === 0) {
            contactRes = await client.query(
                `INSERT INTO contacts (workspace_id, name, phone, phone_number_jid)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
                [workspaceId, rawDigits, rawDigits, fullJid]
            );
        }
        const contactId = contactRes.rows[0].id;

        // 2. Look for an existing active chat
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

        // 4. Create new chat
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
    const bodyText = await request.text();
    let body: any;
    try {
        body = JSON.parse(bodyText);
    } catch (e) {
        return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 });
    }

    let token = request.headers.get('Authorization')?.replace('Bearer ', '');

    if (!token) {
        const { searchParams } = new URL(request.url);
        token = searchParams.get('token') || undefined;
    }

    // Check if token is in the body (SGP style)
    if (!token && body && body.token) {
        token = body.token;
    }

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

        let payload: AgentSendPayload;

        if (isSGPPayload(body)) {
            payload = adaptSGPPayload(body);
        } else {
            payload = body;
        }

        const { type = 'text', phoneNumber, instance, chatId: providedChatId } = payload;
        const listPayload = normalizeAgentListPayload({
            ...body,
            ...payload,
            list: payload.list ?? body.list,
        });

        // Common Metadata
        const isMarketing = agent.type === 'marketing';
        const metadata = isMarketing
            ? {
                isMarketing: true,
                hideFromChatlist: agent.hide_from_chatlist ?? false,
                marketingTargetSystemAgentId: agent.handoff_system_agent_id || null,
            }
            : {};

        // --- TEMPLATE FLOW ---
        if (type === 'template') {
            if (!body.template) {
                return NextResponse.json({ error: 'Template object is required for type "template".' }, { status: 400 });
            }
            if (!phoneNumber) {
                return NextResponse.json({ error: 'phoneNumber is required for sending templates.' }, { status: 400 });
            }
            if (!instance) {
                return NextResponse.json({ error: 'instance is required for sending templates.' }, { status: 400 });
            }

            const result = await sendAgentTemplateAction({
                agentId: agent.id,
                workspaceId: agent.workspace_id,
                numberid: phoneNumber,
                instanceName: instance,
                name: body.template.name,
                language: body.template.language,
                components: body.template.components,
                metadata
            });

            if (result.success) {
                return NextResponse.json({ success: true, message: 'Template sent successfully.', apiResponse: result.apiResponse });
            } else {
                return NextResponse.json({ success: false, error: result.error || 'Failed to send template.' }, { status: 500 });
            }
        }
        else if (type === 'list') {
            if (!listPayload) {
                return NextResponse.json({ error: 'List payload is required for type "list".' }, { status: 400 });
            }
            if (!providedChatId && !phoneNumber) {
                return NextResponse.json({ error: 'Either chatId or phoneNumber is required for sending lists.' }, { status: 400 });
            }
            if (!instance) {
                return NextResponse.json({ error: 'instance is required for sending lists.' }, { status: 400 });
            }

            const result = await sendAgentListAction({
                agentId: agent.id,
                workspaceId: agent.workspace_id,
                instanceName: instance,
                chatId: providedChatId,
                numberid: phoneNumber,
                list: listPayload,
                metadata,
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

        // --- TEXT / MEDIA FLOW ---
        else {
            let chatId = providedChatId;
            if (!chatId && phoneNumber) {
                chatId = await findOrCreateChatByPhoneNumber(phoneNumber, agent.workspace_id);
            }

            if (!chatId) {
                return NextResponse.json({ error: 'Either chatId or phoneNumber is required.' }, { status: 400 });
            }

            const content = body.content || '';
            const media = body.media;

            if (!content && (!media || media.length === 0)) {
                return NextResponse.json({ error: 'Either content or media must be provided.' }, { status: 400 });
            }

            let result: { success: boolean; error?: string };

            if (media && media.length > 0) {
                result = await sendAutomatedMediaAction(chatId, content, media, agent.id, instance, metadata as any);
            } else {
                result = await sendAutomatedMessageAction(chatId, content, agent.id, true, instance, metadata as any);
            }

            if (result.success) {
                return NextResponse.json({ success: true, message: 'Message sent successfully.' });
            } else {
                return NextResponse.json({ success: false, error: result.error || 'Failed to send message.' }, { status: 500 });
            }
        }

    } catch (error: any) {
        console.error('[AGENT_SEND_API] Error:', error);
        if (error instanceof SyntaxError) {
            return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 });
        }
        return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
    }
}
