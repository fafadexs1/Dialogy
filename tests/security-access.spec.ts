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

  it('allows workspace access immediately via app_metadata.workspace_ids without querying DB', async () => {
    mocks.getUser.mockResolvedValue({
      data: {
        user: {
          id: 'user-1',
          app_metadata: { workspace_ids: ['workspace-123'] },
        },
      },
    });

    const user = await requireWorkspaceAccess('workspace-123');
    expect(user.id).toBe('user-1');
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('allows workspace access immediately for superadmin via app_metadata without querying DB', async () => {
    mocks.getUser.mockResolvedValue({
      data: {
        user: {
          id: 'user-admin',
          app_metadata: { is_superadmin: true },
        },
      },
    });

    const user = await requireWorkspaceAccess('any-workspace');
    expect(user.id).toBe('user-admin');
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('falls back to DB query when workspace is not in app_metadata claims', async () => {
    mocks.getUser.mockResolvedValue({
      data: {
        user: {
          id: 'user-1',
          app_metadata: { workspace_ids: ['other-ws'] },
        },
      },
    });
    mocks.query.mockResolvedValue({ rowCount: 1, rows: [{}] });

    const user = await requireWorkspaceAccess('new-ws');
    expect(user.id).toBe('user-1');
    expect(mocks.query).toHaveBeenCalledTimes(1);
  });
});
