import { parseCampaignContactRows, parseCampaignContactsCsv, type CampaignCsvImportResult, type CampaignImportCell } from './csv-import';

type ImportFile = Pick<File, 'name' | 'size' | 'arrayBuffer'>;
const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

function readableCell(value: unknown): CampaignImportCell {
  return value instanceof Date || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? value : null;
}

/** Read locally, then pass normalized recipients and their row values to campaign creation. */
export async function parseCampaignContactsFile(file: ImportFile): Promise<CampaignCsvImportResult> {
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (extension !== 'csv' && extension !== 'xlsx') throw new Error('Selecione um arquivo CSV ou Excel (.xlsx).');
  if (file.size > MAX_IMPORT_BYTES) throw new Error('A planilha deve ter no máximo 10 MB.');
  const buffer = await file.arrayBuffer();
  if (extension === 'csv') {
    let text = new TextDecoder('utf-8').decode(buffer);
    // Older SGP/Excel exports can use Windows-1252 rather than UTF-8.
    if (text.includes('\uFFFD')) text = new TextDecoder('windows-1252').decode(buffer);
    return parseCampaignContactsCsv(text);
  }
  const { default: readExcelFile } = await import('read-excel-file/universal');
  let sheets;
  try {
    sheets = await readExcelFile(buffer, { trim: false });
  } catch {
    throw new Error('Não foi possível ler o Excel. Confira se o arquivo é .xlsx e se não está protegido por senha.');
  }
  let firstResult: CampaignCsvImportResult | undefined;
  for (const sheet of sheets) {
    const result = { ...parseCampaignContactRows(sheet.data.map(row => row.map(readableCell))), sheetName: sheet.sheet };
    firstResult ??= result;
    if (result.contacts.length > 0) return result;
  }
  return firstResult ?? parseCampaignContactRows([]);
}
