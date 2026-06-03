import { describe, expect, it } from 'vitest';

import {
  extractAutopilotSlots,
  isValidCustomerIdentifier,
  normalizeCustomerIdentifier,
} from '@/services/autopilot/slots';
import type { Contact } from '@/lib/types';

describe('autopilot slot extraction', () => {
  it('extracts and validates CPF/CNPJ identifiers from the message', () => {
    const result = extractAutopilotSlots({
      customerMessage: 'Meu CPF e 529.982.247-25',
    });

    expect(result.slots.customer_identifier).toBe('52998224725');
    expect(result.invalidSlots).toHaveLength(0);
    expect(isValidCustomerIdentifier('52998224725')).toBe(true);
    expect(normalizeCustomerIdentifier('529.982.247-25')).toBe('52998224725');
  });

  it('rejects invalid CPF/CNPJ identifiers', () => {
    const result = extractAutopilotSlots({
      customerMessage: 'CPF 111.111.111-11',
    });

    expect(result.slots.customer_identifier).toBeUndefined();
    expect(result.invalidSlots[0]).toMatchObject({ name: 'customer_identifier' });
  });

  it('does not block a new turn because an older history identifier was invalid', () => {
    const result = extractAutopilotSlots({
      customerMessage: 'Quais sao meus contratos?',
      chatHistory: 'Cliente: 111.111.111-11\nAtendente: Vou consultar.',
    });

    expect(result.slots.customer_identifier).toBeUndefined();
    expect(result.invalidSlots).toHaveLength(0);
  });

  it('uses contact custom fields when the identifier is already known', () => {
    const contact = {
      id: 'contact-1',
      workspace_id: 'workspace-1',
      name: 'Cliente',
      custom_fields: {
        'field-id': '529.982.247-25',
      },
    } satisfies Contact;

    const result = extractAutopilotSlots({
      customerMessage: 'Quero a segunda via',
      contact,
    });

    expect(result.slots.customer_identifier).toBe('52998224725');
    expect(result.details.find((detail) => detail.name === 'customer_identifier')?.source).toBe('contact');
  });

  it('extracts date, time and protocol slots', () => {
    const result = extractAutopilotSlots({
      customerMessage: 'Pode agendar amanha 14h30? Protocolo ABCD-1234',
      now: new Date(2026, 4, 5),
    });

    expect(result.slots.date).toBe('2026-05-06');
    expect(result.slots.time).toBe('14:30');
    expect(result.slots.order_or_request_id).toBe('ABCD-1234');
  });

  it('extracts generic intake slots from message and history', () => {
    const result = extractAutopilotSlots({
      customerMessage: 'Meu telefone e o mesmo que estou falando contigo',
      chatHistory: [
        'Cliente: Ta certo, quero agendar manutencao preventiva.',
        'Cliente: Meu nome completo e Fabricio de Sousa Soares',
        'Cliente: CPF 529.982.247-25',
        'Cliente: Quadra 12, Lote 13, Morada das Garcas, Cidade Ocidental',
      ].join('\n'),
      contact: {
        id: 'contact-1',
        workspace_id: 'workspace-1',
        name: '',
        phone: '5561995215930',
        phone_number_jid: '5561995215930@s.whatsapp.net',
      } as any,
    });

    expect(result.slots.product_or_service_preference).toContain('manutencao preventiva');
    expect(result.slots.name).toBe('Fabricio de Sousa Soares');
    expect(result.slots.customer_identifier).toBe('52998224725');
    expect(result.slots.address).toContain('Quadra 12');
    expect(result.slots.phone).toBe('5561995215930');
  });
});
