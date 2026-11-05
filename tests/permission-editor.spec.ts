import { describe, expect, it } from 'vitest';
import type { Permission, Role } from '@/lib/types';
import { filterPermissionGroups, hasRolePermission, setRolePermission } from '@/lib/permission-editor';

const view: Permission = { id: 'crm:view', category: 'CRM', description: 'Visualizar contatos' };
const edit: Permission = { id: 'crm:edit', category: 'CRM', description: 'Editar contatos' };
const automation: Permission = { id: 'automations:manage', category: 'Automações', description: 'Gerenciar agentes' };
const role: Role = { id: 'member', name: 'Membro', description: '', is_default: true, permissions: [view] };

describe('permission editor state', () => {
  it('changes only the targeted role and does not duplicate permissions', () => {
    const source = [role, { ...role, id: 'other' }];
    const result = setRolePermission(setRolePermission(source, role.id, edit, true), role.id, edit, true);
    expect(result[0].permissions).toEqual([view, edit]);
    expect(result[1]).toBe(source[1]);
    expect(source[0].permissions).toEqual([view]);
  });
  it('rolls back one failed update while retaining another successful update', () => {
    let state = setRolePermission([role], role.id, edit, true);
    state = setRolePermission(state, role.id, automation, true);
    state = setRolePermission(state, role.id, edit, false);
    expect(state[0].permissions).toEqual([view, automation]);
  });
  it('keeps administrator permissions protected', () => {
    const admin = { ...role, name: 'Administrador' };
    expect(setRolePermission([admin], admin.id, view, false)[0]).toBe(admin);
    expect(hasRolePermission(admin, automation.id)).toBe(true);
  });
  it('combines category, accent-insensitive search and access filters', () => {
    const catalog = [view, edit, automation];
    expect(filterPermissionGroups(catalog, role, 'contatos', 'CRM', 'blocked')).toEqual([['CRM', [edit]]]);
    expect(filterPermissionGroups(catalog, role, 'automacoes', 'all', 'all')).toEqual([['Automações', [automation]]]);
    expect(filterPermissionGroups(catalog, role, '', 'all', 'allowed')).toEqual([['CRM', [view]]]);
    expect(filterPermissionGroups(catalog, role, 'inexistente', 'all', 'all')).toEqual([]);
  });
});
