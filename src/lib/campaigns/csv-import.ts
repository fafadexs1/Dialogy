import Papa from 'papaparse';
import { normalizeCampaignPhoneNumbers } from './import-phones';

export type CampaignCsvContact = {
  id: string;
  name: string;
  phone: string;
  phone_number_jid: string;
  sourceRow: number;
  csvData: Record<string, string>;
};

export type CampaignCsvImportResult = {
  contacts: CampaignCsvContact[];
  invalidRows: number;
  duplicateRows: number;
  errors: string[];
  columns: string[];
  totalRows: number;
  expandedRows: number;
  headerRow: number | null;
  sheetName?: string;
};

export type CampaignImportCell = string | number | boolean | Date | null | undefined;

function normalizeHeader(value: string): string {
  return value.replace(/^\uFEFF/, '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function isNameHeader(value: string): boolean {
  return ['nome', 'name', 'cliente', 'nome_cliente', 'nome_do_cliente', 'razao_social', 'contato', 'contact', 'pessoa', 'lead']
    .includes(normalizeHeader(value));
}

function isPhoneHeader(value: string): boolean {
  const header = normalizeHeader(value);
  return ['numero', 'number', 'phone_number', 'numero_whatsapp'].includes(header)
    || /^(?:telefone|telefones|phone|celular|celulares|whatsapp|fone|fones|mobile)(?:_|$)/.test(header);
}

function cellText(value: CampaignImportCell, header = ''): string {
  if (value == null) return '';
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? '' : new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '';
    if (/^(?:valor|saldo|multa|juros|desconto|total)(?:_|$)/.test(normalizeHeader(header))) {
      return new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
    }
    return String(Number(value.toPrecision(15)));
  }
  return String(value);
}

function emptyResult(error?: string): CampaignCsvImportResult {
  return { contacts: [], invalidRows: 0, duplicateRows: 0, errors: error ? [error] : [], columns: [], totalRows: 0, expandedRows: 0, headerRow: null };
}

function uniqueHeaders(row: CampaignImportCell[]): string[] {
  const used = new Set<string>();
  return row.map((cell, index) => {
    const label = cellText(cell).replace(/^\uFEFF/, '').trim() || `Coluna ${index + 1}`;
    let key = label;
    let suffix = 2;
    while (used.has(key)) key = `${label} (${suffix++})`;
    used.add(key);
    return key;
  });
}

/** Shared normalization for simple CSVs and Excel reports with titles/totals before the table. */
export function parseCampaignContactRows(rows: CampaignImportCell[][]): CampaignCsvImportResult {
  const result = emptyResult();
  const firstDataIndex = rows.findIndex(row => row.some(cell => cellText(cell).trim()));
  if (firstDataIndex < 0) return emptyResult('A planilha está vazia.');

  const headerIndex = rows.findIndex(row => row.some(cell => isPhoneHeader(cellText(cell)))
    && (row.some(cell => isNameHeader(cellText(cell))) || row === rows[firstDataIndex]));
  const hasHeader = headerIndex >= 0;
  const columns = hasHeader ? uniqueHeaders(rows[headerIndex]) : [];
  const phoneIndexes = hasHeader ? columns.flatMap((column, index) => isPhoneHeader(column) ? [index] : []) : [];
  const nameIndex = hasHeader ? columns.findIndex(isNameHeader) : -1;
  const byJid = new Map<string, CampaignCsvContact>();
  result.columns = columns;
  result.headerRow = hasHeader ? headerIndex + 1 : null;

  for (let rowIndex = hasHeader ? headerIndex + 1 : 0; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex];
    if (!row.some(cell => cellText(cell).trim())) continue;
    result.totalRows++;
    let name = nameIndex >= 0 ? cellText(row[nameIndex]).trim() : '';
    let numbers: string[] = [];
    if (hasHeader) {
      numbers = phoneIndexes.flatMap(index => normalizeCampaignPhoneNumbers(cellText(row[index])));
    } else {
      // Infer only a name/phone pair. Never treat CPF, contract or invoice numbers
      // in an unrecognized multi-column report as destinations.
      const cells = row.map(cell => cellText(cell).trim()).filter(Boolean);
      if (cells.length <= 2) {
        const phoneCell = cells.find(cell => normalizeCampaignPhoneNumbers(cell).length > 0);
        numbers = phoneCell ? normalizeCampaignPhoneNumbers(phoneCell) : [];
        name = cells.find(cell => cell !== phoneCell) || '';
      }
    }
    numbers = [...new Set(numbers)];
    if (numbers.length === 0) { result.invalidRows++; continue; }
    if (numbers.length > 1) result.expandedRows++;

    const dataColumns = hasHeader ? columns : row.map((_, index) => `Coluna ${index + 1}`);
    const csvData = Object.fromEntries(dataColumns.map((column, index) => [column, cellText(row[index], column)]));
    if (!hasHeader && result.columns.length === 0) result.columns = dataColumns;
    for (const phone of numbers) {
      const jid = `${phone}@s.whatsapp.net`;
      if (byJid.has(jid)) { result.duplicateRows++; continue; }
      byJid.set(jid, {
        id: `row-${rowIndex + 1}-${phone}`, name: name || `Contato ${phone}`,
        phone, phone_number_jid: jid, sourceRow: rowIndex + 1, csvData: { ...csvData },
      });
    }
  }
  result.contacts = [...byJid.values()];
  if (result.contacts.length === 0) result.errors.push('Nenhum telefone válido foi encontrado. Confira as colunas de nome e telefone, incluindo o DDD.');
  return result;
}

export function parseCampaignContactsCsv(csvText: string): CampaignCsvImportResult {
  const text = String(csvText || '').replace(/^\uFEFF/, '');
  if (!text.trim()) return emptyResult('O arquivo CSV está vazio.');
  // A report's summary has irregular widths, which can fool Papa's delimiter
  // heuristic. Prefer a delimiter that exposes a recognizable name/phone header.
  const delimiter = [',', ';', '\t', '|'].find(candidate => {
    const preview = Papa.parse<string[]>(text, { delimiter: candidate, header: false, preview: 100 });
    return preview.data.some(row => row.some(isNameHeader) && row.some(isPhoneHeader));
  });
  const parsed = Papa.parse<string[]>(text, { ...(delimiter ? { delimiter } : {}), header: false, skipEmptyLines: false });
  if (parsed.errors.some(error => error.code !== 'UndetectableDelimiter')) {
    return emptyResult('Não foi possível interpretar o CSV. Confira o separador e as aspas das células.');
  }
  return parseCampaignContactRows(parsed.data);
}
