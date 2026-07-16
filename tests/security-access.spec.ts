import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  query: vi.fn(),
  hasWorkspacePermission: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ auth: { getUser: mocks.getUser } })),
}));
vi.mock('@/lib/db', () => ({ db: { query: mocks.query } }));
vi.mock('@/lib/workspace-permissions', () => ({
  hasWorkspacePermission: mocks.hasWorkspacePermission,
}));

import {
  AccessError,
  requireAuthenticatedUser,
  requireWorkspaceAccess,
  requireWorkspacePermission,
} from '@/lib/security/access';

describe('central access guards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
  });

  it('rejects anonymous calls with a typed error', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    await expect(requireAuthenticatedUser()).rejects.toMatchObject({
      code: 'unauthenticated',
      status: 401,
    } satisfies Partial<AccessError>);
  });

  it('rejects access to another workspace', async () => {
    mocks.query.mockResolvedValue({ rowCount: 0, rows: [] });
    await expect(requireWorkspaceAccess('workspace-2')).rejects.toMatchObject({
      code: 'workspace_mismatch',
      status: 403,
    } satisfies Partial<AccessError>);
  });

  it('rejects a mutation without the required workspace permission', async () => {
    mocks.hasWorkspacePermission.mockResolvedValue(false);
    await expect(requireWorkspacePermission('workspace-1', 'workspace:settings:edit')).rejects.toMatchObject({
      code: 'forbidden',
      status: 403,
    } satisfies Partial<AccessError>);
  });
});
