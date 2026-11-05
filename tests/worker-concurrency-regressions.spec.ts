import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dbQuery, clientQuery, release } = vi.hoisted(() => ({
  dbQuery: vi.fn(),
  clientQuery: vi.fn(),
  release: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    query: dbQuery,
    connect: vi.fn(async () => ({ query: clientQuery, release })),
  },
}));
vi.mock('@/lib/billing-logic', () => ({
  getMonthlyChatLimitStatus: vi.fn(async () => ({ allowed: true, plan: 'pro' })),
}));

import { RelayCapacity } from '@/services/meta/relay-capacity';
import { claimDueRecipient, processClaimedRecipient } from '@/services/campaigns/worker';

describe('worker concurrency regressions', () => {
  beforeEach(() => {
    dbQuery.mockReset();
    clientQuery.mockReset();
    release.mockReset();
  });

  it('prevents overlapping relay claims and never exceeds delivery capacity', () => {
    const capacity = new RelayCapacity(2);
    expect(capacity.beginClaim()).toBe(2);
    expect(capacity.beginClaim()).toBe(0);
    capacity.startDelivery();
    capacity.startDelivery();
    capacity.finishClaim();
    expect(capacity.beginClaim()).toBe(0);
    capacity.finishDelivery();
    expect(capacity.beginClaim()).toBe(1);
  });

  it('locks a campaign before claiming its next recipient', async () => {
    clientQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [] });

    await expect(claimDueRecipient('worker-a')).resolves.toBeNull();

    const claimSql = String(clientQuery.mock.calls[1]?.[0]);
    expect(claimSql).toContain('FOR UPDATE OF c SKIP LOCKED');
    expect(claimSql).toContain("active.status = 'processing'");
    expect(clientQuery).toHaveBeenLastCalledWith('COMMIT');
    expect(release).toHaveBeenCalledOnce();
  });

  it('releases a claimed recipient when loading its context fails', async () => {
    dbQuery
      .mockRejectedValueOnce(new Error('temporary database failure'))
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ total: 1, sent: 0, failed: 0, cancelled: 0, active: 1 }] });

    await processClaimedRecipient({
      id: 'recipient-1',
      campaign_id: 'campaign-1',
      contact_id: 'contact-1',
      message_id: 'message-1',
      attempt_count: 1,
      max_attempts: 3,
    });

    expect(String(dbQuery.mock.calls[1]?.[0])).toContain("status = $1");
    expect(String(dbQuery.mock.calls[1]?.[0])).toContain('locked_at = NULL');
    expect(dbQuery.mock.calls[1]?.[1]).toEqual([
      'scheduled',
      'temporary database failure',
      'recipient-1',
    ]);
  });
});
