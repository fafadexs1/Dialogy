import { describe, expect, it } from 'vitest';

import { sanitizeNationalPhoneInput } from '@/lib/phone-input';

describe('national phone input', () => {
  it('removes Brazil country code from a complete international number', () => {
    expect(sanitizeNationalPhoneInput('+55 (61) 99952-1599', '55')).toBe('61999521599');
  });

  it('keeps a Brazilian local number whose area code is 55', () => {
    expect(sanitizeNationalPhoneInput('(55) 99952-1599', '55')).toBe('55999521599');
  });

  it('also avoids duplicating another selected country code', () => {
    expect(sanitizeNationalPhoneInput('+351 912 345 678', '351')).toBe('912345678');
  });
});
