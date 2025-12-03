
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { sendAutomatedMessageAction } from '@/actions/messages';

interface CloseChatPayload {
    chatId: string;
    reasonTagId?: string;
    notes?: string;
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

        const body: CloseChatPayload = await request.json();
        const { chatId, reasonTagId, notes } = body;

        if (!chatId) {
            return NextResponse.json({ error: 'chatId is required.' }, { status: 400 });
        }

        const client = await db.connect();
        let closeTemplate: string | undefined;

        try {
            await client.query('BEGIN');

            // 1. Fetch chat details
            const chatRes = await client.query(`
                SELECT 
                    workspace_id, 
                    tag as current_tag, 
                    color as current_color,
                    (
                        SELECT m.instance_name 
                        FROM messages m 
                        WHERE m.chat_id = c.id AND m.instance_name IS NOT NULL 
                        ORDER BY m.created_at DESC 
                        LIMIT 1
                    ) AS last_instance_name
                FROM chats c
                WHERE id = $1 AND workspace_id = $2
            `, [chatId, agent.workspace_id]);

            if (chatRes.rowCount === 0) {
                await client.query('ROLLBACK');
                return NextResponse.json({ error: 'Chat not found or does not belong to the agent workspace.' }, { status: 404 });
            }

            const { workspace_id, current_tag, current_color, last_instance_name } = chatRes.rows[0];

            // 2. Get Close Template
            const templateRes = await client.query(
                'SELECT close_message_template FROM workspaces WHERE id = $1',
                [workspace_id]
            );
            closeTemplate = (templateRes.rows[0]?.close_message_template as string | undefined)?.trim();

            // 3. Resolve Tag Info
            let tagInfo = { label: null as string | null, color: null as string | null };
            if (reasonTagId) {
                const tagRes = await client.query('SELECT label, color FROM tags WHERE id = $1', [reasonTagId]);
                if ((tagRes.rowCount ?? 0) > 0) {
                    tagInfo = tagRes.rows[0];
                }
            }

            // 4. Update Chat Status
            await client.query(
                `UPDATE chats
                 SET 
                    status = 'encerrados',
                    closed_at = NOW(),
                    close_reason_tag_id = $1,
                    tag = $2,
                    color = $3
                 WHERE id = $4`,
                [
                    reasonTagId,
                    tagInfo.label ?? current_tag ?? '',
                    tagInfo.color ?? current_color ?? '',
                    chatId
                ]
            );

            // 5. Update Meta Conversation Status (if applicable)
            await client.query(
                `UPDATE meta_conversations 
                 SET status = 'closed', updated_at = timezone('utc', now()) 
                 WHERE chat_id = $1`,
                [chatId]
            );

            // 6. Insert System Message
            const systemMessageContent = `Atendimento encerrado via sistema por ${agent.name}.`;

            await client.query(`
                INSERT INTO messages (workspace_id, chat_id, type, content, metadata, sender_system_agent_id)
                VALUES ($1, $2, 'system', $3, $4, $5)
            `, [
                workspace_id,
                chatId,
                systemMessageContent,
                {
                    event: 'close',
                    closed_by_system_agent_id: agent.id,
                    reason_tag_id: reasonTagId,
                    notes: notes,
                },
                agent.id
            ]);

            await client.query('COMMIT');

            // 7. Send Close Template (Outside Transaction)
            if (closeTemplate) {
                try {
                    await sendAutomatedMessageAction(chatId, closeTemplate, agent.id, true, last_instance_name || undefined, {
                        event: 'close_notice',
                        authored_by_system_agent_id: agent.id,
                        template_applied: true,
                        reason_tag_id: reasonTagId,
                    });
                } catch (templateErr) {
                    console.error('[AGENT_CLOSE_CHAT] Failed to send close template:', templateErr);
                }
            }

            return NextResponse.json({ success: true, message: 'Chat closed successfully.' });

        } catch (error: any) {
            await client.query('ROLLBACK');
            console.error('[AGENT_CLOSE_CHAT] Error:', error);
            return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
        } finally {
            client.release();
        }

    } catch (error: any) {
        console.error('[AGENT_CLOSE_CHAT] Auth Error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
