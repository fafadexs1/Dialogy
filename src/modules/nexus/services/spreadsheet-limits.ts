import { inflateRawSync } from 'node:zlib';

/** Verify actual expanded ZIP sizes; optionally collect exact Office entry names. */
export function readBoundedOfficeEntries(data: Buffer, select: (name: string) => boolean = () => false): Map<string, Buffer> {
  const entries = new Map<string, Buffer>();
  let end = -1;
  for (let index = data.length - 22; index >= Math.max(0, data.length - 65557); index--) if (data.readUInt32LE(index) === 0x06054b50) { end = index; break; }
  if (end < 0) throw new Error('Arquivo XLSX inválido.');
  const count = data.readUInt16LE(end + 10), directory = data.readUInt32LE(end + 16);
  if (count > 256 || data.readUInt16LE(end + 4) !== 0 || data.readUInt16LE(end + 6) !== 0) throw new Error('Planilha compactada fora dos limites.');
  let offset = directory, expanded = 0;
  for (let index = 0; index < count; index++) {
    if (offset + 46 > end || data.readUInt32LE(offset) !== 0x02014b50) throw new Error('Diretório XLSX inválido.');
    const flags = data.readUInt16LE(offset + 8), method = data.readUInt16LE(offset + 10), compressed = data.readUInt32LE(offset + 20), size = data.readUInt32LE(offset + 24), local = data.readUInt32LE(offset + 42);
    if ((flags & 1) || ![0, 8].includes(method) || size > 20_000_000 - expanded || local + 30 > data.length || data.readUInt32LE(local) !== 0x04034b50) throw new Error('Conteúdo XLSX fora dos limites.');
    const nameLength = data.readUInt16LE(offset + 28), extraLength = data.readUInt16LE(offset + 30), commentLength = data.readUInt16LE(offset + 32);
    const next = offset + 46 + nameLength + extraLength + commentLength;
    if (next > end) throw new Error('Diretório Office incompleto.');
    const localNameLength = data.readUInt16LE(local + 26), localExtraLength = data.readUInt16LE(local + 28);
    const start = local + 30 + localNameLength + localExtraLength;
    if (start + compressed > directory || data.readUInt16LE(local + 6) !== flags || data.readUInt16LE(local + 8) !== method || localNameLength !== nameLength || !data.subarray(local + 30, local + 30 + localNameLength).equals(data.subarray(offset + 46, offset + 46 + nameLength))) throw new Error('Conteúdo Office inconsistente.');
    const name = data.toString('utf8', offset + 46, offset + 46 + nameLength);
    const bytes = data.subarray(start, start + compressed);
    const decoded = method === 0 ? bytes : inflateRawSync(bytes, { maxOutputLength: Math.max(1, 20_000_000 - expanded) });
    if (decoded.length !== size) throw new Error('Tamanho XLSX inconsistente.');
    expanded += decoded.length;
    if (select(name)) { if (entries.has(name)) throw new Error('Entrada Office duplicada.'); entries.set(name, Buffer.from(decoded)); }
    offset = next;
  }
  return entries;
}

export function assertBoundedSpreadsheetArchive(data: Buffer) { readBoundedOfficeEntries(data); }
