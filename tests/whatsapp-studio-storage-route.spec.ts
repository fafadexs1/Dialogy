import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  permission: vi.fn(),
  signed: vi.fn(),
}));
vi.mock('@/lib/security/access', () => ({
  requireWorkspaceAccess: mocks.access,
  requireWorkspacePermission: mocks.permission,
  toPublicAccessError: (error: { status?: number }) =>
    error.status ? { status: error.status, error: 'Access denied' } : null,
}));
vi.mock('@/lib/storage/private-s3', () => ({
  createPrivateObjectDownloadUrl: mocks.signed,
}));
import { GET } from '@/app/api/storage/object/route';
const workspace = '10000000-0000-4000-8000-000000000001';
const request = (folder: string) =>
  new NextRequest(
    'http://localhost/api/storage/object?key=' +
      encodeURIComponent(
        'workspaces/' +
          workspace +
          '/' +
          folder +
          '/20000000-0000-4000-8000-000000000001.jpg',
      ),
  );
beforeEach(() => {
  vi.resetAllMocks();
  mocks.access.mockResolvedValue({ id: 'member' });
  mocks.permission.mockResolvedValue({ id: 'member' });
  mocks.signed.mockResolvedValue(
    'https://private-storage.example/temporary-image',
  );
});
describe('Private studio photo delivery', () => {
  it('checks membership in the photo workspace before creating a temporary download', async () => {
    const response = await GET(request('whatsapp-studio'));
    expect(response.status).toBe(307);
    expect(mocks.access).toHaveBeenCalledWith(workspace);
    expect(mocks.permission).not.toHaveBeenCalled();
    expect(mocks.signed).toHaveBeenCalledTimes(1);
  });
  it('does not sign a photo URL for an unauthorized workspace', async () => {
    mocks.access.mockRejectedValue({ status: 403 });
    expect((await GET(request('whatsapp-studio'))).status).toBe(403);
    expect(mocks.signed).not.toHaveBeenCalled();
  });
  it('preserves the existing inbox and CRM permission checks', async () => {
    await GET(request('message-media'));
    expect(mocks.permission).toHaveBeenCalledWith(workspace, 'inbox:access');
    await GET(request('crm-custom-fields'));
    expect(mocks.permission).toHaveBeenCalledWith(workspace, 'crm:view');
    expect(mocks.access).not.toHaveBeenCalled();
  });
  it('rejects unexpected object folders without contacting storage', async () => {
    expect((await GET(request('secrets'))).status).toBe(400);
    expect(mocks.signed).not.toHaveBeenCalled();
  });
});
