/** SQL fragments use only trusted aliases supplied by application code. */
export function relevantMessageSql(alias = 'm'): string {
  return `${alias}.type <> 'system'
    AND COALESCE(${alias}.metadata->>'isInternalNote', 'false') <> 'true'
    AND LOWER(COALESCE(${alias}.api_message_status, '')) <> 'internal'
    AND COALESCE(${alias}.metadata->>'event', '') NOT IN
      ('transfer_notice', 'transfer', 'logout_transfer', 'marketing_auto_close', 'assignment', 'close_notice')
    AND COALESCE(${alias}.metadata->>'isMarketing', 'false') <> 'true'
    AND NULLIF(${alias}.metadata->>'campaignId', '') IS NULL
    AND (${alias}.from_me = FALSE OR
      LOWER(COALESCE(${alias}.api_message_status, '')) IN ('', 'sent', 'delivered', 'read', 'played'))`;
}

export function conversationWeightSql(latest = 'latest', at = 'statement_timestamp()'): string {
  return `CASE WHEN ${latest}.created_at IS NULL THEN 0.05
    WHEN ${latest}.from_me = FALSE THEN CASE WHEN ${latest}.created_at >= ${at} - interval '10 minutes' THEN 1.25 ELSE 1.00 END
    WHEN ${latest}.created_at >= ${at} - interval '10 minutes' THEN 0.25
    WHEN ${latest}.created_at >= ${at} - interval '30 minutes' THEN 0.15 ELSE 0.05 END`;
}

export function chatWorkloadSql(chat = 'assigned_chat', at = 'statement_timestamp()'): string {
  return `SELECT GREATEST(${conversationWeightSql('latest', at)},
    CASE WHEN ${chat}.assigned_at IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM messages human_reply
      WHERE human_reply.chat_id = ${chat}.id AND human_reply.workspace_id = ${chat}.workspace_id
        AND human_reply.from_me = TRUE AND human_reply.sender_user_id = ${chat}.agent_id
        AND human_reply.created_at >= ${chat}.assigned_at AND ${relevantMessageSql('human_reply')}
    ) THEN 1.0 ELSE 0.0 END) AS weight,
    (latest.created_at IS NOT NULL AND latest.api_message_status IS NULL) AS legacy_status
    FROM (SELECT 1) seed LEFT JOIN LATERAL (
      SELECT m.from_me, m.created_at, m.api_message_status FROM messages m
      WHERE m.chat_id = ${chat}.id AND m.workspace_id = ${chat}.workspace_id AND ${relevantMessageSql()}
      ORDER BY m.created_at DESC, m.id DESC LIMIT 1
    ) latest ON TRUE`;
}
