import type { MessageMetadata } from '@/lib/types';

export type SystemAgentMessageAttribution = {
  metadata: MessageMetadata & { sentBy: 'system_agent' };
  senderUserId: null;
  senderSystemAgentId: string;
};

/**
 * Keeps system-agent UUIDs out of messages.sender_user_id, which references users(id).
 */
export function createSystemAgentMessageAttribution(
  agentId: string,
  metadata?: MessageMetadata,
): SystemAgentMessageAttribution {
  return {
    metadata: { ...metadata, sentBy: 'system_agent' },
    senderUserId: null,
    senderSystemAgentId: agentId,
  };
}
