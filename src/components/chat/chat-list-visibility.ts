import type { Chat, Team } from '@/lib/types';
export { isMarketingMessage, matchesInboxMarketingFilter } from '@/lib/inbox-marketing';

export function matchesChatTeamFilter(
  chat: Pick<Chat, 'team_id' | 'tag'>,
  teams: Array<Pick<Team, 'id' | 'tagLabel'>>,
  selectedTeamIds: string[]
) {
  if (selectedTeamIds.length === 0) return true;

  // Once a chat has an explicit team assignment, the old tag is only
  // presentation/legacy data. Falling back to it here makes a transferred
  // chat appear in every team that happens to use the same tag.
  if (chat.team_id) return selectedTeamIds.includes(chat.team_id);

  return teams.some((team) =>
    selectedTeamIds.includes(team.id) &&
    Boolean(team.tagLabel && chat.tag && team.tagLabel === chat.tag)
  );
}
