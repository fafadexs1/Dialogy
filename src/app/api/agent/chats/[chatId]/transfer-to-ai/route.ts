'use server';

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { transferChatToIntelligentAgentAction } from '@/actions/chats';

type TransferToAiPayload = {
  systemAgentId?: string;
};

async function authenticateSystemAgent(request: Request) {
  const token = request.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) {
    return { error: 'Authorization token is required.', status: 401, agent: null };
  }

  const agentRes = await db.query('SELECT * FROM system_agents WHERE token = $1', [token]);
  if ((agentRes.rowCount ?? 0) === 0) {
    return { error: 'Invalid token.', status: 403, agent: null };
  }

  const agent = agentRes.rows[0];
  if (!agent.is_active) {
    return { error: 'Agent is not active.', status: 403, agent: null };
  }

  return { error: null, status: 200, agent };
}

export async function POST(
  request: Request,
  props: { params: Promise<{ chatId: string }> }
) {
  const { chatId } = await props.params;
  const auth = await authenticateSystemAgent(request);

  if (auth.error || !auth.agent) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const body = await request.json() as TransferToAiPayload;
    if (!body.systemAgentId) {
      return NextResponse.json({ error: 'systemAgentId is required.' }, { status: 400 });
    }

    const result = await transferChatToIntelligentAgentAction(
      { chatId, systemAgentId: body.systemAgentId },
      {
        user: {
          id: auth.agent.id,
          name: auth.agent.name,
        },
        isSystemAgent: true,
      }
    );

    if (!result.success) {
      return NextResponse.json({ success: false, error: result.error }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      message: 'Chat transferred to intelligent attendant.',
      chat: result.chat,
    });
  } catch (error: any) {
    console.error('[TRANSFER_TO_AI_API] Error:', error);
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 });
    }
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
