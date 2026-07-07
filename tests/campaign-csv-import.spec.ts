import { describe, expect, it } from 'vitest';
import { parseCampaignContactsCsv } from '@/lib/campaigns/csv-import';

describe('campaign CSV import', () => {
  it('imports Portuguese headers and normalizes local Brazilian WhatsApp numbers', () => {
    const result = parseCampaignContactsCsv([
      'nome;telefone',
      'Maria;(11) 99999-9999',
      'Joao;21988887777',
    ].join('\n'));

    expect(result.errors).toEqual([]);
    expect(result.contacts).toHaveLength(2);
    expect(result.contacts.map(contact => contact.phone_number_jid)).toEqual([
      '5511999999999@s.whatsapp.net',
      '5521988887777@s.whatsapp.net',
    ]);
  });

  it('deduplicates repeated contacts and counts invalid rows', () => {
    const result = parseCampaignContactsCsv([
      'name,whatsapp',
      'Ana,+55 11 98888-7777',
      'Ana duplicada,5511988887777',
      'Sem telefone,abc',
    ].join('\n'));

    expect(result.contacts).toHaveLength(1);
    expect(result.duplicateRows).toBe(1);
    expect(result.invalidRows).toBe(1);
  });

  it('supports headerless CSV files', () => {
    const result = parseCampaignContactsCsv([
      'Carlos,11977776666',
      '5585987654321,Luiza',
    ].join('\n'));

    expect(result.contacts.map(contact => contact.name)).toEqual(['Carlos', 'Luiza']);
    expect(result.contacts.map(contact => contact.phone_number_jid)).toEqual([
      '5511977776666@s.whatsapp.net',
      '5585987654321@s.whatsapp.net',
    ]);
  });
});
