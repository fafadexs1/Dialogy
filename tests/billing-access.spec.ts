import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  db: { query: vi.fn() },
}));

vi.mock('@/lib/plans', () => ({
  getPlan: vi.fn(),
  normalizePlanLimits: vi.fn(),
}));

import { isBillingBlocked, isBillingGrace } from '@/lib/billing-logic';

describe('billing access status', () => {
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
});
