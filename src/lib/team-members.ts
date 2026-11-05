import type { WorkspaceMember } from '@/lib/types';

export type DirectoryMember = WorkspaceMember & { teams: string[] };
export type MemberStatusFilter = 'all' | 'online' | 'offline';

export function groupWorkspaceMembers(members: WorkspaceMember[]): DirectoryMember[] {
  const directory = new Map<string, DirectoryMember>();
  for (const member of members) {
    const entry = directory.get(member.id);
    const team = member.team && member.team !== 'Nenhuma' ? member.team : null;
    if (entry) {
      if (team && !entry.teams.includes(team)) entry.teams.push(team);
    } else {
      directory.set(member.id, { ...member, teams: team ? [team] : [] });
    }
  }
  return [...directory.values()];
}

const normalize = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');

export function filterWorkspaceMembers(members: DirectoryMember[], query: string, status: MemberStatusFilter, roleId: string) {
  const search = normalize(query.trim());
  return members.filter(member =>
    (status === 'all' || member.online === (status === 'online')) &&
    (roleId === 'all' || member.roleId === roleId) &&
    (!search || normalize([member.name, member.email, member.role, ...member.teams].join(' ')).includes(search))
  );
}
