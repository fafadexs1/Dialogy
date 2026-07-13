import { describe, expect, it } from 'vitest';
import type { Contact } from '@/lib/types';
import { buildStructuredKnownFields } from '@/services/autopilot/runtime/process-chat';

describe('autopilot structured known fields', () => {
  it('does not resurrect an old CRM identifier after the customer supplied an invalid replacement', () => {
    const contact = {
      id: 'contact-1',
      workspace_id: 'workspace-1',
      name: 'Ana',
      custom_fields: {
        CPF: '529.982.247-25',
        'field-cpf-id': '529.982.247-25',
        Empresa: 'Dialogy',
      },
    } as Contact;

    const known = buildStructuredKnownFields(contact, { name: 'Ana' }, [{
      name: 'customer_identifier',
      value: '111.111.111-11',
      reason: 'CPF inválido',
    }]);

    expect(known.customer_identifier).toBeUndefined();
    expect(known.CPF).toBeUndefined();
    expect(known['field-cpf-id']).toBeUndefined();
    expect(known.Empresa).toBe('Dialogy');
  });

  it('retains a previously known valid identifier when no replacement was supplied', () => {
    const contact = {
      id: 'contact-1',
      workspace_id: 'workspace-1',
      name: 'Ana',
      custom_fields: { CPF: '529.982.247-25' },
    } as Contact;

    expect(buildStructuredKnownFields(contact, {}, []).CPF).toBe('529.982.247-25');
  });
});
