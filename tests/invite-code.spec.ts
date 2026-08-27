import { describe, expect, it } from 'vitest';
import { normalizeInviteCode } from '@/lib/invite-code';

describe('normalizeInviteCode', () => {
  it('extracts and normalizes a code from a full invite link', () => {
    expect(normalizeInviteCode(' https://app.dialogy.com/join/ab12cd34 ')).toBe('AB12CD34');
  });

  it('accepts code query parameters and removes accidental spaces', () => {
    expect(normalizeInviteCode('https://app.dialogy.com/join?code=ab 12 cd 34')).toBe('AB12CD34');
  });

  it('keeps a direct code usable', () => {
    expect(normalizeInviteCode('  ab12cd34  ')).toBe('AB12CD34');
  });
});

