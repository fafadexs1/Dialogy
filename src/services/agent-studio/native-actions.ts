import 'server-only';

import { withStudioTransaction } from './repository';
import { resolveStudioMapping, type StudioDataContext } from './data-mapping';
import type { ProcedureStep } from './types';

/** Internal-only effects. The runtime validates the published step and reserves its operation first. */
export async function executeStudioContactAction(input: { workspaceId: string; chatId: string; step: ProcedureStep; context: StudioDataContext; confirmed: boolean }) {
  if (!input.confirmed) throw new Error('Confirme a alteração antes de atualizar o contato.');
  await withStudioTransaction(async (client) => {
    const contact = await client.query('SELECT contact_id FROM chats WHERE workspace_id = $1 AND id = $2 FOR UPDATE', [input.workspaceId, input.chatId]);
    const contactId = contact.rows[0]?.contact_id;
    if (!contactId) throw new Error('O contato da conversa não está disponível.');
    const step = input.step;
    if (step.nativeActionType === 'add_tag' || step.nativeActionType === 'remove_tag') {
      const tagId = String(step.nativeActionPayload?.tagId || '');
      const tag = await client.query('SELECT id FROM tags WHERE workspace_id = $1 AND id::text = $2', [input.workspaceId, tagId]);
      if (!tag.rows[0]) throw new Error('A etiqueta não pertence a este workspace.');
      if (step.nativeActionType === 'add_tag') await client.query('INSERT INTO contact_tags (contact_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [contactId, tagId]);
      else await client.query('DELETE FROM contact_tags WHERE contact_id = $1 AND tag_id = $2', [contactId, tagId]);
      return;
    }
    if (step.nativeActionType !== 'update_crm_field' || !step.nativeDataMappings?.length) throw new Error('Ação de contato não configurada.');
    for (const mapping of step.nativeDataMappings) {
      const field = await client.query('SELECT id FROM custom_field_definitions WHERE workspace_id = $1 AND id::text = $2', [input.workspaceId, mapping.apiField]);
      if (!field.rows[0]) throw new Error('O campo de CRM não pertence a este workspace.');
      const value = resolveStudioMapping(mapping, input.context);
      if (!['string', 'number', 'boolean'].includes(typeof value) || String(value).length > 5000) throw new Error('O dado não pode ser salvo neste campo de CRM.');
      await client.query(`INSERT INTO contact_custom_field_values (contact_id, field_id, value) VALUES ($1, $2, $3)
        ON CONFLICT (contact_id, field_id) DO UPDATE SET value = EXCLUDED.value`, [contactId, field.rows[0].id, String(value)]);
    }
  });
}
