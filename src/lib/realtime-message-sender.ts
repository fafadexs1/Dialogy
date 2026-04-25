import type { Chat, Message, MessageMetadata, MessageSender, User } from '@/lib/types';

type RealtimeMessageRow = {
  from_me?: boolean | null;
  sender_user_id?: string | null;
  sender_system_agent_id?: string | null;
};

function pickString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }
  }
  return undefined;
}

function getSenderAvatar(sender: MessageSender): string | undefined {
  if (!sender || typeof sender !== 'object') return undefined;
  return pickString((sender as any).avatar, (sender as any).avatar_url);
}

function getKnownSystemAgentSender(
  messages: Message[],
  systemAgentId?: string,
  preferredName?: string
): Exclude<MessageSender, undefined> | undefined {
  const systemSenders = messages
    .map((message) => message.sender)
    .filter((sender): sender is Exclude<MessageSender, undefined> => sender?.type === 'system_agent');

  if (!systemSenders.length) {
    return undefined;
  }

  if (systemAgentId) {
    const byId = systemSenders.find((sender) => sender.id === systemAgentId);
    if (byId) return byId;
  }

  if (preferredName) {
    const normalizedPreferredName = preferredName.toLowerCase();
    const byName = systemSenders.find((sender) => {
      const senderName = typeof sender.name === 'string' ? sender.name.trim().toLowerCase() : '';
      return senderName.length > 0 && senderName === normalizedPreferredName;
    });
    if (byName) return byName;
  }

  const uniqueSenders = Array.from(
    new Map(
      systemSenders.map((sender) => [`${sender.id ?? ''}:${sender.name ?? ''}`, sender])
    ).values()
  );

  return uniqueSenders.length === 1 ? uniqueSenders[0] : undefined;
}

export function resolveRealtimeSender({
  data,
  metadata,
  chat,
  currentUser,
  existingMessages = [],
}: {
  data: RealtimeMessageRow;
  metadata?: MessageMetadata;
  chat?: Chat;
  currentUser?: User | null;
  existingMessages?: Message[];
}): MessageSender {
  const metadataRecord = metadata as Record<string, unknown> | undefined;
  const knownMessages = [...existingMessages, ...(chat?.messages || [])];
  const systemAgentId = pickString(
    data.sender_system_agent_id,
    metadata?.authored_by_system_agent_id,
    metadata?.closed_by_system_agent_id,
    metadataRecord?.from_system_agent_id
  );
  const systemAgentName = pickString(
    metadataRecord?.systemAgentName,
    metadataRecord?.system_agent_name,
    metadataRecord?.senderName,
    metadataRecord?.sender_name,
    metadataRecord?.assistantName,
    metadataRecord?.assistant_name,
    metadataRecord?.agent_name,
    metadataRecord?.from_system_agent_name
  );
  const systemAgentAvatar = pickString(
    metadataRecord?.systemAgentAvatar,
    metadataRecord?.system_agent_avatar,
    metadataRecord?.systemAgentAvatarUrl,
    metadataRecord?.system_agent_avatar_url,
    metadataRecord?.senderAvatar,
    metadataRecord?.sender_avatar,
    metadataRecord?.senderAvatarUrl,
    metadataRecord?.sender_avatar_url,
    metadataRecord?.assistantAvatar,
    metadataRecord?.assistant_avatar,
    metadataRecord?.assistantAvatarUrl,
    metadataRecord?.assistant_avatar_url,
    metadataRecord?.agent_avatar,
    metadataRecord?.agent_avatar_url,
    metadataRecord?.from_system_agent_avatar,
    metadataRecord?.from_system_agent_avatar_url
  );
  const knownSystemAgent = getKnownSystemAgentSender(knownMessages, systemAgentId, systemAgentName);
  const userSenderName = pickString(
    metadataRecord?.authored_by_name,
    metadataRecord?.senderName,
    metadataRecord?.sender_name,
    metadataRecord?.agent_name,
    metadataRecord?.from_agent_name
  );
  const userSenderAvatar = pickString(
    metadataRecord?.authored_by_avatar,
    metadataRecord?.authored_by_avatar_url,
    metadataRecord?.senderAvatar,
    metadataRecord?.sender_avatar,
    metadataRecord?.senderAvatarUrl,
    metadataRecord?.sender_avatar_url,
    metadataRecord?.agent_avatar,
    metadataRecord?.agent_avatar_url,
    metadataRecord?.from_agent_avatar,
    metadataRecord?.from_agent_avatar_url
  );
  const isSystemAgent = Boolean(
    systemAgentId ||
    data.sender_system_agent_id ||
    metadata?.sentBy === 'system_agent' ||
    metadata?.sentBy === 'autopilot'
  );

  if (data.from_me) {
    if (isSystemAgent) {
      return {
        id: systemAgentId || knownSystemAgent?.id || 'system_agent',
        name: systemAgentName || knownSystemAgent?.name || 'Assistente Virtual',
        avatar: systemAgentAvatar || getSenderAvatar(knownSystemAgent),
        type: 'system_agent',
      };
    }

    if (data.sender_user_id === currentUser?.id && currentUser) {
      return {
        id: currentUser.id,
        name: currentUser.name,
        avatar: currentUser.avatar || currentUser.avatar_url || undefined,
        type: 'user',
      };
    }

    if (chat?.agent && (!data.sender_user_id || data.sender_user_id === chat.agent.id)) {
      return {
        id: chat.agent.id,
        name: chat.agent.name,
        avatar: chat.agent.avatar || chat.agent.avatar_url || undefined,
        type: 'user',
      };
    }

    if (data.sender_user_id && (userSenderName || userSenderAvatar)) {
      return {
        id: data.sender_user_id,
        name: userSenderName || 'Agente',
        avatar: userSenderAvatar,
        type: 'user',
      };
    }

    if (currentUser) {
      return {
        id: currentUser.id,
        name: currentUser.name,
        avatar: currentUser.avatar || currentUser.avatar_url || undefined,
        type: 'user',
      };
    }

    return undefined;
  }

  if (chat?.contact) {
    return {
      id: chat.contact.id,
      name: chat.contact.name,
      avatar: chat.contact.avatar_url ?? undefined,
      type: 'contact',
    };
  }

  return undefined;
}
