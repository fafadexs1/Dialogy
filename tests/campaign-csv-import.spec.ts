import { describe, expect, it } from 'vitest';
import { parseCampaignContactRows, parseCampaignContactsCsv } from '@/lib/campaigns/csv-import';
import { normalizeCampaignPhoneNumbers } from '@/lib/campaigns/import-phones';

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

  it('preserves all original columns and text values for template mapping', () => {
    const result = parseCampaignContactsCsv('Cliente;Telefones;Valor da fatura;Vencimento;Código\nMaria;(61) 98413-3192;"R$ 1.234,56";05/11;00042');
    expect(result.columns).toEqual(['Cliente', 'Telefones', 'Valor da fatura', 'Vencimento', 'Código']);
    expect(result.contacts[0].csvData).toEqual({
      Cliente: 'Maria', Telefones: '(61) 98413-3192', 'Valor da fatura': 'R$ 1.234,56', Vencimento: '05/11', Código: '00042',
    });
    expect(result.contacts[0].phone).toBe('5561984133192');
  });

  it('splits multiple phones into recipients while keeping the same source row and columns', () => {
    const result = parseCampaignContactsCsv('Cliente,Telefones\nFabio,(61) 98413-3192 (61) 99521-5930');
    expect(result.contacts.map(contact => contact.phone)).toEqual(['5561984133192', '5561995215930']);
    expect(result.contacts.map(contact => contact.sourceRow)).toEqual([2, 2]);
    expect(result.contacts[0].csvData).toEqual(result.contacts[1].csvData);
    expect(result.invalidRows).toBe(0);
    expect(result.expandedRows).toBe(1);
    expect(result.totalRows).toBe(1);
    expect(result.columns).toEqual(['Cliente', 'Telefones']);
  });

  it('rejects an ambiguous digit sequence instead of slicing it into invented phone numbers', () => {
    const result = parseCampaignContactsCsv('Cliente,Telefones\nFabio,6198413319261995215930');
    expect(result.contacts).toEqual([]);
    expect(result.invalidRows).toBe(1);
    expect(result.headerRow).toBe(1);
  });

  it('detects an SGP table below a summary without importing totals, CPF or document columns as phones', () => {
    const result = parseCampaignContactRows([
      [], [], [null, 'Títulos Atrasados'], [], [null, null, 'Total Títulos', 'Valor Total'],
      [null, null, 2, 250.30], [],
      ['Contrato', 'Cliente', 'CPF/CNPJ', 'N. Documento', 'Vencimento', 'Valor', 'Telefones'],
      ['00042', 'Maria', '111.222.333-44', '000001', new Date('2026-11-05T00:00:00Z'), 99.90000000000001, '(61) 98413-3192 (61) 99521-5930'],
      ['00043', 'João', '111.222.333-44', '000002', '10/11/2026', 150.4, '(61) 99177-6043'],
    ]);
    expect(result.headerRow).toBe(8);
    expect(result.contacts).toHaveLength(3);
    expect(result.totalRows).toBe(2);
    expect(result.invalidRows).toBe(0);
    expect(result.contacts[0].sourceRow).toBe(9);
    expect(result.contacts[0].csvData).toMatchObject({ Contrato: '00042', 'N. Documento': '000001', Valor: '99,90', Vencimento: '05/11/2026' });
  });

  it('combines multiple phone columns and skips a missing phone without falling back to CPF', () => {
    const result = parseCampaignContactsCsv('Cliente;CPF/CNPJ;Telefone 1;Celular\nMaria;11122233344;61984133192;61995215930\nJoão;11977776666;;');
    expect(result.contacts).toHaveLength(2);
    expect(result.invalidRows).toBe(1);
    expect(result.expandedRows).toBe(1);
  });

  it('detects a semicolon CSV report header even when the title and summary have different widths', () => {
    const result = parseCampaignContactsCsv('\n\nTítulos Atrasados\n\nTotal Títulos;Valor Total\n2;200\n\nCliente;Telefones;Valor\nMaria;(61) 98413-3192;100,00\nJoão;(61) 99521-5930;100,00');
    expect(result.headerRow).toBe(8);
    expect(result.totalRows).toBe(2);
    expect(result.contacts[0].csvData).toEqual({ Cliente: 'Maria', Telefones: '(61) 98413-3192', Valor: '100,00' });
  });

  it('does not infer phone numbers from unknown multi-column report data', () => {
    const result = parseCampaignContactRows([['Nome', 'CPF/CNPJ', 'Contrato'], ['Maria', '11977776666', '1234567890']]);
    expect(result.contacts).toEqual([]);
  });

  it.each([
    ['61 98413-3192; 61 99521-5930', ['5561984133192', '5561995215930']],
    ['(61)993292976 (61) 99124-6678', ['5561993292976', '5561991246678']],
    ['(61) 96050-090 / (61) 99263-9823', ['556196050090', '5561992639823']],
    ['(61)9922-59772', ['5561992259772']],
    ['0055 61 98413-3192', ['5561984133192']],
    ['+351 912 345 678', ['351912345678']],
    ['351912345678', ['351912345678']],
    ['5561984133192@s.whatsapp.net', ['5561984133192']],
    ['(00) 99999-9999', []],
    ['98413-3192', []],
    ['6.1984133192E+10', []],
  ])('normalizes %s without concatenation or a guessed DDD', (value, expected) => {
    expect(normalizeCampaignPhoneNumbers(value)).toEqual(expected);
  });

  it('keeps the first row values for a duplicate phone and preserves empty cells', () => {
    const result = parseCampaignContactsCsv('Nome,Telefone,Valor\nMaria,5561984133192,\nMaria,5561984133192,100');
    expect(result.contacts[0].csvData.Valor).toBe('');
    expect(result.duplicateRows).toBe(1);
    expect(result.invalidRows).toBe(0);
  });
});
