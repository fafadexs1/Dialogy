import { describe, expect, it } from 'vitest';

import {
  WHATSAPP_CUSTOMER_WINDOW_MS,
  hasRecentWhatsappCustomerReply,
} from '@/lib/whatsapp/customer-window';

describe('hasRecentWhatsappCustomerReply', () => {
  const now = new Date('2026-04-17T15:00:00.000Z');

  it('returns true when the customer replied inside the 24h window', () => {
    const repliedAt = new Date(now.getTime() - (WHATSAPP_CUSTOMER_WINDOW_MS - 60_000));

    expect(hasRecentWhatsappCustomerReply(repliedAt, now)).toBe(true);
  });

  it('returns true at the 24h boundary', () => {
    const repliedAt = new Date(now.getTime() - WHATSAPP_CUSTOMER_WINDOW_MS);

    expect(hasRecentWhatsappCustomerReply(repliedAt, now)).toBe(true);
  });

  it('returns false when the last customer reply is older than 24h', () => {
    const repliedAt = new Date(now.getTime() - WHATSAPP_CUSTOMER_WINDOW_MS - 1);

    expect(hasRecentWhatsappCustomerReply(repliedAt, now)).toBe(false);
  });

  it('returns false for null or invalid dates', () => {
    expect(hasRecentWhatsappCustomerReply(null, now)).toBe(false);
    expect(hasRecentWhatsappCustomerReply('invalid-date', now)).toBe(false);
  });
});
