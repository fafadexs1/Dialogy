import type { Chat } from '@/lib/types';
import { dedupeActiveWhatsappChatsByIdentity } from '@/lib/whatsapp/chat-dedupe';

export const getChatSortValue = (chat: Chat): number => {
  if (chat.updatedAt) {
    return new Date(chat.updatedAt).getTime();
  }
  const lastMessage = chat.messages?.[chat.messages.length - 1];
  if (lastMessage) {
    return new Date(lastMessage.createdAt).getTime();
  }
  return 0;
};

export const sortChatsByActivity = (chats: Chat[]): Chat[] =>
  [...chats].sort((a, b) => getChatSortValue(b) - getChatSortValue(a));

export const dedupeChats = (chats: Chat[], preserveChatId?: string | null) =>
  dedupeActiveWhatsappChatsByIdentity({
    chats,
    getId: (chat) => chat.id,
    getStatus: (chat) => chat.status,
    getPhoneOrJid: (chat) => chat.contact?.phone_number_jid,
    preserveChatId,
  });

export function mergeChatsById(existingChats: Chat[], incomingChats: Chat[]): Chat[] {
  const chatMap = new Map<string, Chat>();
  existingChats.forEach((chat) => chatMap.set(chat.id, chat));
  incomingChats.forEach((chat) => {
    const existing = chatMap.get(chat.id);
    if (existing) {
      const hasIncomingAgent = Object.prototype.hasOwnProperty.call(chat, 'agent');
      const hasIncomingAgentId = Object.prototype.hasOwnProperty.call(chat, 'agentId');
      const hasIncomingSystemAgent = Object.prototype.hasOwnProperty.call(chat, 'assignedSystemAgent');
      const hasIncomingSystemAgentId = Object.prototype.hasOwnProperty.call(chat, 'assigned_system_agent_id');
      chatMap.set(chat.id, {
        ...existing,
        ...chat,
        messages: chat.messages?.length ? chat.messages : existing.messages,
        contact: chat.contact || existing.contact,
        agent: hasIncomingAgent
          ? chat.agent
          : hasIncomingAgentId && chat.agentId !== existing.agent?.id
            ? undefined
            : existing.agent,
        assignedSystemAgent: hasIncomingSystemAgent
          ? chat.assignedSystemAgent
          : hasIncomingSystemAgentId && chat.assigned_system_agent_id !== existing.assignedSystemAgent?.id
            ? undefined
            : existing.assignedSystemAgent,
      });
    } else {
      chatMap.set(chat.id, chat);
    }
  });
  return sortChatsByActivity(Array.from(chatMap.values()));
}

export function appendNewChatsById(existingChats: Chat[], incomingChats: Chat[]): Chat[] {
  const chatMap = new Map<string, Chat>();
  existingChats.forEach((chat) => chatMap.set(chat.id, chat));
  incomingChats.forEach((chat) => {
    if (!chatMap.has(chat.id)) {
      chatMap.set(chat.id, chat);
    }
  });
  return sortChatsByActivity(Array.from(chatMap.values()));
}
