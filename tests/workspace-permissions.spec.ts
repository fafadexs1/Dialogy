import { beforeEach, describe, expect, it, vi } from 'vitest';

const { query } = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock('@/lib/db', () => ({
  db: { query },
}));

import { hasWorkspacePermission } from '@/lib/workspace-permissions';

describe('hasWorkspacePermission', () => {
  beforeEach(() => query.mockReset());

  it('allows a permission returned by the role/owner query', async () => {
    query.mockResolvedValue({ rowCount: 1, rows: [{ '?column?': 1 }] });

    await expect(hasWorkspacePermission('user-1', 'workspace-1', 'teams:edit')).resolves.toBe(true);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('rp.permission_id = $3'),
      ['user-1', 'workspace-1', 'teams:edit']
    );
  });

  it('denies a workspace member whose role lacks the permission', async () => {
    query.mockResolvedValue({ rowCount: 0, rows: [] });

    await expect(hasWorkspacePermission('user-1', 'workspace-1', 'permissions:edit')).resolves.toBe(false);
  });

  it('fails closed for incomplete input', async () => {
    await expect(hasWorkspacePermission('', 'workspace-1', 'teams:view')).resolves.toBe(false);
    expect(query).not.toHaveBeenCalled();
  });
});
