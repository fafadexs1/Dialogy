
'use server';

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { revalidatePath } from 'next/cache';

interface TagsPayload {
  tagIds: string[];
}

/**
 * Common function to authenticate the agent and validate the contact.
 */
async function authenticateAndValidate(request: Request, contactId: string) {
    const token = request.headers.get('Authorization')?.replace('Bearer ', '');
    if (!token) {
        return { error: 'Authorization token is required.', status: 401, agent: null, contact: null };
    }

    const agentRes = await db.query('SELECT * FROM system_agents WHERE token = $1', [token]);
    if (agentRes.rowCount === 0) {
        return { error: 'Invalid token.', status: 403, agent: null, contact: null };
    }
    const agent = agentRes.rows[0];

    if (!agent.is_active) {
        return { error: 'Agent is not active.', status: 403, agent: null, contact: null };
    }

    const contactRes = await db.query('SELECT * FROM contacts WHERE id = $1', [contactId]);
    if (contactRes.rowCount === 0) {
        return { error: 'Contact not found.', status: 404, agent: null, contact: null };
    }
    const contact = contactRes.rows[0];

    if (agent.workspace_id !== contact.workspace_id) {
        return { error: 'Agent and contact do not belong to the same workspace.', status: 403, agent: null, contact: null };
    }

    return { error: null, status: 200, agent, contact };
}


/**
 * POST method to add one or more tags to a contact.
 */
export async function POST(
    request: Request,
    { params }: { params: { contactId: string } }
) {
    const { contactId } = params;
    
    const authResult = await authenticateAndValidate(request, contactId);
    if (authResult.error) {
        return NextResponse.json({ error: authResult.error }, { status: authResult.status });
    }
    const { agent } = authResult;

    try {
        const body: TagsPayload = await request.json();
        const { tagIds } = body;

        if (!Array.isArray(tagIds) || tagIds.length === 0) {
            return NextResponse.json({ error: 'tagIds must be a non-empty array.' }, { status: 400 });
        }
        
        // Check if all tags exist and belong to the same workspace
        const tagsRes = await db.query('SELECT id FROM tags WHERE id = ANY($1::uuid[]) AND workspace_id = $2', [tagIds, agent.workspace_id]);
        if (tagsRes.rowCount !== tagIds.length) {
            return NextResponse.json({ error: 'One or more tags not found or do not belong to this workspace.' }, { status: 400 });
        }

        const values = tagIds.map(tagId => `('${contactId}', '${tagId}')`).join(',');
        await db.query(`INSERT INTO contact_tags (contact_id, tag_id) VALUES ${values} ON CONFLICT (contact_id, tag_id) DO NOTHING`);

        revalidatePath('/crm');
        revalidatePath(`/api/chats/${agent.workspace_id}`);
        return NextResponse.json({ success: true, message: 'Tags added successfully.' });

    } catch (error: any) {
        console.error('[AGENT_TAGS_API_POST] Error:', error);
        if (error instanceof SyntaxError) {
            return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 });
        }
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}


/**
 * DELETE method to remove one or more tags from a contact.
 */
export async function DELETE(
    request: Request,
    { params }: { params: { contactId: string } }
) {
    const { contactId } = params;

    const authResult = await authenticateAndValidate(request, contactId);
    if (authResult.error) {
        return NextResponse.json({ error: authResult.error }, { status: authResult.status });
    }
    const { agent } = authResult;

    try {
        const body: TagsPayload = await request.json();
        const { tagIds } = body;

        if (!Array.isArray(tagIds) || tagIds.length === 0) {
            return NextResponse.json({ error: 'tagIds must be a non-empty array.' }, { status: 400 });
        }

        await db.query('DELETE FROM contact_tags WHERE contact_id = $1 AND tag_id = ANY($2::uuid[])', [contactId, tagIds]);

        revalidatePath('/crm');
        revalidatePath(`/api/chats/${agent.workspace_id}`);
        return NextResponse.json({ success: true, message: 'Tags removed successfully.' });

    } catch (error: any) {
        console.error('[AGENT_TAGS_API_DELETE] Error:', error);
        if (error instanceof SyntaxError) {
            return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 });
        }
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
