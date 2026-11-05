import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PERMISSIONS } from '@/lib/permissions-catalog';

const mocks = vi.hoisted(() => ({ query: vi.fn(), getUser: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { query: mocks.query } }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: mocks.getUser } }) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
import { createRoleAction, deleteRoleAction, getRolesAndPermissions, updateRoleAction, updateRolePermissionAction } from '@/actions/permissions';

let sql: PGlite;
beforeAll(async () => {
  sql = new PGlite();
  await sql.exec(`
    CREATE TABLE users (id text PRIMARY KEY, is_superadmin boolean DEFAULT false);
    CREATE TABLE workspaces (id text PRIMARY KEY, owner_id text);
    CREATE TABLE permissions (id text PRIMARY KEY, category text, description text);
    CREATE TABLE roles (id text PRIMARY KEY DEFAULT gen_random_uuid()::text, workspace_id text REFERENCES workspaces(id), name text, description text, is_default boolean DEFAULT false, UNIQUE(workspace_id, name));
    CREATE TABLE role_permissions (role_id text REFERENCES roles(id) ON DELETE CASCADE, permission_id text REFERENCES permissions(id), PRIMARY KEY(role_id, permission_id));
    CREATE TABLE user_workspace_roles (user_id text, workspace_id text, role_id text REFERENCES roles(id), PRIMARY KEY(user_id, workspace_id));
    CREATE TABLE teams (id text, role_id text REFERENCES roles(id));
  `);
});
afterAll(async () => { await sql.close(); });
beforeEach(async () => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: { id: 'owner' } } });
  mocks.query.mockImplementation(async (query: string, params?: unknown[]) => {
    const result = await sql.query(query, params);
    return { ...result, rowCount: result.rows.length || result.affectedRows || 0 };
  });
  await sql.exec(`TRUNCATE teams, user_workspace_roles, role_permissions, roles, permissions, workspaces, users CASCADE;
    INSERT INTO users(id) VALUES ('owner'), ('viewer'), ('foreign-owner');
    INSERT INTO workspaces VALUES ('workspace', 'owner'), ('foreign', 'foreign-owner');`);
});
const form = (data: Record<string, string>) => {
  const result = new FormData();
  Object.entries(data).forEach(([key, value]) => result.set(key, value));
  return result;
};

describe('role permissions with production PostgreSQL statements and real access guards', () => {
  it('initializes defaults once and preserves revoked and newly granted permissions on subsequent reads', async () => {
    const initial = await getRolesAndPermissions('workspace');
    expect(initial.error).toBeUndefined();
    expect(initial.canEdit).toBe(true);
    expect(initial.permissions).toHaveLength(PERMISSIONS.length);
    const member = initial.roles.find(role => role.is_default)!;
    const admin = initial.roles.find(role => role.name === 'Administrador')!;
    expect(member.permissions.some(permission => permission.id === 'crm:view')).toBe(true);
    expect(admin.permissions).toHaveLength(PERMISSIONS.length);
    expect(await updateRolePermissionAction(member.id, 'crm:view', false)).toEqual({ success: true });
    expect(await updateRolePermissionAction(member.id, 'billing:view', true)).toEqual({ success: true });
    for (let i = 0; i < 2; i++) {
      const loaded = (await getRolesAndPermissions('workspace')).roles.find(role => role.id === member.id)!;
      expect(loaded.permissions.some(permission => permission.id === 'crm:view')).toBe(false);
      expect(loaded.permissions.some(permission => permission.id === 'billing:view')).toBe(true);
    }
  });
  it('creates, renames and deletes a custom role using its returned ID', async () => {
    const created = await createRoleAction({}, form({ name: '  Especialista  ', description: 'Atendimento especializado', workspaceId: 'workspace' }));
    expect(created.success).toBe(true);
    expect(created.roleId).toBeTruthy();
    expect((await sql.query<{ name: string }>('SELECT name FROM roles WHERE id = $1', [created.roleId])).rows[0].name).toBe('Especialista');
    expect((await updateRoleAction({}, form({ roleId: created.roleId!, name: 'Relacionamento', description: 'Equipe', workspaceId: 'workspace' }))).success).toBe(true);
    expect((await deleteRoleAction(created.roleId!, 'workspace')).success).toBe(true);
    expect((await sql.query('SELECT 1 FROM roles WHERE id = $1', [created.roleId])).rows).toHaveLength(0);
  });
  it('allows read-only access while denying every mutation for a viewer', async () => {
    const initial = await getRolesAndPermissions('workspace');
    const member = initial.roles.find(role => role.is_default)!;
    await sql.query(`INSERT INTO role_permissions VALUES ($1, 'permissions:view')`, [member.id]);
    await sql.query(`INSERT INTO user_workspace_roles VALUES ('viewer', 'workspace', $1)`, [member.id]);
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'viewer' } } });
    const result = await getRolesAndPermissions('workspace');
    expect(result.error).toBeUndefined();
    expect(result.canEdit).toBe(false);
    expect((await updateRolePermissionAction(member.id, 'permissions:edit', true)).success).toBe(false);
    expect((await createRoleAction({}, form({ name: 'Novo', workspaceId: 'workspace' }))).success).toBe(false);
    expect((await updateRoleAction({}, form({ roleId: member.id, name: 'Alterado', workspaceId: 'workspace' }))).success).toBe(false);
    expect((await deleteRoleAction(member.id, 'workspace')).success).toBe(false);
  });
  it('protects administrator, default and assigned roles', async () => {
    const initial = await getRolesAndPermissions('workspace');
    const admin = initial.roles.find(role => role.name === 'Administrador')!;
    const member = initial.roles.find(role => role.is_default)!;
    expect((await updateRolePermissionAction(admin.id, 'crm:view', false)).success).toBe(false);
    expect((await deleteRoleAction(admin.id, 'workspace')).success).toBe(false);
    expect((await deleteRoleAction(member.id, 'workspace')).success).toBe(false);
    const created = await createRoleAction({}, form({ name: 'Comercial', workspaceId: 'workspace' }));
    await sql.query(`INSERT INTO teams VALUES ('team', $1)`, [created.roleId]);
    expect((await deleteRoleAction(created.roleId!, 'workspace')).success).toBe(false);
    await sql.query('DELETE FROM teams');
    await sql.query(`INSERT INTO user_workspace_roles VALUES ('viewer', 'workspace', $1)`, [created.roleId]);
    expect((await deleteRoleAction(created.roleId!, 'workspace')).success).toBe(false);
  });
  it('denies foreign workspace roles and anonymous access', async () => {
    await sql.exec(`INSERT INTO roles(id, workspace_id, name) VALUES ('foreign-role', 'foreign', 'Especialista');`);
    expect((await getRolesAndPermissions('foreign')).error).toBeTruthy();
    expect((await updateRolePermissionAction('foreign-role', 'crm:view', true)).success).toBe(false);
    expect((await updateRoleAction({}, form({ roleId: 'foreign-role', name: 'Renomeado', workspaceId: 'workspace' }))).success).toBe(false);
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    expect((await getRolesAndPermissions('workspace')).roles).toEqual([]);
    expect((await updateRolePermissionAction('foreign-role', 'crm:view', true)).success).toBe(false);
  });
});
