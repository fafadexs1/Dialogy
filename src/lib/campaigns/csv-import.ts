import Papa from 'papaparse';

export type CampaignCsvContact = {
  id: string;
  name: string;
  phone: string;
  phone_number_jid: string;
  sourceRow: number;
};

export type CampaignCsvImportResult = {
  contacts: CampaignCsvContact[];
  invalidRows: number;
  duplicateRows: number;
  errors: string[];
};

const WHATSAPP_JID_SUFFIX = '@s.whatsapp.net';

function normalizeHeader(value: string): string {
  const normalized = String(value || '')
    .replace(/^\uFEFF/, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  if (['nome', 'name', 'cliente', 'contato', 'contact', 'pessoa', 'lead'].includes(normalized)) {
    return 'name';
  }
  if (
    [
      'telefone',
      'phone',
      'celular',
      'whatsapp',
      'numero',
      'number',
      'fone',
      'mobile',
      'phone_number',
      'telefone_whatsapp',
      'numero_whatsapp',
    ].includes(normalized)
  ) {
    return 'phone';
  }

  return normalized;
}

function extractDigits(value: string): string {
  return String(value || '')
    .trim()
    .replace(/@.*$/, '')
    .replace(/\D/g, '');
}

function normalizeWhatsappJid(value: string): { phone: string; jid: string } | null {
  const raw = String(value || '').trim();
  if (!raw) return null;

  let digits = extractDigits(raw);
  if (digits.startsWith('00')) {
    digits = digits.slice(2);
  }

  if (!raw.startsWith('+') && !raw.includes('@') && (digits.length === 10 || digits.length === 11)) {
    digits = `55${digits}`;
  }

  if (digits.length < 8) {
    return null;
  }

  return {
    phone: digits,
    jid: `${digits}${WHATSAPP_JID_SUFFIX}`,
  };
}

function buildContact(params: {
  name?: unknown;
  phone?: unknown;
  rowIndex: number;
}): CampaignCsvContact | null {
  const normalized = normalizeWhatsappJid(String(params.phone ?? ''));
  if (!normalized) return null;

  const name = String(params.name ?? '').trim() || `Contato ${normalized.phone}`;

  return {
    id: `row-${params.rowIndex}-${normalized.phone}`,
    name,
    phone: normalized.phone,
    phone_number_jid: normalized.jid,
    sourceRow: params.rowIndex,
  };
}

function parseHeaderRows(csvText: string): CampaignCsvContact[] {
  const parsed = Papa.parse<Record<string, unknown>>(csvText, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: normalizeHeader,
  });

  const fields = new Set((parsed.meta.fields || []).map(normalizeHeader));
  if (!fields.has('phone')) {
    return [];
  }

  return parsed.data
    .map((row, index) =>
      buildContact({
        name: row.name,
        phone: row.phone,
        rowIndex: index + 2,
      })
    )
    .filter((contact): contact is CampaignCsvContact => Boolean(contact));
}

function parseHeaderlessRows(csvText: string): CampaignCsvContact[] {
  const parsed = Papa.parse<string[]>(csvText, {
    header: false,
    skipEmptyLines: 'greedy',
  });

  return parsed.data
    .map((row, index) => {
      const cells = row.map(cell => String(cell || '').trim()).filter(Boolean);
      const phoneCell = cells.find(cell => Boolean(normalizeWhatsappJid(cell)));
      if (!phoneCell) return null;

      const nameCell = cells.find(cell => cell !== phoneCell && !normalizeWhatsappJid(cell));
      return buildContact({
        name: nameCell,
        phone: phoneCell,
        rowIndex: index + 1,
      });
    })
    .filter((contact): contact is CampaignCsvContact => Boolean(contact));
}

export function parseCampaignContactsCsv(csvText: string): CampaignCsvImportResult {
  const text = String(csvText || '').replace(/^\uFEFF/, '').trim();
  if (!text) {
    return {
      contacts: [],
      invalidRows: 0,
      duplicateRows: 0,
      errors: ['O arquivo CSV esta vazio.'],
    };
  }

  const allRows = Papa.parse<string[]>(text, {
    header: false,
    skipEmptyLines: 'greedy',
  }).data;
  const totalRows = allRows.length;

  const parsedContacts = parseHeaderRows(text);
  const contactsFromBestStrategy = parsedContacts.length > 0 ? parsedContacts : parseHeaderlessRows(text);
  const byJid = new Map<string, CampaignCsvContact>();
  let duplicateRows = 0;

  for (const contact of contactsFromBestStrategy) {
    if (byJid.has(contact.phone_number_jid)) {
      duplicateRows += 1;
      continue;
    }
    byJid.set(contact.phone_number_jid, contact);
  }

  const contacts = [...byJid.values()];
  const hasHeader = parsedContacts.length > 0;
  const dataRowCount = Math.max(0, totalRows - (hasHeader ? 1 : 0));
  const invalidRows = Math.max(0, dataRowCount - contacts.length - duplicateRows);

  return {
    contacts,
    invalidRows,
    duplicateRows,
    errors: contacts.length === 0 ? ['Nenhum telefone valido foi encontrado no CSV.'] : [],
  };
}
