import { describe, expect, it } from 'vitest';
import mammoth from 'mammoth';
import { generateToolboxDocument } from '@/modules/nexus/services/toolbox-documents';

describe('documentos Word do agente', () => {
  it('gera DOCX legível com acentos e parágrafos', async () => {
    const document = await generateToolboxDocument('docx', { text: 'Olá, equipe!\nSegunda linha.' });
    expect(document.mimeType).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    const parsed = await mammoth.extractRawText({ buffer: document.data });
    expect(parsed.value).toContain('Olá, equipe!');
    expect(parsed.value).toContain('Segunda linha.');
  });
  it('recusa texto vazio, grande ou com caracteres inválidos em XML', async () => {
    for (const text of ['', 'x'.repeat(40_001), 'texto\u0001']) await expect(generateToolboxDocument('docx', { text })).rejects.toThrow();
  });
});
