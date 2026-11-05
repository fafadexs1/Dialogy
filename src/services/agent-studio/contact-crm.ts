import 'server-only';
import { db } from '@/lib/db';

/** No caller-selected contact ID. Resolve the current conversation inside the workspace. */
export async function loadStudioContactCrm(workspaceId: string, chatId: string): Promise<Record<string, unknown>> {
  const result = await db.query(`SELECT f.id AS field_id, f.label, v.value,
    f.id::text = (SELECT config->>'cpfFieldId' FROM workspace_integrations WHERE workspace_id = c.workspace_id AND provider = 'sgp' AND is_active = true LIMIT 1) AS is_sgp_document
    FROM chats c JOIN contacts ct ON ct.id = c.contact_id AND ct.workspace_id = c.workspace_id
    JOIN contact_custom_field_values v ON v.contact_id = ct.id
    JOIN custom_field_definitions f ON f.id = v.field_id AND f.workspace_id = c.workspace_id
    WHERE c.workspace_id = $1 AND c.id = $2 ORDER BY f.id`, [workspaceId, chatId]);
  const fields: Record<string, unknown> = Object.create(null);
  for (const row of result.rows) {
    if (row.field_id) fields[String(row.field_id)] = row.value;
    if (row.label && !['__proto__', 'constructor', 'prototype'].includes(row.label)) fields[String(row.label)] = row.value;
  }
  const mappedDocument = result.rows.find((row) => row.is_sgp_document === true);
  if (mappedDocument) fields.sgp_document = mappedDocument.value;
  return fields;
}
