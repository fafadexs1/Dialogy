
'use server';

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { revalidatePath } from 'next/cache';
import type { Chat } from '@/lib/types';

interface TagsPayload {
  tagId: string | null;
}

/**
 * Common function to authenticate the agent and validate the chat.
 */
async function authenticateAndValidate(request: Request, chatId: string) {
    const token = request.headers.get('Authorization')?.replace('Bearer ', '');
    if (!token) {
        return { error: 'Authorization token is required.', status: 401, agent: null, chat: null };
    }

    const agentRes = await db.query('SELECT * FROM system_agents WHERE token = $1', [token]);
    if (agentRes.rowCount === 0) {
        return { error: 'Invalid token.', status: 403, agent: null, chat: null };
    }
    const agent = agentRes.rows[0];

    if (!agent.is_active) {
        return { error: 'Agent is not active.', status: 403, agent: null, chat: null };
    }

    const chatRes = await db.query('SELECT * FROM chats WHERE id = $1', [chatId]);
    if (chatRes.rowCount === 0) {
        return { error: 'Chat not found.', status: 404, agent: null, chat: null };
    }
    const chat = chatRes.rows[0] as Chat;

    if (agent.workspace_id !== chat.workspace_id) {
        return { error: 'Agent and chat do not belong to the same workspace.', status: 403, agent: null, chat: null };
    }

    return { error: null, status: 200, agent, chat };
}


/**
 * POST method to add or update a tag on a chat.
 */
export async function POST(
    request: Request,
    { params }: { params: { chatId: string } }
) {
    const { chatId } = params;
    
    const authResult = await authenticateAndValidate(request, chatId);
    if (authResult.error || !authResult.agent || !authResult.chat) {
        return NextResponse.json({ error: authResult.error }, { status: authResult.status });
    }
    const { agent, chat } = authResult;

    try {
        const body: TagsPayload = await request.json();
        const { tagId } = body;
        
        let tagLabel: string | null = null;
        let tagColor: string | null = null;

        if (tagId) {
            // Check if the tag exists and belongs to the same workspace
            const tagRes = await db.query('SELECT label, color FROM tags WHERE id = $1 AND workspace_id = $2', [tagId, agent.workspace_id]);
            if (tagRes.rowCount === 0) {
                return NextResponse.json({ error: 'Tag not found or does not belong to this workspace.' }, { status: 400 });
            }
            tagLabel = tagRes.rows[0].label;
            tagColor = tagRes.rows[0].color;
        }

        // Update the chat with the new tag info, or clear it if tagId is null
        await db.query(
            'UPDATE chats SET tag = $1, color = $2 WHERE id = $3',
            [tagLabel, tagColor, chatId]
        );

        revalidatePath('/', 'layout'); // Revalidate the main layout to update chat list
        return NextResponse.json({ success: true, message: 'Chat tag updated successfully.' });

    } catch (error: any) {
        console.error('[AGENT_CHAT_TAGS_API_POST] Error:', error);
        if (error instanceof SyntaxError) {
            return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 });
        }
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}


/**
 * GET method to retrieve the current tag of a chat.
 */
export async function GET(
    request: Request,
    { params }: { params: { chatId: string } }
) {
    const { chatId } = params;

    const authResult = await authenticateAndValidate(request, chatId);
    if (authResult.error || !authResult.chat) {
        return NextResponse.json({ error: authResult.error }, { status: authResult.status });
    }
    const { chat } = authResult;
    
    return NextResponse.json({
        chatId: chat.id,
        tag: chat.tag,
        color: chat.color
    });
}
