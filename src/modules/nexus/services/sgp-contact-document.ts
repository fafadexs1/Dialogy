import { db } from '@/lib/db';
import { isValidBrazilianDocument, normalizeBrazilianDocument } from '@/lib/brazilian-document';

/** Called only after an SGP lookup or contract selection confirms the document. */
export async function saveSgpContactDocumentIfEmpty(
  input: { workspaceId: string; chatId: string; document: string },
  database: Pick<typeof db, 'query'> = db,
): Promise<'saved' | 'preserved' | 'unavailable'> {
  if (!isValidBrazilianDocument(input.document)) return 'unavailable';
  try {
    const result = await database.query(`WITH target AS (
      SELECT ct.id AS contact_id, f.id AS field_id
      FROM chats c
      JOIN contacts ct ON ct.id=c.contact_id AND ct.workspace_id=c.workspace_id
      JOIN workspace_integrations i ON i.workspace_id=c.workspace_id AND i.provider='sgp' AND i.is_active=true
      JOIN custom_field_definitions f ON f.id::text=i.config->>'cpfFieldId' AND f.workspace_id=c.workspace_id
      WHERE c.workspace_id=$1 AND c.id=$2
    ), saved AS (
      INSERT INTO contact_custom_field_values (contact_id, field_id, value)
      SELECT contact_id, field_id, $3 FROM target
      ON CONFLICT (contact_id, field_id) DO UPDATE SET value=EXCLUDED.value
      WHERE NULLIF(btrim(contact_custom_field_values.value), '') IS NULL
      RETURNING contact_id
    ) SELECT CASE WHEN EXISTS (SELECT 1 FROM saved) THEN 'saved'
      WHEN EXISTS (SELECT 1 FROM target) THEN 'preserved' ELSE 'unavailable' END AS status`,
    [input.workspaceId, input.chatId, normalizeBrazilianDocument(input.document)]);
    return result.rows[0]?.status || 'unavailable';
  } catch { return 'unavailable'; }
}
