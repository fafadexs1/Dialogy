import 'server-only';

import { createHash } from 'node:crypto';
import { assertBoundedSpreadsheetArchive } from '@/modules/nexus/services/spreadsheet-limits';
import { convertLegacyOffice } from '@/modules/nexus/services/legacy-office';
import { extractPresentationText } from './presentation-text';

const MAX_FILE_BYTES = 2_000_000;
const MAX_CONTENT_CHARACTERS = 100_000;
const textExtensions = new Set(['txt', 'md', 'csv', 'json']);

function extension(name: string) {
  return name.toLowerCase().split('.').pop() || '';
}

import { cleanDocumentText } from './knowledge-text';
export { cleanDocumentText };

function cleanExtractedText(value: string) {
  const content = cleanDocumentText(value);
  if (!content) throw new Error('O arquivo não contém texto utilizável.');
  if (content.length > MAX_CONTENT_CHARACTERS) throw new Error('O texto extraído excede 100 mil caracteres. Divida o conteúdo em fontes menores.');
  return content;
}

export async function extractStudioKnowledgeFile(file: File) {
  if (!file.name || file.size <= 0 || file.size > MAX_FILE_BYTES) throw new Error('Selecione um arquivo de até 2 MB.');
  const originalSuffix = extension(file.name);
  let suffix = originalSuffix;
  let data = new Uint8Array(await file.arrayBuffer());
  if (suffix === 'doc' || suffix === 'xls') {
    data = new Uint8Array(await convertLegacyOffice(Buffer.from(data), suffix));
    suffix = suffix === 'doc' ? 'docx' : 'xlsx';
  }
  let content = '';
  let extractedPages: Array<{ number: number; content: string }> | undefined;
  let extractedSlides: Array<{ number: number; content: string }> | undefined;
  if (textExtensions.has(suffix)) {
    try { content = new TextDecoder('utf-8', { fatal: true }).decode(data); }
    catch { throw new Error('O arquivo de texto precisa estar codificado em UTF-8.'); }
  } else if (suffix === 'docx' || suffix === 'xlsx') {
    // Both formats are ZIP containers. Validate expanded sizes before invoking
    // third-party parsers so a small upload cannot expand without bounds.
    try { assertBoundedSpreadsheetArchive(Buffer.from(data)); }
    catch { throw new Error('O arquivo Office é inválido ou excede os limites de descompactação.'); }
    if (suffix === 'docx') {
      const mammoth = await import('mammoth');
      const result = await mammoth.extractRawText({ buffer: Buffer.from(data) });
      content = result.value;
    } else {
      const { default: readExcel } = await import('read-excel-file/universal');
      const sheets = await readExcel(data.buffer as ArrayBuffer, { trim: false });
      if (sheets.length > 20) throw new Error('A planilha excede o limite de 20 abas.');
      content = sheets.map((sheet) => {
        if (sheet.data.length > 1001 || sheet.data.some((row) => row.length > 100)) throw new Error('A planilha excede 1.000 linhas ou 100 colunas por aba.');
        return [sheet.sheet, ...sheet.data.map((row) => row.map((cell) => cell instanceof Date ? cell.toISOString() : String(cell ?? '')).join('\t'))].join('\n');
      }).join('\n\n');
    }
  } else if (suffix === 'pptx') {
    const presentation = extractPresentationText(Buffer.from(data));
    content = presentation.content; extractedSlides = presentation.slides;
  } else if (suffix === 'pdf') {
    if (new TextDecoder().decode(data.slice(0, 5)) !== '%PDF-') throw new Error('O arquivo não possui uma assinatura PDF válida.');
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const task = pdfjs.getDocument({ data, useSystemFonts: true });
    try {
      const pdf = await task.promise;
      if (pdf.numPages > 100) throw new Error('O PDF excede o limite de 100 páginas.');
      const pages: string[] = [];
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        const text = await (await pdf.getPage(pageNumber)).getTextContent();
        const pageLines: string[] = [];
        let currentLine = '';
        for (const item of text.items) {
          if ('str' in item && typeof item.str === 'string') {
            currentLine += item.str;
            if ('hasEOL' in item && item.hasEOL) {
              pageLines.push(currentLine);
              currentLine = '';
            }
          }
        }
        if (currentLine.trim()) pageLines.push(currentLine);
        const pageContent = pageLines.length > 0
          ? pageLines.join('\n')
          : text.items.flatMap((item) => 'str' in item ? [item.str] : []).join(' ');
        pages.push(pageContent);
        if (pages.join('\n').length > MAX_CONTENT_CHARACTERS) throw new Error('O texto extraído excede 100 mil caracteres. Divida o conteúdo em fontes menores.');
      }
      content = pages.join('\n\n');
      extractedPages = pages.map((page, index) => ({ number: index + 1, content: cleanDocumentText(page) }));
    } finally { await task.destroy(); }
  } else {
    throw new Error('Use PDF, TXT, Markdown, CSV, JSON, DOC, DOCX, XLS, XLSX ou PPTX.');
  }
  content = cleanExtractedText(content);
  return { name: file.name.replace(/[\\/]/g, '_').slice(0, 200), content, fileName: file.name.replace(/[\\/]/g, '_').slice(0, 255),
    mimeType: file.type || ({ pdf: 'application/pdf', doc: 'application/msword', xls: 'application/vnd.ms-excel', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }[originalSuffix] || 'text/plain'), importedAt: new Date().toISOString(),
    contentHash: createHash('sha256').update(content).digest('hex'), ...(extractedPages ? { pages: extractedPages } : {}), ...(extractedSlides ? { slides: extractedSlides } : {}) };
}
