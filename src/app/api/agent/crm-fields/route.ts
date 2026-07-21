import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

const NATIVE_FIELDS = [
  { key: 'native:name', label: 'Nome', type: 'text', kind: 'native' },
  { key: 'native:email', label: 'E-mail', type: 'email', kind: 'native' },
  { key: 'native:phone_number_jid', label: 'Telefone / WhatsApp', type: 'phone', kind: 'native' },
  { key: 'native:address', label: 'Endereço', type: 'text', kind: 'native' },
] as const;

const NATIVE_COLUMNS: Record<string, string> = {
  'native:name': 'name',
  'native:email': 'email',
  'native:phone_number_jid': 'phone_number_jid',
  'native:address': 'address',
};

async function authenticate(request: Request) {
  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '').trim();
  if (!token) return { error: 'Authorization token is required.', status: 401, agent: null };

  const result = await db.query(
    `SELECT sa.id, sa.workspace_id, sa.is_active, w.name AS workspace_name
     FROM system_agents sa
     LEFT JOIN workspaces w ON w.id = sa.workspace_id
     WHERE sa.token = $1
     LIMIT 1`,
    [token]
  );
  if ((result.rowCount || 0) === 0) return { error: 'Invalid token.', status: 403, agent: null };
  if (!result.rows[0].is_active) return { error: 'Agent is not active.', status: 403, agent: null };
  return { error: null, status: 200, agent: result.rows[0] };
}

export async function GET(request: Request) {
  try {
    const auth = await authenticate(request);
    if (auth.error || !auth.agent) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const custom = await db.query(
      `SELECT id, label, type
       FROM custom_field_definitions
       WHERE workspace_id = $1
       ORDER BY label ASC`,
      [auth.agent.workspace_id]
    );

    return NextResponse.json({
      workspace: { id: auth.agent.workspace_id, name: auth.agent.workspace_name || 'Workspace Dialogy' },
      fields: [
        ...NATIVE_FIELDS,
        ...custom.rows.map(row => ({
          key: `custom:${row.id}`,
          label: row.label,
          type: row.type || 'text',
          kind: 'custom',
        })),
      ],
    });
  } catch (error) {
    console.error('[AGENT_CRM_FIELDS_GET] Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const auth = await authenticate(request);
  if (auth.error || !auth.agent) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const client = await db.connect();
  try {
    const body = await request.json();
    const chatId = String(body?.chatId || '').trim();
    const fields = Array.isArray(body?.fields) ? body.fields : [];
    if (!chatId || fields.length === 0) {
      return NextResponse.json({ error: 'chatId and a non-empty fields array are required.' }, { status: 400 });
    }

    await client.query('BEGIN');
    const contactResult = await client.query(
      `SELECT c.contact_id
       FROM chats c
       WHERE c.id = $1 AND c.workspace_id = $2
       LIMIT 1`,
      [chatId, auth.agent.workspace_id]
    );
    const contactId = contactResult.rows[0]?.contact_id;
    if (!contactId) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Chat or CRM contact not found in this workspace.' }, { status: 404 });
    }

    const updates = new Map<string, string>();
    for (const item of fields) {
      const fieldKey = String(item?.fieldKey || '').trim();
      if (fieldKey) updates.set(fieldKey, item?.value == null ? '' : String(item.value));
    }
    if (updates.size === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'No valid CRM fields were provided.' }, { status: 400 });
    }

    for (const [fieldKey, value] of updates) {
      const nativeColumn = NATIVE_COLUMNS[fieldKey];
      if (nativeColumn) {
        await client.query(
          `UPDATE contacts SET ${nativeColumn} = $1, updated_at = timezone('utc', now()) WHERE id = $2 AND workspace_id = $3`,
          [value || (nativeColumn === 'name' ? '' : null), contactId, auth.agent.workspace_id]
        );
        continue;
      }

      if (!fieldKey.startsWith('custom:')) {
        throw new Error(`Campo de CRM inválido: ${fieldKey}`);
      }
      const fieldId = fieldKey.slice('custom:'.length);
      const definition = await client.query(
        'SELECT 1 FROM custom_field_definitions WHERE id = $1 AND workspace_id = $2 LIMIT 1',
        [fieldId, auth.agent.workspace_id]
      );
      if ((definition.rowCount || 0) === 0) throw new Error(`Campo customizado não encontrado: ${fieldId}`);

      await client.query(
        `INSERT INTO contact_custom_field_values (contact_id, field_id, value)
         VALUES ($1, $2, $3)
         ON CONFLICT (contact_id, field_id) DO UPDATE SET value = EXCLUDED.value`,
        [contactId, fieldId, value]
      );
    }

    await client.query('COMMIT');
    return NextResponse.json({ success: true, contactId, updatedFields: updates.size });
  } catch (error: any) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error('[AGENT_CRM_FIELDS_PATCH] Error:', error);
    if (error instanceof SyntaxError) return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 });
    if (error?.code === '23505') return NextResponse.json({ error: 'Já existe outro contato com este telefone.' }, { status: 409 });
    return NextResponse.json({ error: error?.message || 'Internal Server Error' }, { status: 400 });
  } finally {
    client.release();
  }
}
