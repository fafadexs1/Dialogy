import type { Permission, Role } from '@/lib/types';

export type PermissionFilter = 'all' | 'allowed' | 'blocked';
export const isProtectedRole = (role: Role) => role.name === 'Administrador';
export const hasRolePermission = (role: Role, id: string) => isProtectedRole(role) || role.permissions.some(permission => permission.id === id);

export function setRolePermission(roles: Role[], roleId: string, permission: Permission, enabled: boolean): Role[] {
  return roles.map(role => {
    if (role.id !== roleId || isProtectedRole(role)) return role;
    const permissions = role.permissions.filter(item => item.id !== permission.id);
    return { ...role, permissions: enabled ? [...permissions, permission] : permissions };
  });
}

export function filterPermissionGroups(permissions: Permission[], role: Role, query: string, category: string, access: PermissionFilter) {
  const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
  const words = normalize(query).trim().split(/\s+/).filter(Boolean);
  const groups = new Map<string, Permission[]>();
  for (const permission of permissions) {
    if (category !== 'all' && permission.category !== category) continue;
    if (access !== 'all' && hasRolePermission(role, permission.id) !== (access === 'allowed')) continue;
    const text = normalize(`${permission.description} ${permission.category} ${permission.id}`);
    if (!words.every(word => text.includes(word))) continue;
    const group = groups.get(permission.category) || [];
    group.push(permission);
    groups.set(permission.category, group);
  }
  return [...groups.entries()];
}
