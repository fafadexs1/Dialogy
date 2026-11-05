import 'server-only';
import { posix } from 'node:path';
import { SaxesParser } from 'saxes';
import { readBoundedOfficeEntries } from '@/modules/nexus/services/spreadsheet-limits';
import { cleanDocumentText } from './knowledge-text';

const DRAWING_NAMESPACES = new Set(['http://schemas.openxmlformats.org/drawingml/2006/main', 'http://purl.oclc.org/ooxml/drawingml/main']);
const PRESENTATION_NAMESPACES = new Set(['http://schemas.openxmlformats.org/presentationml/2006/main', 'http://purl.oclc.org/ooxml/presentationml/main']);
const RELATIONSHIP_NAMESPACES = new Set(['http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'http://purl.oclc.org/ooxml/officeDocument/relationships']);
const PACKAGE_RELATIONSHIP_NAMESPACES = new Set(['http://schemas.openxmlformats.org/package/2006/relationships', 'http://purl.oclc.org/ooxml/package/relationships']);

/** Extracts visible slide text only. No external links, embedded files or macros are executed. */
export function extractPresentationText(data: Buffer): { content: string; slides: Array<{ number: number; content: string }> } {
  const entries = readBoundedOfficeEntries(data, name => name === 'ppt/presentation.xml' || name === 'ppt/_rels/presentation.xml.rels' || /^ppt\/slides\/slide[1-9]\d*\.xml$/.test(name));
  const presentation = entries.get('ppt/presentation.xml'), relations = entries.get('ppt/_rels/presentation.xml.rels');
  if (!presentation || !relations) throw new Error('A apresentação PPTX é inválida.');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const ids: string[] = [], targets = new Map<string, string>();
  const parse = (bytes: Buffer, onTag: (tag: import('saxes').SaxesTagNS) => void) => {
    const parser = new SaxesParser({ xmlns: true }); parser.on('opentag', onTag); parser.write(decoder.decode(bytes)).close();
  };
  parse(presentation, tag => {
    if (tag.local !== 'sldId' || !PRESENTATION_NAMESPACES.has(tag.uri)) return;
    const id = Object.values(tag.attributes).find(attr => attr.local === 'id' && RELATIONSHIP_NAMESPACES.has(attr.uri))?.value;
    if (!id || ids.length >= 100) throw new Error('A apresentação excede o limite de 100 slides ou é inválida.');
    ids.push(id);
  });
  parse(relations, tag => {
    if (tag.local !== 'Relationship' || !PACKAGE_RELATIONSHIP_NAMESPACES.has(tag.uri)) return;
    const id = tag.attributes.Id?.value, target = tag.attributes.Target?.value, type = tag.attributes.Type?.value;
    if (!id || !target || !type?.endsWith('/slide') || tag.attributes.TargetMode?.value === 'External') return;
    const path = posix.normalize(target.startsWith('/') ? target.slice(1) : `ppt/${target}`);
    if (!/^ppt\/slides\/slide[1-9]\d*\.xml$/.test(path) || targets.has(id)) throw new Error('A apresentação contém referência de slide inválida.');
    targets.set(id, path);
  });
  if (!ids.length) throw new Error('A apresentação não contém slides.');
  let total = 0;
  const slides = ids.map((id, index) => {
    const path = targets.get(id); const xml = path && entries.get(path);
    if (!xml) throw new Error('A apresentação contém um slide ausente.');
    const paragraphs: string[] = []; let line = '', inText = false;
    const parser = new SaxesParser({ xmlns: true });
    parser.on('opentag', tag => {
      if (!DRAWING_NAMESPACES.has(tag.uri)) return;
      if (tag.local === 't') inText = true;
      if (tag.local === 'br') line += '\n';
    });
    parser.on('text', text => { if (inText) line += text; });
    parser.on('cdata', text => { if (inText) line += text; });
    parser.on('closetag', tag => {
      if (!DRAWING_NAMESPACES.has(tag.uri)) return;
      if (tag.local === 't') inText = false;
      if (tag.local === 'p') { paragraphs.push(line); line = ''; }
    });
    parser.write(decoder.decode(xml)).close();
    const content = cleanDocumentText(paragraphs.join('\n'));
    total += content.length;
    if (total > 100_000) throw new Error('O texto extraído excede 100 mil caracteres.');
    return { number: index + 1, content };
  });
  if (!slides.some(slide => slide.content)) throw new Error('A apresentação não contém texto extraível.');
  return { content: slides.map(slide => `Slide ${slide.number}\n${slide.content}`).join('\n\n'), slides };
}
