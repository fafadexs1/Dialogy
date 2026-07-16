import { describe, expect, it, vi } from 'vitest';

const query = vi.hoisted(() => vi.fn());
vi.mock('@/lib/db', () => ({ db: { query } }));
vi.mock('@/lib/security/access', () => ({
  requireWorkspaceAccess: vi.fn().mockResolvedValue({ id: 'user-1' }),
  requireWorkspacePermission: vi.fn().mockResolvedValue({ id: 'user-1' }),
}));
vi.mock('@/services/meta/meta-channel.service', () => ({
  exchangeFacebookUserToken: vi.fn(),
  findChannelByExternalId: vi.fn(),
}));
vi.mock('@/lib/http/resilient-fetch', () => ({ resilientFetch: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { listMetaChannels } from '@/actions/meta-channels';

describe('Meta channel DTO redaction', () => {
  it('returns credential indicators without returning secret values', async () => {
    query.mockResolvedValueOnce({
      rows: [{
        id: 'channel-1', workspace_id: 'workspace-1', type: 'instagram', name: 'Store',
        external_page_id: 'page-1', ig_business_id: 'ig-1', status: 'active',
        has_credential: true, has_app_secret: true, has_verify_token: true,
        access_token: 'must-not-leak', app_secret: 'must-not-leak', verify_token: 'must-not-leak',
      }],
    });

    const [channel] = await listMetaChannels('workspace-1', 'instagram');
    expect(channel).toMatchObject({ hasCredential: true, hasAppSecret: true, hasVerifyToken: true });
    expect(channel).not.toHaveProperty('access_token');
    expect(channel).not.toHaveProperty('app_secret');
    expect(channel).not.toHaveProperty('verify_token');
  });
});
