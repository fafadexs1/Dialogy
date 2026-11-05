import 'server-only';

import { isRecord } from '@/services/workflow-runtime/utils';

/** Generate bounded, private workflow files from structured inputs. */
export async function generateToolboxDocument(format: 'pdf' | 'docx' | 'xlsx' | 'pptx', source: unknown): Promise<{ data: Buffer; mimeType: string }> {
  if (Buffer.byteLength(JSON.stringify(source) ?? 'null', 'utf8') > 500_000) throw new Error('Os dados do documento excedem 500 KB.');
  if (format === 'docx') {
    const text = typeof source === 'string' ? source : isRecord(source) && typeof source.text === 'string' ? source.text : '';
    if (!text.trim() || text.length > 40_000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) throw new Error('Informe texto válido para Word com até 40.000 caracteres.');
    const { Document, Packer, Paragraph } = await import('docx');
    const document = new Document({ sections: [{ children: text.replace(/\r\n?/g, '\n').split('\n').map((line) => new Paragraph({ text: line })) }] });
    return { data: await Packer.toBuffer(document), mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
  }
  if (format === 'pdf') {
    const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
    const text = typeof source === 'string' ? source : isRecord(source) && typeof source.text === 'string' ? source.text : '';
    if (!text.trim() || text.length > 40_000) throw new Error('Informe texto para PDF com até 40.000 caracteres.');
    const document = await PDFDocument.create();
    const font = await document.embedFont(StandardFonts.Helvetica);
    let page = document.addPage([595, 842]);
    let y = 790;
    for (const paragraph of text.replace(/\r\n?/g, '\n').split('\n')) {
      const words = paragraph.split(/\s+/);
      let line = '';
      const draw = (value: string) => {
        if (y < 50) { if (document.getPageCount() >= 50) throw new Error('O PDF excede 50 páginas.'); page = document.addPage([595, 842]); y = 790; }
        try { page.drawText(value, { x: 50, y, size: 11, font, color: rgb(0.12, 0.16, 0.2), maxWidth: 495 }); }
        catch { throw new Error('O PDF contém caracteres não suportados pela fonte padrão.'); }
        y -= 16;
      };
      for (const word of words) {
        const next = line ? `${line} ${word}` : word;
        if (next.length > 90 && line) { draw(line); line = word; } else line = next;
      }
      draw(line);
    }
    return { data: Buffer.from(await document.save()), mimeType: 'application/pdf' };
  }
  if (format === 'xlsx') {
    if (!Array.isArray(source) || source.length > 1000 || !source.every(isRecord)) throw new Error('A planilha exige uma lista de até 1.000 objetos.');
    const columns = [...new Set(source.flatMap((row) => Object.keys(row)))];
    if (!columns.length || columns.length > 100) throw new Error('A planilha exige de 1 a 100 colunas.');
    const ExcelJS = await import('exceljs');
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Dados');
    sheet.addRow(columns);
    for (const row of source) sheet.addRow(columns.map((column) => {
      const value = row[column];
      if (value == null || typeof value === 'number' || typeof value === 'boolean') return value ?? null;
      return (typeof value === 'string' ? value : JSON.stringify(value)).slice(0, 32_000);
    }));
    sheet.getRow(1).font = { bold: true };
    return { data: Buffer.from(await workbook.xlsx.writeBuffer()), mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
  }
  const slides = isRecord(source) ? source.slides : source;
  if (!Array.isArray(slides) || !slides.length || slides.length > 30 || !slides.every(isRecord)) throw new Error('Informe de 1 a 30 slides com título e texto.');
  const { default: PptxGenJS } = await import('pptxgenjs');
  const presentation = new PptxGenJS();
  presentation.layout = 'LAYOUT_WIDE';
  for (const item of slides) {
    const title = String(item.title || '');
    const body = String(item.text || item.body || '');
    if (title.length > 160 || body.length > 4000) throw new Error('Cada slide aceita título de até 160 e texto de até 4.000 caracteres.');
    const slide = presentation.addSlide();
    slide.addText(title, { x: 0.7, y: 0.5, w: 11.9, h: 0.8, fontSize: 28, bold: true, color: '123A34', breakLine: false });
    slide.addText(body, { x: 0.7, y: 1.5, w: 11.9, h: 5.3, fontSize: 18, color: '263238', valign: 'top', fit: 'shrink', breakLine: false });
  }
  return { data: Buffer.from(await presentation.write({ outputType: 'nodebuffer' }) as Buffer), mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' };
}
