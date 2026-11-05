import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { sendAgentTemplateAction } from '@/actions/messages';

interface TemplatePayload {
    numberid: string;
    instanceName: string;
    name: string;
    language: string;
    components: unknown;
    renderedContent?: string;
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

        const body: TemplatePayload = await request.json();
        const { numberid, instanceName, name, language, components, renderedContent } = body;

        if (!numberid || !instanceName || !name || !language) {
            return NextResponse.json({ error: 'Missing required fields: numberid, instanceName, name, language.' }, { status: 400 });
        }

        const metadata = agent.type === 'marketing' ? {
            isMarketing: true,
            hideFromChatlist: agent.hide_from_chatlist ?? false,
            marketingTargetSystemAgentId: agent.handoff_system_agent_id || null,
        } : {};

        // The action records invalid components as a failed attempt in the conversation.
        const result = await sendAgentTemplateAction({
            agentId: agent.id,
            workspaceId: agent.workspace_id,
            numberid,
            instanceName,
            name,
            language,
            components,
            renderedContent,
            metadata
        });

        if (result.success) {
            return NextResponse.json({ success: true, message: 'Template sent successfully.', apiResponse: result.apiResponse });
        } else {
            return NextResponse.json(
                { success: false, error: result.error || 'Failed to send template.' },
                { status: result.statusCode ?? 500 }
            );
        }

    } catch (error: any) {
        console.error('[AGENT_TEMPLATE_API] Error:', error);
        if (error instanceof SyntaxError) {
            return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 });
        }
        return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
    }
}
