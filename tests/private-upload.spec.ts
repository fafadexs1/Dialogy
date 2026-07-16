import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  putObject: vi.fn(),
}));

vi.mock('@/lib/security/access', () => ({
  requireWorkspacePermission: mocks.requirePermission,
  toPublicAccessError: (error: unknown) => error && typeof error === 'object' && 'code' in error
    ? { code: (error as { code: string }).code, error: 'denied', status: 401 }
    : null,
}));
vi.mock('@/lib/storage/private-s3', () => ({ putPrivateObject: mocks.putObject }));

import { uploadToS3Action } from '@/actions/upload-s3';

describe('private upload action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requirePermission.mockResolvedValue({ id: 'user-1' });
    mocks.putObject.mockResolvedValue(undefined);
  });

  function form(file: File) {
    const data = new FormData();
    data.set('workspaceId', '11111111-1111-4111-8111-111111111111');
    data.set('file', file);
    return data;
  }

  it('checks authentication and workspace permission before storing', async () => {
    mocks.requirePermission.mockRejectedValue({ code: 'unauthenticated' });
    const result = await uploadToS3Action(form(new File(['ok'], 'photo.png', { type: 'image/png' })));
    expect(result).toMatchObject({ success: false, code: 'unauthenticated' });
    expect(mocks.putObject).not.toHaveBeenCalled();
  });

  it('rejects MIME types outside the allowlist', async () => {
    const result = await uploadToS3Action(form(new File(['x'], 'payload.html', { type: 'text/html' })));
    expect(result).toMatchObject({ success: false, code: 'invalid_file_type' });
    expect(mocks.putObject).not.toHaveBeenCalled();
  });

  it('rejects files larger than 10 MB', async () => {
    const file = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'large.pdf', { type: 'application/pdf' });
    const result = await uploadToS3Action(form(file));
    expect(result).toMatchObject({ success: false, code: 'invalid_file_size' });
    expect(mocks.putObject).not.toHaveBeenCalled();
  });

  it('generates a private workspace key on the server', async () => {
    const result = await uploadToS3Action(form(new File(['image'], '../../unsafe.png', { type: 'image/png' })));
    expect(result.success).toBe(true);
    expect(mocks.putObject).toHaveBeenCalledWith(expect.objectContaining({
      key: expect.stringMatching(/^workspaces\/11111111-1111-4111-8111-111111111111\/crm-custom-fields\/[0-9a-f-]{36}\.png$/),
      contentType: 'image/png',
    }));
    expect(result.url).not.toContain('unsafe');
  });
});
