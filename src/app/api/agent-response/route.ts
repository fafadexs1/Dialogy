
'use server';

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { sendAutomatedMessageAction } from '@/actions/messages';

/**
 * @deprecated Use /api/agent/messages instead. This endpoint will be removed in a future version.
 * It only supports sending text messages.
 */
interface AgentResponsePayload {
  chatId: string;
  content: string;
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
    
    const body: AgentResponsePayload = await request.json();
    const { chatId, content } = body;

    if (!chatId || !content) {
      return NextResponse.json({ error: 'chatId and content are required.' }, { status: 400 });
    }

    // We send the message using the agent's ID as the sender
    const result = await sendAutomatedMessageAction(chatId, content, agent.id, true);

    if (result.success) {
      return NextResponse.json({ success: true, message: 'Message sent successfully.' });
    } else {
      return NextResponse.json({ success: false, error: result.error || 'Failed to send message.' }, { status: 500 });
    }
    
  } catch (error: any) {
    console.error('[AGENT_RESPONSE_API] Error:', error);
    if (error instanceof SyntaxError) {
        return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 });
    }
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
