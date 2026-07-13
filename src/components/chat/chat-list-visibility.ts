import type { Chat, Message, Team } from '@/lib/types';

export function matchesChatTeamFilter(
  chat: Pick<Chat, 'team_id' | 'tag'>,
  teams: Array<Pick<Team, 'id' | 'tagLabel'>>,
  selectedTeamIds: string[]
) {
  if (selectedTeamIds.length === 0) return true;
  if (chat.team_id && selectedTeamIds.includes(chat.team_id)) return true;

  return teams.some((team) =>
    selectedTeamIds.includes(team.id) &&
    Boolean(team.tagLabel && chat.tag && team.tagLabel === chat.tag)
  );
}

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
