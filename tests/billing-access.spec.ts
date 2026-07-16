import { beforeEach, describe, expect, it, vi } from 'vitest';

const { query } = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock('@/lib/db', () => ({
  db: { query },
}));

vi.mock('@/lib/plans', () => ({
  getPlan: vi.fn(),
  normalizePlanLimits: vi.fn(),
}));

import { checkLimit, getWorkspaceLimits, isBillingBlocked, isBillingGrace } from '@/lib/billing-logic';

describe('billing access status', () => {
  beforeEach(() => query.mockReset());
  it.each(['past_due', 'unpaid', 'canceled', 'incomplete_expired', 'paused'] as const)(
    'blocks workspace operations for %s',
    (status) => {
      expect(isBillingBlocked(status)).toBe(true);
    }
  );

  it.each(['active', 'trialing'] as const)('keeps access for %s', (status) => {
    expect(isBillingBlocked(status)).toBe(false);
  });

  it('keeps only an incomplete initial payment in grace', () => {
    expect(isBillingGrace('incomplete')).toBe(true);
    expect(isBillingGrace('past_due')).toBe(false);
  });

  it('fails closed when the billing dependency is unavailable', async () => {
    query.mockRejectedValueOnce(new Error('database unavailable'));

    await expect(getWorkspaceLimits('workspace-1')).resolves.toMatchObject({
      blocked: true,
      availability: 'unavailable',
      billingStatus: null,
    });
  });

  it('denies billable operations when billing cannot be read', async () => {
    query.mockRejectedValueOnce(new Error('database unavailable'));

    await expect(checkLimit('workspace-1', 'whatsapp', 0)).resolves.toMatchObject({
      allowed: false,
      blocked: true,
      availability: 'unavailable',
      limit: 0,
    });
  });
});
