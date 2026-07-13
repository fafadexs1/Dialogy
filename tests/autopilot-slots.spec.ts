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

  it('does not parse an agent name prefixed with Ticket as an order id', () => {
    const result = extractAutopilotSlots({
      customerMessage: 'Oi',
      chatHistory: 'Atendimento transferido para TicketMaster.',
    });

    expect(result.slots.order_or_request_id).toBeUndefined();
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

  it('extracts name, CEP and phone from the same labelled message without mixing values', () => {
    const result = extractAutopilotSlots({
      customerMessage: 'Nome: João da Silva; CEP: 72800-123; WhatsApp: (61) 99999-1111',
      chatHistory: 'Atendente: Informe seu nome completo, CEP e telefone.',
    });

    expect(result.slots.name).toBe('João da Silva');
    expect(result.slots.address).toBe('CEP 72800-123');
    expect(result.slots.phone).toBe('61999991111');
  });

  it.each(['Ana', 'Ivo', 'Lia', 'Zoë'])('keeps a short Unicode name in a multi-field reply: %s', (name) => {
    const result = extractAutopilotSlots({
      customerMessage: `Nome: ${name}; CEP: 01310-100; telefone: (11) 99999-0000`,
      chatHistory: 'Atendente: Informe nome, CEP e telefone.',
    });

    expect(result.slots.name).toBe(name);
    expect(result.slots.address).toBe('CEP 01310-100');
    expect(result.slots.phone).toBe('11999990000');
    expect(result.invalidSlots).toHaveLength(0);
  });

  it('does not mistake an explicitly labelled 11-digit phone for an invalid CPF', () => {
    const result = extractAutopilotSlots({
      customerMessage: 'Nome: Ana; CEP: 01310-100; telefone: 11999999999',
      chatHistory: 'Atendente: Informe nome, CEP e telefone.',
    });

    expect(result.slots.phone).toBe('11999999999');
    expect(result.slots.customer_identifier).toBeUndefined();
    expect(result.invalidSlots).toHaveLength(0);
  });

  it('lets an explicit new CEP replace the remembered CEP', () => {
    const result = extractAutopilotSlots({
      customerMessage: 'Meu CEP agora é 01310-100',
      rememberedSlots: { address: 'CEP 72800-123' },
    });

    expect(result.slots.address).toBe('CEP 01310-100');
  });

  it('appends a complement without duplicating the remembered address', () => {
    const result = extractAutopilotSlots({
      customerMessage: 'Complemento: bloco B, apto 12',
      rememberedSlots: { address: 'Rua das Flores 10, CEP 72800-123' },
    });

    expect(result.slots.address).toBe('Rua das Flores 10, CEP 72800-123; Complemento: bloco B, apto 12');
  });

  it('lets an explicit new address replace an older remembered address even without a CEP', () => {
    const result = extractAutopilotSlots({
      customerMessage: 'Meu endereço é Rua Nova 99',
      rememberedSlots: { address: 'Rua Antiga 10, CEP 72800-123' },
    });

    expect(result.slots.address).toBe('Rua Nova 99');
  });

  it('prefers corrected memory to stale contact fields on a new chat', () => {
    const result = extractAutopilotSlots({
      customerMessage: 'Quero continuar.',
      contact: {
        id: 'contact-1',
        workspace_id: 'workspace-1',
        name: 'Nome Antigo',
        phone: '11900000000',
        address: 'Rua Antiga 1',
      } as Contact,
      rememberedSlots: {
        name: 'Nome Corrigido',
        phone: '11999999999',
        address: 'Rua Nova 2',
      },
    });

    expect(result.slots).toMatchObject({
      name: 'Nome Corrigido',
      phone: '11999999999',
      address: 'Rua Nova 2',
    });
  });

  it('does not fall back to an old identifier when the customer supplies a new invalid one', () => {
    const result = extractAutopilotSlots({
      customerMessage: 'Meu CPF novo é 111.111.111-11',
      rememberedSlots: { customer_identifier: '52998224725' },
    });

    expect(result.invalidSlots).toHaveLength(1);
    expect(result.slots.customer_identifier).toBeUndefined();
  });

  it.each([
    'estou verificando CEP 72800-123',
    'ainda não achei CEP 72800-123',
    'quero internet no CEP 72800-123',
    'apenas consulte o CEP 72800-123',
  ])('does not invent a name from a non-name composite reply: %s', (customerMessage) => {
    const result = extractAutopilotSlots({
      customerMessage,
      chatHistory: 'Atendente: Informe seu nome e CEP.',
    });

    expect(result.slots.name).toBeUndefined();
  });

  it('uses the preceding question to split an unlabelled name and CEP reply', () => {
    const result = extractAutopilotSlots({
      customerMessage: 'João da Silva 72800-123',
      chatHistory: 'Atendente: Para continuar, informe seu nome completo e o CEP.',
    });

    expect(result.slots.name).toBe('João da Silva');
    expect(result.slots.address).toBe('CEP 72800-123');
  });

  it('hydrates known fields from contact CRM labels and structured cross-chat memory', () => {
    const result = extractAutopilotSlots({
      customerMessage: 'Quero continuar de onde paramos.',
      contact: {
        id: 'contact-1',
        workspace_id: 'workspace-1',
        name: 'Cliente',
        custom_fields: { CEP: '72800-123' },
      } as Contact,
      rememberedSlots: {
        name: 'João da Silva',
        phone: '61999991111',
      },
    });

    expect(result.slots).toMatchObject({
      name: 'João da Silva',
      address: 'CEP 72800-123',
      phone: '61999991111',
    });
    expect(result.details.find((detail) => detail.name === 'name')?.source).toBe('memory');
  });

  it('does not extract a requested field from the attendant question itself', () => {
    const result = extractAutopilotSlots({
      customerMessage: 'Ainda vou procurar.',
      chatHistory: [
        'Atendente: Qual é o seu CEP?',
        'Cliente: Ainda nao encontrei.',
      ].join('\n'),
    });

    expect(result.slots.address).toBeUndefined();
  });
});
