import type { PoolClient } from 'pg';

/**
 * Keeps the legacy queue discriminator in sync while inbox routing is still
 * split between chats.tag/chats.color and the newer chat_tags relation.
 */
export async function syncLegacyChatQueueTag(
  client: Pick<PoolClient, 'query'>,
  input: { chatId: string; tagId: string; workspaceId: string }
): Promise<void> {
  await client.query(
    `WITH legacy_tag AS MATERIALIZED (
        SELECT t.label, t.color
        FROM chat_tags ct
        JOIN tags t ON t.id = ct.tag_id AND t.workspace_id = ct.workspace_id
        WHERE ct.chat_id = $1
          AND ct.workspace_id = $3
          AND t.is_close_reason = FALSE
        ORDER BY (ct.tag_id = $2) DESC,
                 ct.created_at DESC,
                 COALESCE(t.sort_order, 2147483647),
                 t.id
        LIMIT 1
     )
     UPDATE chats
     SET tag = (SELECT label FROM legacy_tag),
         color = (SELECT color FROM legacy_tag),
         updated_at = clock_timestamp()
     WHERE id = $1 AND workspace_id = $3`,
    [input.chatId, input.tagId, input.workspaceId]
  );
}
