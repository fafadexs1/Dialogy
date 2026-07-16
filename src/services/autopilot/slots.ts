import type { Contact } from '@/lib/types';
import type { AutopilotExtractedSlots, AutopilotSlotName } from './intent-types';

export type SlotSource = 'message' | 'contact' | 'history' | 'memory';

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
  const pattern = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b|\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g;
  const matches = Array.from(text.matchAll(pattern)).filter((match) => {
    const raw = match[0] || '';
    const digits = onlyDigits(raw);
    if (digits.length !== 11 || /[./-]/.test(raw)) return true;
    const index = match.index || 0;
    const nearby = normalizeText(text.slice(Math.max(0, index - 35), Math.min(text.length, index + raw.length + 20)));
    // An unformatted Brazilian phone also has 11 digits. An explicit phone
    // label must win over the generic CPF shape.
    return !/\b(?:telefone|tel|whatsapp|celular|fone|numero de contato)\b/.test(nearby);
  });
  const match = takeLast && matches.length > 0 ? matches[matches.length - 1]?.[0] : matches[0]?.[0];
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
  return text.match(/\b(?:pedido|protocolo|solicitacao|solicitação|os|ordem|chamado|ticket)\b\s*#?\s*([a-z0-9-]{4,})\b/i)?.[1] || null;
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

function trimAtNextFieldLabel(value: string): string {
  return value
    .split(/\s+(?:e\s+(?:meu|minha)\s+)?(?:cep|cpf|cnpj|documento|telefone|whatsapp|email|e-mail|endereco|endereço|nome)\s*(?:e|é|[:=])\s*/i)[0]
    .replace(/\s+(?:e\s+)?(?:o\s+)?(?:cep|cpf|cnpj|telefone|whatsapp|email|endereco|endereço)\b.*$/i, '')
    .trim();
}

function extractName(text: string, takeLast = false): string | null {
  const patterns = [
    /\b(?:meu nome(?: completo)?\s*(?:e|é)|nome(?: completo)?\s*[:=])\s+([\p{L}][\p{L}' -]{2,80})/giu,
    /\b(?:sou|me chamo|chamo)\s+([\p{L}][\p{L}' -]{2,80})/giu,
  ];
  const matches = patterns.flatMap((pattern) => Array.from(text.matchAll(pattern)).map((match) => (
    cleanCapturedText(trimAtNextFieldLabel(match[1]))
  )));
  const filtered = matches.filter((match) => (
    match.length >= 2
    && !/^(?:oi|ola|olá|sim|nao|não|eu|cliente)$/i.test(match)
  ));
  if (filtered.length === 0) return null;
  return takeLast ? filtered[filtered.length - 1] : filtered[0];
}

function extractPostalCode(text: string, takeLast = false): string | null {
  const matches = text.match(/\b\d{5}-?\d{3}\b/g) || [];
  const match = takeLast ? matches[matches.length - 1] : matches[0];
  if (!match) return null;
  const digits = onlyDigits(match);
  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
}

function inferNameFromCompositeReply(message: string, chatHistory: string): string | null {
  const recentHistory = normalizeText(chatHistory).slice(-900);
  const requestedName = /\b(nome|nome completo|como voce se chama)\b/.test(recentHistory);
  const requestedLocation = /\b(cep|codigo postal|endereco|localidade)\b/.test(recentHistory);
  if (!requestedName || !requestedLocation || !extractPostalCode(message)) return null;

  const candidate = cleanCapturedText(
    message
      .replace(/\b\d{5}-?\d{3}\b/g, ' ')
      .replace(/\b(?:nome(?: completo)?|meu nome|cep|codigo postal)\s*(?:e|é|[:=])?\s*/gi, ' ')
      .replace(/[|,;:/]+/g, ' ')
      .replace(/\b(?:meu|minha|e)\b\s*$/i, ' '),
  );
  if (!/^[\p{L}][\p{L}' -]{2,80}$/u.test(candidate)) return null;
  if (/\b(rua|avenida|quadra|lote|bairro|cidade|casa|apto|apartamento|bloco|quero|preciso|internet|plano|produto|servico|serviço|contratar|interesse|telefone|email|estou|ainda|nao|não|achei|procurando|verificando|vou|depois|apenas|consulte|consultar|verifique|verificar|pode|favor)\b/i.test(candidate)) return null;
  if (/\b(?:no|na|em|para|com|de|do|da)\s*$/i.test(candidate)) return null;
  const words = candidate.split(/\s+/).filter(Boolean);
  return words.length >= 1 && words.length <= 6 ? candidate : null;
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
    const postalCode = extractPostalCode(line);
    const hasAddressSignal = Boolean(postalCode) || /\b(endereco|endereço|rua|avenida|av\.|quadra|qd|lote|lt|numero|nº|bairro|cidade|condominio|condomínio|casa|apartamento|apto|bloco|sala|unidade|complemento|cep|morada)\b/.test(normalized);
    if (!hasAddressSignal) return [];
    const explicit = line.match(/\b(?:meu endereco(?: completo)?\s*(?:e|é)|endereco(?: completo)?\s*[:=]|moro na?|moro em)\s+(.+)/i)?.[1];
    if (explicit) return [cleanCapturedText(trimAtNextFieldLabel(explicit))];
    const hasAnotherFieldLabel = /\b(?:nome|cpf|cnpj|documento|telefone|whatsapp|email)\s*(?:e|é|[:=])/i.test(line);
    const hasAddressWords = /\b(endereco|rua|avenida|av\.|quadra|qd|lote|lt|numero|nº|bairro|cidade|condominio|casa|apartamento|apto|morada)\b/.test(normalized);
    return [(postalCode && (hasAnotherFieldLabel || !hasAddressWords)) ? `CEP ${postalCode}` : cleanCapturedText(line)];
  });
  const filtered = candidates
    .map((candidate) => candidate.replace(/^(?:meu\s+)?(?:endereco|endereço)\s*(?:completo)?\s*(?:e|é|:)?\s*/i, ''))
    .filter((candidate) => candidate.length >= 8);
  if (filtered.length === 0) return null;
  return takeLast ? filtered[filtered.length - 1] : filtered[0];
}

function contactCustomFieldValue(
  contact: Contact | null | undefined,
  keyPattern: RegExp,
): string | null {
  for (const [key, rawValue] of Object.entries(contact?.custom_fields || {})) {
    if (!keyPattern.test(normalizeText(key))) continue;
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    const value = values.map((item) => String(item ?? '').trim()).find(Boolean);
    if (value) return value;
  }
  return null;
}

function extractAddressFromContact(contact?: Contact | null): string | null {
  if (contact?.address?.trim()) return contact.address.trim();
  const address = contactCustomFieldValue(contact, /\b(endereco|address|rua|logradouro|morada)\b/);
  if (address) return address;
  const postal = contactCustomFieldValue(contact, /\b(cep|codigo postal|postal code|zipcode|zip)\b/);
  const postalCode = postal ? extractPostalCode(postal) : null;
  return postalCode ? `CEP ${postalCode}` : postal;
}

function messageSaysUseCurrentPhone(text: string): boolean {
  const normalized = normalizeText(text);
  return (
    /\b(telefone|whatsapp|numero|número)\b/.test(normalized) &&
    /\b(o mesmo|este|esse|atual|que estou falando|que eu estou falando|deste contato|desse contato)\b/.test(normalized)
  );
}

function customerOnlyHistory(chatHistory: string): string {
  const customerLines = chatHistory
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => /^(?:cliente|customer|usuario|usuário)\s*:/i.test(line))
    .map((line) => line.replace(/^[^:]+:\s*/, ''))
    .filter(Boolean);
  return customerLines.length > 0 ? customerLines.join('\n') : chatHistory;
}

export function extractAutopilotSlots(input: {
  customerMessage: string;
  chatHistory?: string;
  contact?: Contact | null;
  rememberedSlots?: AutopilotExtractedSlots | null;
  now?: Date;
}): SlotExtractionResult {
  const result: SlotExtractionResult = { slots: {}, details: [], invalidSlots: [] };
  const message = input.customerMessage || '';
  const rawHistoryText = input.chatHistory || '';
  const historyText = customerOnlyHistory(rawHistoryText);
  const now = input.now || new Date();

  const messageIdentifier = extractCustomerIdentifierFromText(message);
  let identifier = messageIdentifier;
  let identifierSource: SlotSource = 'message';

  if (!identifier && historyText) {
    // If not in message, look for the most recent one in the chat history
    identifier = extractCustomerIdentifierFromText(historyText, true);
    if (identifier) identifierSource = 'history';
  }

  const invalidCurrentIdentifier = Boolean(messageIdentifier && !messageIdentifier.valid);
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

  if (!invalidCurrentIdentifier) {
    const rememberedIdentifier = input.rememberedSlots?.customer_identifier;
    if (rememberedIdentifier && isValidCustomerIdentifier(rememberedIdentifier)) {
      addSlot(result, {
        name: 'customer_identifier',
        value: normalizeCustomerIdentifier(rememberedIdentifier),
        source: 'memory',
        confidence: 0.93,
      });
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

  let nameExtract = extractFromTextOrHistory((text, takeLast) => extractName(text, takeLast));
  if (!nameExtract) {
    const inferredCompositeName = inferNameFromCompositeReply(message, rawHistoryText);
    if (inferredCompositeName) nameExtract = { value: inferredCompositeName, source: 'message' };
  }
  const contactName = input.contact?.name && !/^cliente\b/i.test(input.contact.name) ? input.contact.name : null;
  const rememberedName = input.rememberedSlots?.name || null;
  const name = nameExtract?.value || rememberedName || contactName || null;
  if (name) {
    const source = nameExtract?.value
      ? nameExtract.source
      : name === rememberedName
        ? 'memory'
        : 'contact';
    addSlot(result, { name: 'name', value: name, source, confidence: source === 'contact' ? 0.72 : source === 'memory' ? 0.93 : 0.9 });
  }

  const addressExtract = extractFromTextOrHistory((text, takeLast) => extractAddress(text, takeLast));
  const contactAddress = extractAddressFromContact(input.contact);
  const rememberedAddress = input.rememberedSlots?.address || null;
  let address = addressExtract?.value || rememberedAddress || contactAddress || null;
  let addressSource: SlotSource = addressExtract?.source || (address === rememberedAddress ? 'memory' : 'contact');
  if (addressExtract?.value && addressExtract.source === 'message') {
    const rememberedBase = rememberedAddress || contactAddress;
    const messagePostalCode = extractPostalCode(addressExtract.value);
    const rememberedPostalCode = rememberedBase ? extractPostalCode(rememberedBase) : null;
    const normalizedMessage = normalizeText(message);
    const isComplementOnly = (
      /\b(complemento|apartamento|apto|bloco|sala|unidade|casa)\b/.test(normalizedMessage)
      && !/\b(meu endereco|endereco completo|endereco e|moro|rua|avenida|quadra|lote|bairro|cidade|morada)\b/.test(normalizedMessage)
    );
    if (
      rememberedBase
      && !messagePostalCode
      && rememberedPostalCode
      && isComplementOnly
      && !normalizeText(rememberedBase).includes(normalizeText(addressExtract.value))
    ) {
      address = `${rememberedBase}; ${addressExtract.value}`;
    } else {
      // A new explicit CEP/address supersedes any older remembered address.
      address = addressExtract.value;
    }
    addressSource = 'message';
  }
  if (address) addSlot(result, { name: 'address', value: address, source: addressSource, confidence: addressSource === 'contact' ? 0.82 : addressSource === 'memory' ? 0.93 : 0.88 });

  const emailExtract = extractFromTextOrHistory((text, takeLast) => {
    const matches = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig);
    if (!matches) return null;
    return takeLast ? matches[matches.length - 1] : matches[0];
  });
  const rememberedEmail = input.rememberedSlots?.email || null;
  const email = emailExtract?.value || rememberedEmail || input.contact?.email || null;
  if (email) {
    const source = emailExtract?.value ? emailExtract.source : email === rememberedEmail ? 'memory' : 'contact';
    addSlot(result, { name: 'email', value: email, source, confidence: source === 'memory' ? 0.93 : 0.95 });
  }

  const phoneExtract = extractFromTextOrHistory((text, takeLast) => {
    const pattern = /(?:\+?\d{1,3}\s*)?(?:\(?\d{2}\)?\s*)?\d{4,5}[-\s]?\d{4}/g;
    const matches = Array.from(text.matchAll(pattern)).filter((match) => {
      const raw = match[0] || '';
      const digits = onlyDigits(raw);
      if (!isValidCustomerIdentifier(digits)) return true;

      const index = match.index || 0;
      const prefix = normalizeText(text.slice(Math.max(0, index - 32), index));
      // A valid CPF can have the same 11-digit shape as a Brazilian mobile
      // number. Only reuse it as phone when the customer labelled it as such.
      if (/\b(?:telefone|tel|whatsapp|celular|fone|numero de contato)\b/.test(prefix)) return true;
      if (/\b(?:cpf|cnpj|documento|identificador)\b/.test(prefix)) return false;

      const identifier = extractCustomerIdentifierFromText(text, takeLast);
      return identifier?.digits !== digits;
    });
    if (matches.length === 0) return null;
    return takeLast ? matches[matches.length - 1]?.[0] : matches[0]?.[0];
  });
  const contactPhone = input.contact?.phone || input.contact?.phone_number_jid || null;
  const rememberedPhone = input.rememberedSlots?.phone || null;
  const explicitlyCurrentPhone = messageSaysUseCurrentPhone(message) ? contactPhone : null;
  const phone = phoneExtract?.value || explicitlyCurrentPhone || rememberedPhone || contactPhone || null;
  if (phone) {
    const source = phoneExtract?.value
      ? phoneExtract.source
      : phone === rememberedPhone && !explicitlyCurrentPhone
        ? 'memory'
        : 'contact';
    addSlot(result, { name: 'phone', value: onlyDigits(phone) || phone.replace(/\s+/g, ' ').trim(), source, confidence: source === 'memory' ? 0.93 : 0.85 });
  }

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

  for (const [name, value] of Object.entries(input.rememberedSlots || {})) {
    if (!value) continue;
    if (name === 'customer_identifier' && invalidCurrentIdentifier) continue;
    addSlot(result, {
      name: name as AutopilotSlotName,
      value: String(value),
      source: 'memory',
      confidence: 0.93,
    });
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
