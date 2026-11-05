import { describe, expect, it } from 'vitest';
import { resolveWhatsappCostPeriod } from '@/lib/whatsapp/cost-period';

describe('WhatsApp cost calendar months', () => {
  it('uses Brasília month boundaries and limits the current month to now', () => {
    const now = new Date('2026-10-26T19:43:00Z');
    const current = resolveWhatsappCostPeriod('current', now);
    expect(current.month).toBe('2026-10');
    expect(new Date(current.start * 1000).toISOString()).toBe('2026-10-01T03:00:00.000Z');
    expect(current.end).toBe(Math.floor(now.getTime() / 1000));
    expect(current.partial).toBe(true);
    const previous = resolveWhatsappCostPeriod('previous', now);
    expect(previous.month).toBe('2026-09');
    expect(new Date(previous.start * 1000).toISOString()).toBe('2026-09-01T03:00:00.000Z');
    expect(new Date(previous.end * 1000).toISOString()).toBe('2026-10-01T03:00:00.000Z');
    expect(previous.partial).toBe(false);
  });
  it('handles local month and year rollover independently of UTC', () => {
    const atNewYear = new Date('2027-01-01T02:00:00Z');
    expect(resolveWhatsappCostPeriod('current', atNewYear).month).toBe('2026-12');
    expect(resolveWhatsappCostPeriod('previous', new Date('2027-01-01T04:00:00Z')).month).toBe('2026-12');
  });
  it('accepts a supported historical month and rejects invalid, future or too old months', () => {
    const now = new Date('2026-10-26T19:43:00Z');
    expect(resolveWhatsappCostPeriod('2025-11', now).month).toBe('2025-11');
    for (const input of ['2025-10', '2026-11', '2026-13', 'invalid']) expect(() => resolveWhatsappCostPeriod(input, now)).toThrow();
  });
});
