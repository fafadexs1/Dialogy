import type { Chat, Message } from '@/lib/types';

export function isMarketingMessage(message: Pick<Message, 'metadata'>): boolean {
  const meta = message.metadata;
  return Boolean(meta?.isMarketing || meta?.campaignId || meta?.event === 'marketing_auto_close');
}

export function matchesInboxMarketingFilter(
  chat: Pick<Chat, 'status' | 'agentId' | 'agent' | 'messages'> & { agent_id?: string | null },
  includeMarketing = false,
): boolean {
  if (includeMarketing || chat.status !== 'gerais' || chat.agentId || chat.agent_id || chat.agent?.id) return true;

  // Internal notes do not turn an unanswered campaign into a service request.
  const latest = chat.messages?.filter(message =>
    isMarketingMessage(message) || (
      message.type !== 'system'
      && message.api_message_status?.toLowerCase() !== 'internal'
      && !message.metadata?.isInternalNote
    )
  ).reduce<Message | undefined>((previous, message) => {
    if (!previous) return message;
    const difference = Date.parse(message.createdAt) - Date.parse(previous.createdAt);
    return difference > 0 || (difference === 0 && message.id > previous.id) ? message : previous;
  }, undefined);
  return !latest || !isMarketingMessage(latest);
}

// Shared by page loading and tab counts so LIMIT/cursors apply after filtering.
export function buildInboxMarketingVisibilitySql(chatAlias = 'c'): string {
  return `(
    ${chatAlias}.status <> 'gerais'
    OR ${chatAlias}.agent_id IS NOT NULL
    OR COALESCE((
      SELECT NOT (
        COALESCE(latest_message.metadata->>'isMarketing', 'false') = 'true'
        OR NULLIF(latest_message.metadata->>'campaignId', '') IS NOT NULL
        OR COALESCE(latest_message.metadata->>'event', '') = 'marketing_auto_close'
      )
      FROM messages latest_message
      WHERE latest_message.chat_id = ${chatAlias}.id
        AND latest_message.workspace_id = ${chatAlias}.workspace_id
        AND (
          COALESCE(latest_message.metadata->>'isMarketing', 'false') = 'true'
          OR NULLIF(latest_message.metadata->>'campaignId', '') IS NOT NULL
          OR COALESCE(latest_message.metadata->>'event', '') = 'marketing_auto_close'
          OR (
            latest_message.type <> 'system'
            AND LOWER(COALESCE(latest_message.api_message_status, '')) <> 'internal'
            AND COALESCE(latest_message.metadata->>'isInternalNote', 'false') <> 'true'
          )
        )
      ORDER BY latest_message.created_at DESC, latest_message.id DESC
      LIMIT 1
    ), true)
  )`;
}
