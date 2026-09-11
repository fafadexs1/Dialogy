import type { CollectedFieldDefinition } from './types';
import { isStudioInformationQuestion } from './option-resolution';

const BRAZILIAN_MONTH_NAMES: Record<string, number> = {
  janeiro: 1, jan: 1,
  fevereiro: 2, fev: 2,
  marco: 3, mar: 3,
  abril: 4, abr: 4,
  maio: 5, mai: 5,
  junho: 6, jun: 6,
  julho: 7, jul: 7,
  agosto: 8, ago: 8,
  setembro: 9, set: 9,
  outubro: 10, out: 10,
  novembro: 11, nov: 11,
  dezembro: 12, dez: 12,
};

export function parseBrazilianDate(text: string, now: number = Date.now(), timeZone: string = 'America/Sao_Paulo'): string | undefined {
  if (!text || typeof text !== 'string') return undefined;
  const normalized = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/[.!]+$/, '');

  // 1. Standard ISO: YYYY-MM-DD
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized);
  if (isoMatch) {
    const d = new Date(`${normalized}T12:00:00Z`);
    if (Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === normalized) {
      return normalized;
    }
  }

  const clean = normalized.replace(/^(?:(?:eu )?(?:nasci|quero|prefiro|pode ser)(?: marcar| agendar)?(?: em| no dia| dia)?\s+)?(?:para\s+)?(?:dia\s+)?/, '').trim();

  // 2. Relative dates
  const offset = ({ hoje: 0, amanha: 1, 'depois de amanha': 2 } as Record<string, number>)[clean];
  if (offset !== undefined) {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(now));
    const part = (type: string) => parts.find((p) => p.type === type)!.value;
    const date = new Date(`${part('year')}-${part('month')}-${part('day')}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + offset);
    return date.toISOString().slice(0, 10);
  }

  // 3. Textual month format: e.g. "16 de dezembro de 2001", "16 de dez de 2001", "16 dez 2001"
  const textMatch = /(?:^|\b)(\d{1,2})(?:\s+de\s+|\s*[\/\.-]\s*|\s+)([a-z]+)(?:(?:\s+de\s+|\s*[\/\.-]\s*|\s+)(\d{2,4}))?(?:\b|$)/i.exec(clean);
  if (textMatch) {
    const day = Number(textMatch[1]);
    const month = BRAZILIAN_MONTH_NAMES[textMatch[2].toLowerCase()];
    if (month && day >= 1 && day <= 31) {
      const currentYear = Number(new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric' }).format(new Date(now)));
      let year = textMatch[3] ? Number(textMatch[3]) : currentYear;
      if (year < 100) {
        year = year <= (currentYear % 100) ? 2000 + year : 1900 + year;
      }
      const iso = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const d = new Date(`${iso}T12:00:00Z`);
      if (Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === iso) {
        return iso;
      }
    }
  }

  // 4. Numeric formats: e.g. "16/12/2001", "16-12-2001", "16.12.2001", "16/12/01", "16/12"
  const numMatch = /(?:^|\b)(\d{1,2})[\/\.](\d{1,2})(?:[\/\.](\d{2,4}))?(?:\b|$)|^(\d{1,2})-(\d{1,2})-(\d{2,4})$/.exec(clean);
  if (numMatch) {
    const day = Number(numMatch[1] || numMatch[4]);
    const month = Number(numMatch[2] || numMatch[5]);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      const currentYear = Number(new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric' }).format(new Date(now)));
      const rawYear = numMatch[3] || numMatch[6];
      let year = rawYear ? Number(rawYear) : currentYear;
      if (year < 100) {
        year = year <= (currentYear % 100) ? 2000 + year : 1900 + year;
      }
      const iso = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const d = new Date(`${iso}T12:00:00Z`);
      if (Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === iso) {
        return iso;
      }
    }
  }

  return undefined;
}

/** Deterministic, anchored normalizations only; strict field validation remains authoritative. */
export function normalizeStudioDirectAnswer(field: CollectedFieldDefinition, message: string, now: number, timeZone: string): unknown {
  if (field.isSensitive || isStudioInformationQuestion(message)) return undefined;
  const text = message.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/[.!]+$/, '');
  const answer = text.replace(/^(?:(?:eu )?(?:quero|prefiro|pode ser)(?: marcar| agendar)?\s+)?(?:para\s+)?/, '');
  if (field.type === 'date') {
    return parseBrazilianDate(message, now, timeZone);
  }
  if (field.type === 'time') {
    const hour = /^(?:as? )?(\d{1,2})h(?:(\d{2}))?$/.exec(answer);
    if (hour) return `${hour[1].padStart(2, '0')}:${hour[2] || '00'}`;
    const period = /^(?:as? )?(\d{1,2})(?::(\d{2}))? (?:da|de) (manha|tarde|noite)$/.exec(answer);
    if (!period || Number(period[1]) < 1 || Number(period[1]) > 12) return undefined;
    if (Number(period[1]) === 12 && period[3] === 'manha') return undefined; // Noon vs midnight needs clarification.
    const value = Number(period[1]) % 12 + (period[3] === 'manha' ? 0 : 12);
    return `${String(value).padStart(2, '0')}:${period[2] || '00'}`;
  }
  if (field.type === 'number') {
    const cardinal = ['zero', 'um', 'dois', 'tres', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez'];
    const quantity = answer.replace(/\s+unidades?$/, '').replace(/^uma$/, 'um').replace(/^duas$/, 'dois');
    const index = cardinal.indexOf(quantity);
    if (index >= 0) return index;
    if (/^-?\d+(?:[.,]\d+)?$/.test(quantity)) return quantity;
  }
  if (field.type === 'multi_select' && field.options?.length) {
    if (/^(?:todos|todas)(?: as opcoes| os itens)?$/.test(answer)) return [...field.options];
    if (/^(?:ambos|ambas|os dois|as duas)$/.test(answer) && field.options.length === 2) return [...field.options];
  }
  return undefined;
}
