import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ load: vi.fn(), search: vi.fn() }));
vi.mock('@/services/google-ads/api-client', () => ({ loadWorkspaceGoogleAdsContext: mocks.load, searchGoogleAds: mocks.search }));
import { googleAdsCampaignReport } from '@/modules/nexus/services/google-ads-agent';

beforeEach(() => { vi.resetAllMocks(); mocks.load.mockResolvedValue({ credentials: { secret: 'private' }, customerId: '12345', loginCustomerId: null }); mocks.search.mockResolvedValue([{ campaign: { name: 'Campanha' }, metrics: { clicks: '5' } }]); });
describe('Google Ads agent report', () => {
  it('queries only the connected workspace and never exposes credentials', async () => {
    const result = await googleAdsCampaignReport('workspace', { startDate: '2026-10-01', endDate: '2026-10-31' }, new AbortController().signal);
    expect(mocks.load).toHaveBeenCalledWith('workspace');
    expect(mocks.search).toHaveBeenCalledWith(expect.objectContaining({ customerId: '12345', maxPages: 1, query: expect.stringContaining("BETWEEN '2026-10-01' AND '2026-10-31' LIMIT 500") }));
    expect(JSON.stringify(result)).not.toContain('private');
  });
  it('rejects invalid and overlong periods before requesting credentials', async () => {
    await expect(googleAdsCampaignReport('workspace', { startDate: "2026-01-01' OR 1=1", endDate: '2026-01-30' }, new AbortController().signal)).rejects.toThrow();
    await expect(googleAdsCampaignReport('workspace', { startDate: '2026-01-01', endDate: '2026-03-01' }, new AbortController().signal)).rejects.toThrow('31 dias');
    expect(mocks.load).not.toHaveBeenCalled();
  });
});
