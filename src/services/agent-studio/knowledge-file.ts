import 'server-only';

import { createHash } from 'node:crypto';

const MAX_FILE_BYTES = 2_000_000;
const MAX_CONTENT_CHARACTERS = 100_000;
const textExtensions = new Set(['txt', 'md', 'csv', 'json']);

function extension(name: string) {
  return name.toLowerCase().split('.').pop() || '';
}

function cleanExtractedText(value: string) {
  const content = value.replace(/\0/g, '').replace(/\r\n?/g, '\n').trim();
  if (!content) throw new Error('O arquivo não contém texto utilizável.');
  if (content.length > MAX_CONTENT_CHARACTERS) throw new Error('O texto extraído excede 100 mil caracteres. Divida o conteúdo em fontes menores.');
  return content;
}

export async function extractStudioKnowledgeFile(file: File) {
  if (!file.name || file.size <= 0 || file.size > MAX_FILE_BYTES) throw new Error('Selecione um arquivo de até 2 MB.');
  const suffix = extension(file.name);
  const data = new Uint8Array(await file.arrayBuffer());
  let content = '';
  let extractedPages: Array<{ number: number; content: string }> | undefined;
  if (textExtensions.has(suffix)) {
    try { content = new TextDecoder('utf-8', { fatal: true }).decode(data); }
    catch { throw new Error('O arquivo de texto precisa estar codificado em UTF-8.'); }
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
        pages.push(text.items.flatMap((item) => 'str' in item ? [item.str] : []).join(' '));
        if (pages.join('\n').length > MAX_CONTENT_CHARACTERS) throw new Error('O texto extraído excede 100 mil caracteres. Divida o conteúdo em fontes menores.');
      }
      content = pages.join('\n\n');
      extractedPages = pages.map((page, index) => ({ number: index + 1, content: page.replace(/\0/g, '').replace(/\r\n?/g, '\n').trim() }));
    } finally { await task.destroy(); }
  } else {
    throw new Error('Use PDF, TXT, Markdown, CSV ou JSON.');
  }
  content = cleanExtractedText(content);
  return { name: file.name.replace(/[\\/]/g, '_').slice(0, 200), content, fileName: file.name.replace(/[\\/]/g, '_').slice(0, 255),
    mimeType: file.type || (suffix === 'pdf' ? 'application/pdf' : 'text/plain'), importedAt: new Date().toISOString(),
    contentHash: createHash('sha256').update(content).digest('hex'), ...(extractedPages ? { pages: extractedPages } : {}) };
}
