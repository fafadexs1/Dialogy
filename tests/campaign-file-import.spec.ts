import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parseCampaignContactsFile } from '@/lib/campaigns/file-import';
import { renderCampaignTemplatePreview } from '@/lib/campaigns/personalization';

function importFile(name: string, bytes: Uint8Array) {
  return { name, size: bytes.byteLength, arrayBuffer: async () => Uint8Array.from(bytes).buffer };
}

describe('campaign spreadsheet files', () => {
  it('reads a real XLSX export, finds the SGP table and retains formatted values for Meta parameters', async () => {
    // Synthetic names/documents only; never persist client spreadsheet data in the test suite.
    const result = await parseCampaignContactsFile(importFile('sgp.xlsx', await readFile('tests/fixtures/campaign-sgp-report.xlsx')));
    expect(result.sheetName).toBe('Atrasados');
    expect(result.headerRow).toBe(8);
    expect(result.totalRows).toBe(4);
    expect(result.invalidRows).toBe(1);
    expect(result.expandedRows).toBe(1);
    expect(result.contacts.map(contact => contact.phone)).toEqual(['5561984133192', '5561995215930', '5561991776043', '351912345678']);
    expect(result.contacts[0].csvData).toMatchObject({ Contrato: '00042', 'N. Documento': '000001', Valor: '99,90', 'Valor Corrigido': '103,93' });
    expect(result.contacts[3].csvData).toMatchObject({ Vencimento: '05/11/2026', Valor: '0,00' });
    expect(renderCampaignTemplatePreview({
      name: 'cobranca', language: 'pt_BR', components: [{ type: 'BODY', text: 'Olá {{1}}, valor {{2}} até {{3}}.' }],
      bodyParameterColumns: ['Cliente', 'Valor Corrigido', 'Vencimento'], bodyParameterValues: ['', '', ''],
    }, { csvData: result.contacts[0].csvData })).toBe('Olá Maria Silva, valor 103,93 até 05/11/2026.');
  });

  it('keeps simple CSV and headerless CSV imports working through the same upload path', async () => {
    const encoder = new TextEncoder();
    for (const csv of ['Nome,Telefone\nMaria,5561984133192', 'Maria,61984133192']) {
      const result = await parseCampaignContactsFile(importFile('clientes.CSV', encoder.encode(csv)));
      expect(result.contacts[0]).toMatchObject({ name: 'Maria', phone: '5561984133192' });
      expect(result.invalidRows).toBe(0);
    }
  });

  it('decodes old Windows-1252 CSV exports without corrupting names and column labels', async () => {
    const bytes = Buffer.from('Cliente;Telefone;Emiss\xe3o\nJo\xe3o;61984133192;23/10/2026', 'latin1');
    const result = await parseCampaignContactsFile(importFile('sgp.csv', bytes));
    expect(result.contacts[0].name).toBe('João');
    expect(result.columns).toContain('Emissão');
  });

  it('reports unsupported, oversized and corrupt files without importing recipients', async () => {
    await expect(parseCampaignContactsFile(importFile('report.xls', new Uint8Array()))).rejects.toThrow('CSV ou Excel');
    await expect(parseCampaignContactsFile({ name: 'report.xlsx', size: 11 * 1024 * 1024, arrayBuffer: async () => { throw new Error('Must not read'); } })).rejects.toThrow('10 MB');
    await expect(parseCampaignContactsFile(importFile('report.xlsx', new TextEncoder().encode('not an Excel workbook')))).rejects.toThrow('Não foi possível ler o Excel');
  });
});
