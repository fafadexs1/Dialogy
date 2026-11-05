import { describe, expect, it } from 'vitest';
import type { WorkspaceMember } from '@/lib/types';
import { filterWorkspaceMembers, groupWorkspaceMembers } from '@/lib/team-members';

const member = (patch: Partial<WorkspaceMember> = {}): WorkspaceMember => ({ id: 'maria', name: 'Maria Gonçalves', email: 'maria@example.test', avatar: '', online: true, roleId: 'support', role: 'Atendimento', team: 'Suporte técnico', memberSince: 'out. de 2026', autopilotUsage: 0, ...patch });
const rows = [member(), member({ team: 'Comercial' }), member({ team: 'Comercial' }), member({ id: 'jose', name: 'José Silva', email: 'jose@example.test', team: 'Nenhuma', online: false, roleId: 'admin', role: 'Administrador' })];

describe('workspace member directory', () => {
  it('counts people once while retaining all their teams without mutating source rows', () => {
    const result = groupWorkspaceMembers(rows);
    expect(result).toHaveLength(2);
    expect(result[0].teams).toEqual(['Suporte técnico', 'Comercial']);
    expect(result[1].teams).toEqual([]);
    expect(rows[0]).not.toHaveProperty('teams');
    expect(rows).toHaveLength(4);
  });

  it.each(['goncalves', ' MARIA@EXAMPLE.TEST ', 'tecnico', 'comercial', 'atendimento'])('searches names, emails, teams and roles without accents: %s', query => {
    expect(filterWorkspaceMembers(groupWorkspaceMembers(rows), query, 'all', 'all').map(item => item.id)).toEqual(['maria']);
  });

  it('combines search, presence and role filters', () => {
    const directory = groupWorkspaceMembers(rows);
    expect(filterWorkspaceMembers(directory, 'jose', 'offline', 'admin').map(item => item.id)).toEqual(['jose']);
    expect(filterWorkspaceMembers(directory, 'jose', 'online', 'admin')).toEqual([]);
    expect(filterWorkspaceMembers(directory, '', 'online', 'admin')).toEqual([]);
    expect(filterWorkspaceMembers(directory, '', 'all', 'all')).toHaveLength(2);
  });

  it('handles empty results and people without a team', () => {
    expect(groupWorkspaceMembers([])).toEqual([]);
    expect(filterWorkspaceMembers(groupWorkspaceMembers(rows), 'inexistente', 'all', 'all')).toEqual([]);
    expect(groupWorkspaceMembers([member({ team: '' })])[0].teams).toEqual([]);
  });
});
