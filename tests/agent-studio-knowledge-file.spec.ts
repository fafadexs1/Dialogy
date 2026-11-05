import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { extractStudioKnowledgeFile } from '@/services/agent-studio/knowledge-file';

describe('Studio knowledge file ingestion', () => {
  it('extracts a bounded UTF-8 text file and records its exact revision hash', async () => {
    const content = '# Política\r\nAtendimento de segunda a sexta.';
    const result = await extractStudioKnowledgeFile(new File([content], 'politica.md', { type: 'text/markdown' }));
    expect(result).toMatchObject({ name: 'politica.md', fileName: 'politica.md', mimeType: 'text/markdown' });
    expect(result.content).toBe('# Política\nAtendimento de segunda a sexta.');
    expect(result.contentHash).toBe(createHash('sha256').update(result.content).digest('hex'));
  });

  it('rejects unsupported, oversized, invalid UTF-8 and fake PDF files', async () => {
    await expect(extractStudioKnowledgeFile(new File(['x'], 'arquivo.exe'))).rejects.toThrow('PDF, TXT');
    await expect(extractStudioKnowledgeFile(new File([new Uint8Array(2_000_001)], 'grande.txt'))).rejects.toThrow('2 MB');
    await expect(extractStudioKnowledgeFile(new File([new Uint8Array([0xff, 0xfe])], 'invalido.txt'))).rejects.toThrow('UTF-8');
    await expect(extractStudioKnowledgeFile(new File(['não é pdf'], 'falso.pdf'))).rejects.toThrow('assinatura PDF');
  });

  it('extracts a Word document and an Excel workbook using bounded archives', async () => {
    const docx = readFileSync('tests/fixtures/studio-knowledge.docx');
    const xlsx = readFileSync('tests/fixtures/campaign-sgp-report.xlsx');
    const word = await extractStudioKnowledgeFile(new File([docx], 'politica.docx'));
    const excel = await extractStudioKnowledgeFile(new File([xlsx], 'relatorio.xlsx'));
    expect(word.content).toContain('Atendimento de segunda a sexta.');
    expect(word.mimeType).toContain('wordprocessingml');
    expect(excel.content.length).toBeGreaterThan(20);
    expect(excel.mimeType).toContain('spreadsheetml');
    await expect(extractStudioKnowledgeFile(new File(['fake'], 'falso.docx'))).rejects.toThrow('Office');
  });

  it('cleans and normalizes noisy text with hyphenated linebreaks and extra spaces', async () => {
    const { cleanDocumentText } = await import('@/services/agent-studio/knowledge-file');
    const dirty = 'Este ser-\nviço possui   horário\n\n\n\ncomercial.';
    const cleaned = cleanDocumentText(dirty);
    expect(cleaned).toBe('Este serviço possui horário\n\ncomercial.');
  });
});
