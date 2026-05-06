import type { Contact } from '@/lib/types';
import type { AutopilotExtractedSlots, AutopilotSlotName } from './intent-types';

export type SlotSource = 'message' | 'contact' | 'history';

export type ExtractedSlotDetail = {
  name: AutopilotSlotName;
  value: string;
  source: SlotSource;
  confidence: number;
  raw?: string | null;
};

export type InvalidSlotDetail = {
  name: AutopilotSlotName;
  value: string;
  reason: string;
};

export type SlotExtractionResult = {
  slots: AutopilotExtractedSlots;
  details: ExtractedSlotDetail[];
  invalidSlots: InvalidSlotDetail[];
};

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function onlyDigits(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '');
}

function addSlot(
  result: SlotExtractionResult,
  detail: ExtractedSlotDetail
) {
  if (!detail.value.trim()) return;
  if (result.slots[detail.name]) return;

  result.slots[detail.name] = detail.value.trim();
  result.details.push({ ...detail, value: detail.value.trim() });
}

function isValidCpf(digits: string): boolean {
  if (!/^\d{11}$/.test(digits) || /^(\d)\1+$/.test(digits)) return false;

  const calc = (base: string, factor: number) => {
    let total = 0;
    for (const char of base) {
      total += Number(char) * factor;
      factor -= 1;
    }
    const mod = (total * 10) % 11;
    return mod === 10 ? 0 : mod;
  };

  const first = calc(digits.slice(0, 9), 10);
  const second = calc(digits.slice(0, 10), 11);
  return first === Number(digits[9]) && second === Number(digits[10]);
}

function isValidCnpj(digits: string): boolean {
  if (!/^\d{14}$/.test(digits) || /^(\d)\1+$/.test(digits)) return false;

  const calc = (base: string, factors: number[]) => {
    const total = base.split('').reduce((sum, char, index) => sum + Number(char) * factors[index], 0);
    const mod = total % 11;
    return mod < 2 ? 0 : 11 - mod;
  };

  const first = calc(digits.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = calc(digits.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return first === Number(digits[12]) && second === Number(digits[13]);
}

export function isValidCustomerIdentifier(value: string): boolean {
  const digits = onlyDigits(value);
  if (digits.length === 11) return isValidCpf(digits);
  if (digits.length === 14) return isValidCnpj(digits);
  return false;
}

export function normalizeCustomerIdentifier(value: string): string {
  return onlyDigits(value);
}

function extractCustomerIdentifierFromText(text: string): { raw: string; digits: string; valid: boolean } | null {
  const matches = text.match(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b|\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g) || [];
  const match = matches[0];
  if (!match) return null;

  const digits = onlyDigits(match);
  return {
    raw: match,
    digits,
    valid: isValidCustomerIdentifier(digits),
  };
}

function extractCustomerIdentifierFromContact(contact?: Contact | null): string | null {
  const customFields = contact?.custom_fields || {};
  const values = Object.values(customFields)
    .flatMap((value) => Array.isArray(value) ? value : [value])
    .map((value) => String(value ?? ''))
    .filter(Boolean);

  for (const value of values) {
    const identifier = extractCustomerIdentifierFromText(value);
    if (identifier?.valid) return identifier.digits;
  }

  return null;
}

function safeDate(year: number, month: number, day: number): Date | null {
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

function toIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function extractDate(text: string, now: Date): string | null {
  const normalized = normalizeText(text);
  if (/\bhoje\b/.test(normalized)) return toIsoDate(now);
  if (/\bamanha\b/.test(normalized)) {
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return toIsoDate(tomorrow);
  }

  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) {
    const date = safeDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    return date ? toIsoDate(date) : null;
  }

  const br = text.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
  if (!br) return null;

  const day = Number(br[1]);
  const month = Number(br[2]);
  const rawYear = br[3] ? Number(br[3]) : now.getFullYear();
  const year = rawYear < 100 ? 2000 + rawYear : rawYear;
  let date = safeDate(year, month, day);
  if (!date) return null;

  if (!br[3] && date.getTime() < new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) {
    date = safeDate(year + 1, month, day);
  }

  return date ? toIsoDate(date) : null;
}

function extractTime(text: string): string | null {
  const match = text.match(/\b([01]?\d|2[0-3])(?::|h)([0-5]\d)?\b/);
  if (!match) return null;

  const hour = String(Number(match[1])).padStart(2, '0');
  const minute = String(Number(match[2] || '0')).padStart(2, '0');
  return `${hour}:${minute}`;
}

function extractOrderId(text: string): string | null {
  return text.match(/\b(?:pedido|protocolo|solicitacao|solicitação|os|ordem|chamado|ticket)\s*#?\s*([a-z0-9-]{4,})\b/i)?.[1] || null;
}

function extractInvoiceId(text: string): string | null {
  return text.match(/\b(?:fatura|boleto|cobranca|cobrança)\s*#?\s*([a-z0-9-]{4,})\b/i)?.[1] || null;
}

function extractQuantity(text: string): string | null {
  return text.match(/\b(\d{1,4})\s*(?:unidades?|itens?|pessoas?|vagas?|servicos?|serviços?)\b/i)?.[1] || null;
}

export function extractAutopilotSlots(input: {
  customerMessage: string;
  chatHistory?: string;
  contact?: Contact | null;
  now?: Date;
}): SlotExtractionResult {
  const result: SlotExtractionResult = { slots: {}, details: [], invalidSlots: [] };
  const message = input.customerMessage || '';
  const now = input.now || new Date();

  const identifier = extractCustomerIdentifierFromText(message);
  if (identifier) {
    if (identifier.valid) {
      addSlot(result, {
        name: 'customer_identifier',
        value: identifier.digits,
        source: 'message',
        confidence: 0.99,
        raw: identifier.raw,
      });
    } else {
      result.invalidSlots.push({
        name: 'customer_identifier',
        value: identifier.raw,
        reason: 'CPF/CNPJ informado nao passou na validacao.',
      });
    }
  }

  const contactIdentifier = extractCustomerIdentifierFromContact(input.contact);
  if (contactIdentifier) {
    addSlot(result, {
      name: 'customer_identifier',
      value: contactIdentifier,
      source: 'contact',
      confidence: 0.9,
    });
  }

  const email = message.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || input.contact?.email || null;
  if (email) addSlot(result, { name: 'email', value: email, source: email === input.contact?.email ? 'contact' : 'message', confidence: 0.95 });

  const phone = message.match(/(?:\+?\d{1,3}\s*)?(?:\(?\d{2}\)?\s*)?\d{4,5}[-\s]?\d{4}/)?.[0] || input.contact?.phone || null;
  if (phone) addSlot(result, { name: 'phone', value: phone.replace(/\s+/g, ' ').trim(), source: phone === input.contact?.phone ? 'contact' : 'message', confidence: 0.85 });

  const date = extractDate(message, now);
  if (date) addSlot(result, { name: 'date', value: date, source: 'message', confidence: 0.88 });

  const time = extractTime(message);
  if (time) addSlot(result, { name: 'time', value: time, source: 'message', confidence: 0.88 });

  const orderId = extractOrderId(message);
  if (orderId) addSlot(result, { name: 'order_or_request_id', value: orderId, source: 'message', confidence: 0.86 });

  const invoiceId = extractInvoiceId(message);
  if (invoiceId) addSlot(result, { name: 'invoice_or_payment_id', value: invoiceId, source: 'message', confidence: 0.86 });

  const quantity = extractQuantity(message);
  if (quantity) addSlot(result, { name: 'quantity', value: quantity, source: 'message', confidence: 0.7 });

  if (input.contact?.address) {
    addSlot(result, { name: 'address', value: input.contact.address, source: 'contact', confidence: 0.7 });
  }

  return result;
}

export function hasRequiredSlot(slots: AutopilotExtractedSlots, slot: AutopilotSlotName): boolean {
  return Boolean(slots[slot]?.trim());
}

export function getMissingSlots(
  requiredSlots: AutopilotSlotName[],
  slots: AutopilotExtractedSlots
): AutopilotSlotName[] {
  return requiredSlots.filter((slot) => !hasRequiredSlot(slots, slot));
}

export function labelSlotForCustomer(slot: AutopilotSlotName): string {
  const labels: Record<AutopilotSlotName, string> = {
    name: 'nome',
    customer_identifier: 'CPF/CNPJ ou identificador cadastrado',
    date: 'data',
    time: 'horario',
    phone: 'telefone',
    email: 'email',
    address: 'endereco',
    order_or_request_id: 'numero do pedido, protocolo ou solicitacao',
    invoice_or_payment_id: 'numero da fatura ou cobranca',
    product_or_service_id: 'produto ou servico',
    product_or_service_preference: 'produto ou servico desejado',
    quantity: 'quantidade',
    location: 'localidade',
  };
  return labels[slot] || slot;
}
