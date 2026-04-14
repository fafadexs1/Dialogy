import type { Chat, Message } from '@/lib/types';

export function isMarketingMessage(message: Message) {
  const meta = message.metadata as any;
  return Boolean(meta?.isMarketing || meta?.event === 'marketing_auto_close');
}

export function shouldKeepMarketingOnlyChatVisible(
  chat: Chat,
  selectedChatId?: string | null
) {
  const chatAgentId = chat.agent?.id || chat.agentId;
  const isHandedOff =
    Boolean(chatAgentId) ||
    chat.status === 'atendimentos' ||
    chat.status === 'encerrados';

  return chat.id === selectedChatId || isHandedOff;
}
