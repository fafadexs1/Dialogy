
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
  chatId: string;
  content?: string; // Caption for media, or content for text
  media?: MediaFilePayload[];
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
    const { chatId, content = '', media } = body;

    if (!chatId) {
      return NextResponse.json({ error: 'chatId is required.' }, { status: 400 });
    }

    if (!content && (!media || media.length === 0)) {
       return NextResponse.json({ error: 'Either content or media must be provided.' }, { status: 400 });
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
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
