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

function extractCustomerIdentifierFromText(text: string, takeLast = false): { raw: string; digits: string; valid: boolean } | null {
  const matches = text.match(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b|\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g) || [];
  const match = takeLast && matches.length > 0 ? matches[matches.length - 1] : matches[0];
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

function cleanCapturedText(value: string): string {
  return value
    .replace(/[.!?;:,]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractName(text: string, takeLast = false): string | null {
  const patterns = [
    /\b(?:meu nome(?: completo)?\s*(?:e|é)|nome(?: completo)?\s*[:=])\s+([a-zÀ-ÿ][a-zÀ-ÿ' ]{2,80})/gi,
    /\b(?:sou|me chamo|chamo)\s+([a-zÀ-ÿ][a-zÀ-ÿ' ]{2,80})/gi,
  ];
  const matches = patterns.flatMap((pattern) => Array.from(text.matchAll(pattern)).map((match) => cleanCapturedText(match[1])));
  const filtered = matches.filter((match) => match.split(/\s+/).length >= 2 || match.length >= 4);
  if (filtered.length === 0) return null;
  return takeLast ? filtered[filtered.length - 1] : filtered[0];
}

function extractProductPreference(text: string, takeLast = false): string | null {
  const patterns = [
    /\b(?:quero|vou querer|tenho interesse|escolhi|contratar|assinar|reservar|agendar|comprar)\s+(?:o|a|esse|essa|um|uma|produto|servico|serviço|item|opcao|opção)?\s*([^.!?\n]{3,80})/gi,
    /\b([0-9]{2,4}\s*(?:mega|megas|mb|gb)(?:\s*\+\s*[^.!?\n]{1,40})?)/gi,
  ];
  const matches = patterns
    .flatMap((pattern) => Array.from(text.matchAll(pattern)).map((match) => cleanCapturedText(match[1])))
    .filter((match) => !/^(sim|ok|certo|obrigado|obrigada|por favor)$/i.test(match));
  if (matches.length === 0) return null;
  return takeLast ? matches[matches.length - 1] : matches[0];
}

function extractAddress(text: string, takeLast = false): string | null {
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const candidates = lines.flatMap((line) => {
    const normalized = normalizeText(line);
    const hasAddressSignal = /\b(endereco|endereço|rua|avenida|av\.|quadra|qd|lote|lt|numero|nº|bairro|cidade|condominio|condomínio|casa|apartamento|apto|cep|morada)\b/.test(normalized);
    if (!hasAddressSignal) return [];
    const explicit = line.match(/\b(?:meu endereco(?: completo)?\s*(?:e|é)|endereco(?: completo)?\s*[:=]|moro na?|moro em)\s+(.+)/i)?.[1];
    return [cleanCapturedText(explicit || line)];
  });
  const filtered = candidates
    .map((candidate) => candidate.replace(/^(?:meu\s+)?(?:endereco|endereço)\s*(?:completo)?\s*(?:e|é|:)?\s*/i, ''))
    .filter((candidate) => candidate.length >= 8);
  if (filtered.length === 0) return null;
  return takeLast ? filtered[filtered.length - 1] : filtered[0];
}

function messageSaysUseCurrentPhone(text: string): boolean {
  const normalized = normalizeText(text);
  return (
    /\b(telefone|whatsapp|numero|número)\b/.test(normalized) &&
    /\b(o mesmo|este|esse|atual|que estou falando|que eu estou falando|deste contato|desse contato)\b/.test(normalized)
  );
}

export function extractAutopilotSlots(input: {
  customerMessage: string;
  chatHistory?: string;
  contact?: Contact | null;
  now?: Date;
}): SlotExtractionResult {
  const result: SlotExtractionResult = { slots: {}, details: [], invalidSlots: [] };
  const message = input.customerMessage || '';
  const historyText = input.chatHistory || '';
  const now = input.now || new Date();

  let identifier = extractCustomerIdentifierFromText(message);
  let identifierSource: SlotSource = 'message';

  if (!identifier && historyText) {
    // If not in message, look for the most recent one in the chat history
    identifier = extractCustomerIdentifierFromText(historyText, true);
    if (identifier) identifierSource = 'history';
  }

  if (identifier) {
    if (identifier.valid) {
      addSlot(result, {
        name: 'customer_identifier',
        value: identifier.digits,
        source: identifierSource,
        confidence: 0.99,
        raw: identifier.raw,
      });
    } else if (identifierSource === 'message') {
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

  const extractFromTextOrHistory = <T>(
    extractor: (text: string, takeLast?: boolean) => T | null
  ): { value: T; source: SlotSource } | null => {
    const fromMsg = extractor(message);
    if (fromMsg) return { value: fromMsg, source: 'message' };
    if (historyText) {
      const fromHist = extractor(historyText, true); // Attempt to grab latest from history
      if (fromHist) return { value: fromHist, source: 'history' };
    }
    return null;
  };

  const productExtract = extractFromTextOrHistory((text, takeLast) => extractProductPreference(text, takeLast));
  if (productExtract) addSlot(result, { name: 'product_or_service_preference', value: productExtract.value, source: productExtract.source, confidence: 0.82 });

  const nameExtract = extractFromTextOrHistory((text, takeLast) => extractName(text, takeLast));
  const contactName = input.contact?.name && !/^cliente\b/i.test(input.contact.name) ? input.contact.name : null;
  const name = nameExtract?.value || contactName || null;
  if (name) addSlot(result, { name: 'name', value: name, source: name === contactName ? 'contact' : nameExtract?.source || 'message', confidence: name === contactName ? 0.72 : 0.9 });

  const addressExtract = extractFromTextOrHistory((text, takeLast) => extractAddress(text, takeLast));
  const address = addressExtract?.value || input.contact?.address || null;
  if (address) addSlot(result, { name: 'address', value: address, source: address === input.contact?.address ? 'contact' : addressExtract?.source || 'message', confidence: address === input.contact?.address ? 0.7 : 0.84 });

  const emailExtract = extractFromTextOrHistory((text, takeLast) => {
    const matches = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig);
    if (!matches) return null;
    return takeLast ? matches[matches.length - 1] : matches[0];
  });
  const email = emailExtract?.value || input.contact?.email || null;
  if (email) addSlot(result, { name: 'email', value: email, source: email === input.contact?.email ? 'contact' : emailExtract?.source || 'message', confidence: 0.95 });

  const phoneExtract = extractFromTextOrHistory((text, takeLast) => {
    const matches = text.match(/(?:\+?\d{1,3}\s*)?(?:\(?\d{2}\)?\s*)?\d{4,5}[-\s]?\d{4}/g);
    if (!matches) return null;
    return takeLast ? matches[matches.length - 1] : matches[0];
  });
  const contactPhone = input.contact?.phone || input.contact?.phone_number_jid || null;
  const phone = phoneExtract?.value || (messageSaysUseCurrentPhone(message) ? contactPhone : null) || input.contact?.phone || null;
  if (phone) addSlot(result, { name: 'phone', value: onlyDigits(phone) || phone.replace(/\s+/g, ' ').trim(), source: phone === contactPhone || phone === input.contact?.phone ? 'contact' : phoneExtract?.source || 'message', confidence: 0.85 });

  const dateExtract = extractFromTextOrHistory((text) => extractDate(text, now));
  if (dateExtract) addSlot(result, { name: 'date', value: dateExtract.value, source: dateExtract.source, confidence: 0.88 });

  const timeExtract = extractFromTextOrHistory((text) => extractTime(text));
  if (timeExtract) addSlot(result, { name: 'time', value: timeExtract.value, source: timeExtract.source, confidence: 0.88 });

  const orderIdExtract = extractFromTextOrHistory((text) => extractOrderId(text));
  if (orderIdExtract) addSlot(result, { name: 'order_or_request_id', value: orderIdExtract.value, source: orderIdExtract.source, confidence: 0.86 });

  const invoiceIdExtract = extractFromTextOrHistory((text) => extractInvoiceId(text));
  if (invoiceIdExtract) addSlot(result, { name: 'invoice_or_payment_id', value: invoiceIdExtract.value, source: invoiceIdExtract.source, confidence: 0.86 });

  const quantityExtract = extractFromTextOrHistory((text) => extractQuantity(text));
  if (quantityExtract) addSlot(result, { name: 'quantity', value: quantityExtract.value, source: quantityExtract.source, confidence: 0.7 });

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
