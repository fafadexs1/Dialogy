import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ user: vi.fn(), permission: vi.fn(), query: vi.fn() }));
vi.mock('@/actions/user', () => ({ getCurrentUser: mocks.user }));
vi.mock('@/lib/workspace-permissions', () => ({ hasWorkspacePermission: mocks.permission }));
vi.mock('@/services/mcp/store', () => ({ getMcpWorkspaceConfig: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { query: mocks.query } }));
import { clearAiAppMemory } from '@/actions/ai-apps';
const workspace = '00000000-0000-4000-8000-000000000001';
const contact = '00000000-0000-4000-8000-000000000002';
beforeEach(() => { vi.resetAllMocks(); mocks.user.mockResolvedValue({ id: 'user', activeWorkspaceId: workspace }); mocks.permission.mockResolvedValue(true); mocks.query.mockResolvedValue({ rows: [{ deleted: 3 }] }); });
describe('memory deletion authorization', () => {
  it('requires a workspace administrator in the active workspace', async () => {
    mocks.permission.mockResolvedValueOnce(false);
    expect((await clearAiAppMemory(workspace, contact)).success).toBe(false);
    mocks.user.mockResolvedValueOnce({ id: 'user', activeWorkspaceId: contact });
    expect((await clearAiAppMemory(workspace)).success).toBe(false);
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it('restricts deletion to the active workspace and optionally one contact', async () => {
    expect(await clearAiAppMemory(workspace, contact)).toEqual({ success: true, deleted: 3 });
    expect(mocks.query).toHaveBeenLastCalledWith(expect.stringContaining('workspace_id=$1'), [workspace, contact]);
    expect(await clearAiAppMemory(workspace)).toEqual({ success: true, deleted: 3 });
    expect(mocks.query).toHaveBeenLastCalledWith(expect.stringContaining('workspace_id=$1'), [workspace, null]);
  });
  it('rejects invalid contact ids before querying', async () => {
    expect((await clearAiAppMemory(workspace, 'not-an-id')).success).toBe(false); expect(mocks.query).not.toHaveBeenCalled();
  });
});
