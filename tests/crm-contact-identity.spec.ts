import { describe, expect, it } from 'vitest';

import {
  resolveWhatsappJidForContactSave,
  shouldKeepCurrentWhatsappJidOnUpdate,
} from '@/lib/crm-contact-identity';

describe('crm contact identity', () => {
  it('treats whatsapp numbers with and without the ninth digit as the same contact', () => {
    expect(
      shouldKeepCurrentWhatsappJidOnUpdate(
        '556184734944@s.whatsapp.net',
        '5561984734944@s.whatsapp.net'
      )
    ).toBe(true);
  });

  it('keeps the current stored jid when an equivalent contact already exists', () => {
    expect(
      resolveWhatsappJidForContactSave({
        currentJid: '556184734944@s.whatsapp.net',
        nextJid: '5561984734944@s.whatsapp.net',
        hasEquivalentConflict: true,
      })
    ).toBe('556184734944@s.whatsapp.net');
  });

  it('normalizes to the canonical jid when there is no equivalent conflict', () => {
    expect(
      resolveWhatsappJidForContactSave({
        currentJid: '556184734944@s.whatsapp.net',
        nextJid: '556184734944@s.whatsapp.net',
        hasEquivalentConflict: false,
      })
    ).toBe('5561984734944@s.whatsapp.net');
  });

  it('does not treat distinct numbers as the same identity', () => {
    expect(
      shouldKeepCurrentWhatsappJidOnUpdate(
        '556184734944@s.whatsapp.net',
        '5561912345678@s.whatsapp.net'
      )
    ).toBe(false);
  });
});
