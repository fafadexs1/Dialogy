import { describe, expect, it } from 'vitest';

import {
  buildContactThreadIdentity,
  getContactThreadIdentityKey,
  mergeEquivalentContacts,
} from '@/lib/whatsapp/contact-thread';
import type { Contact } from '@/lib/types';

function contact(input: Partial<Contact> & Pick<Contact, 'id'>): Contact {
  return {
    id: input.id,
    workspace_id: input.workspace_id || 'ws-1',
    name: input.name || 'Contato',
    avatar_url: input.avatar_url,
    email: input.email,
    phone: input.phone,
    phone_number_jid: input.phone_number_jid,
    address: input.address,
    custom_fields: input.custom_fields,
  };
}

describe('whatsapp contact thread identity', () => {
  it('uses one identity key for equivalent whatsapp contact records', () => {
    const withoutNinthDigit = contact({
      id: 'contact-a',
      phone_number_jid: '556194295752@s.whatsapp.net',
    });
    const withNinthDigit = contact({
      id: 'contact-b',
      phone_number_jid: '5561994295752@c.us',
    });

    expect(getContactThreadIdentityKey(withoutNinthDigit)).toBe(
      getContactThreadIdentityKey(withNinthDigit)
    );
  });

  it('merges duplicated contact records without discarding their ids', () => {
    const merged = mergeEquivalentContacts([
      contact({
        id: 'contact-number-name',
        name: '556194295752',
        phone_number_jid: '556194295752@s.whatsapp.net',
      }),
      contact({
        id: 'contact-person-name',
        name: 'WANDRE RAMOS ALKIMIN',
        email: 'wandre@example.com',
        avatar_url: 'https://example.com/avatar.png',
        phone_number_jid: '5561994295752@s.whatsapp.net',
      }),
      contact({
        id: 'contact-other',
        name: 'Outra pessoa',
        phone_number_jid: '5561912345678@s.whatsapp.net',
      }),
    ]);

    expect(merged).toHaveLength(2);
    expect(merged[0]?.id).toBe('contact-person-name');
    expect(merged[0]?.name).toBe('WANDRE RAMOS ALKIMIN');
    expect(merged[0]?.relatedContactIds).toEqual([
      'contact-number-name',
      'contact-person-name',
    ]);
    expect(merged[0]?.relatedContactCount).toBe(2);
    expect(merged[1]?.id).toBe('contact-other');
  });

  it('builds a contact thread identity for opening aggregated history', () => {
    const thread = buildContactThreadIdentity([
      contact({
        id: 'contact-a',
        name: '5',
        phone_number_jid: '556194295752@s.whatsapp.net',
      }),
      contact({
        id: 'contact-b',
        name: 'WANDRE RAMOS ALKIMIN',
        phone_number_jid: '5561994295752@s.whatsapp.net',
      }),
    ]);

    expect(thread?.identityKey).toBe('whatsapp:5561994295752');
    expect(thread?.primaryContactId).toBe('contact-b');
    expect(thread?.contactIds).toEqual(['contact-a', 'contact-b']);
  });
});
