import type { SGPContactPanelInvoice } from '@/plugins/sgp/types';
import type { AgentToolExecutionResult } from '@/services/agent-tools/types';
import type { UniversalAutopilotIntent } from '@/services/autopilot/intent-types';

type Invoice = SGPContactPanelInvoice;
const months = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const normalize = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export function sgpInvoices(snapshot: Record<string, unknown>): Invoice[] {
  return Array.isArray(snapshot.invoices) ? snapshot.invoices.filter((value): value is Invoice => (
    record(value) && /^\d+$/.test(String(value.id || '')) && /^\d+$/.test(String(value.contractId || ''))
  )) : [];
}

export function selectRequestedSgpInvoice(input: {
  snapshot: Record<string, unknown>;
  customerMessage: string;
  now?: Date;
  timeZone?: string;
}): { invoice?: Invoice; candidates: Invoice[]; reason: string } {
  const text = normalize(input.customerMessage);
  let invoices = sgpInvoices(input.snapshot);
  const explicitId = text.match(/\b(?:fatura|boleto|cobranca)\s*(?:numero\s*|n[º°.]\s*|#\s*)?(\d{2,30})\b/)?.[1]
    || text.trim().match(/^#?(\d{2,30})$/)?.[1];
  const contractId = text.match(/\bcontrato\s*#?\s*(\d+)\b/)?.[1]
    || String(input.snapshot.requestedContractId || '');
  if (contractId) invoices = invoices.filter((invoice) => String(invoice.contractId) === contractId);
  if (explicitId) {
    const selected = invoices.find((invoice) => String(invoice.id) === explicitId);
    return { invoice: selected, candidates: invoices, reason: selected ? 'explicit_invoice' : 'invoice_not_found' };
  }

  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: input.timeZone || 'America/Sao_Paulo', year: 'numeric', month: '2-digit',
  }).formatToParts(input.now || new Date());
  const year = today.find((part) => part.type === 'year')!.value;
  const namedMonth = months.findIndex((month) => new RegExp(`\\b${month}\\b`).test(text));
  const currentMonth = /\b(?:mes (?:atual|corrente)|(?:deste|desse|este|esse|do) mes)\b/.test(text);
  const relativeMonth = /\b(?:mes (?:passado|anterior)|ultimo mes)\b/.test(text) ? -1
    : /\b(?:proximo mes|mes que vem|mes seguinte)\b/.test(text) ? 1 : 0;
  const numericMonth = text.match(/\bmes\s+(0?[1-9]|1[0-2])(?:\/(20\d{2}))?\b/);
  if (relativeMonth) {
    const shifted = new Date(Date.UTC(Number(year), Number(today.find((part) => part.type === 'month')!.value) - 1 + relativeMonth, 1));
    const prefix = shifted.toISOString().slice(0, 7);
    invoices = invoices.filter((invoice) => invoice.dueDate?.startsWith(`${prefix}-`));
  } else if (currentMonth || namedMonth >= 0 || numericMonth) {
    const month = currentMonth ? today.find((part) => part.type === 'month')!.value
      : String(namedMonth >= 0 ? namedMonth + 1 : Number(numericMonth![1])).padStart(2, '0');
    const requestedYear = text.match(/\b(20\d{2})\b/)?.[1] || year;
    invoices = invoices.filter((invoice) => invoice.dueDate?.startsWith(`${requestedYear}-${month}-`));
  } else {
    invoices = invoices.filter((invoice) => invoice.isOpen === true && !invoice.isPaid && !invoice.isCancelled);
    if (/\bproxim[ao]\b/.test(text) && invoices.length > 0
      && new Set(invoices.map((invoice) => invoice.contractId)).size === 1) {
      const dated = invoices.filter((invoice) => /^\d{4}-\d{2}-\d{2}/.test(invoice.dueDate || ''));
      const nextDate = dated.map((invoice) => invoice.dueDate!).sort()[0];
      invoices = nextDate ? dated.filter((invoice) => invoice.dueDate === nextDate) : [];
    }
  }
  return {
    invoice: invoices.length === 1 ? invoices[0] : undefined,
    candidates: invoices,
    reason: invoices.length === 1 ? 'unique_requested_invoice' : invoices.length === 0 ? 'invoice_not_found' : 'invoice_ambiguous',
  };
}

function dateLabel(value: string | null): string {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : 'não informado';
}

function summary(invoice: Invoice): string {
  const amount = invoice.correctedAmount > 0 ? invoice.correctedAmount : invoice.amount;
  const status = invoice.isPaid ? 'paga' : invoice.isCancelled ? 'cancelada' : invoice.isOpen ? 'em aberto' : 'não informada';
  return [
    `📄 *Fatura ${invoice.id} — contrato ${invoice.contractId}*`,
    ...(typeof amount === 'number' && Number.isFinite(amount)
      ? [`• Valor: *${amount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}*`] : []),
    `• Vencimento: *${dateLabel(invoice.dueDate)}*`,
    `• Situação: ${status}`,
  ].join('\n');
}

function generatedPix(result: unknown, depth = 0): string | undefined {
  if (!record(result) || depth > 3) return undefined;
  for (const key of ['pixCode', 'codigoPix', 'qrCode', 'qrcode', 'copiaECola', 'copiaecola']) {
    const value = result[key];
    if (typeof value === 'string' && /^000201\S+$/.test(value)) return value;
  }
  return generatedPix(result.payload, depth + 1);
}

/** Final preparation uses fresh, successful tool output, never audit summaries
 * or the model's paraphrase of payment data. It performs no external writes. */
export function prepareCustomerResponse(input: {
  draft: string;
  customerMessage: string;
  toolResults: AgentToolExecutionResult[];
  intent?: UniversalAutopilotIntent | null;
  now?: Date;
  timeZone?: string;
}): { response: string; mode: 'draft' | 'verified_invoice'; reason: string } {
  const fallback = { response: input.draft, mode: 'draft' as const, reason: 'no_applicable_verified_invoice' };
  if (input.intent && !['billing_or_payment', 'document_request', 'order_or_request_status', 'unknown'].includes(input.intent)) return fallback;
  const text = normalize(input.customerMessage);
  if (!/\b(?:pix|boleto|fatura|segunda via|linha digitavel|codigo de barras)\b/.test(text)
    && !/^#?\d{2,30}$/.test(text.trim())) return fallback;
  if (/\b(?:promessa|acordo|negociar|parcelar|cancelar|contestar|estorno|paguei|comprovante)\b/.test(text)) return fallback;
  const lookup = [...input.toolResults].reverse().find((result) => result.toolName === 'sgp_fetch_contact_panel_data');
  if (!lookup) return fallback;
  if (lookup.status !== 'success' || !record(lookup.output) || !Array.isArray(lookup.output.invoices)) {
    return { response: 'Não consegui confirmar os dados da fatura no SGP. Ainda não tenho um código de pagamento confirmado para enviar.',
      mode: 'verified_invoice', reason: 'sgp_lookup_unavailable' };
  }
  const selection = selectRequestedSgpInvoice({ ...input, snapshot: lookup.output });
  let response: string;
  const invoice = selection.invoice;
  if (!invoice) {
    response = selection.reason === 'invoice_ambiguous'
      ? ['Encontrei mais de uma fatura. Qual delas você deseja?', ...selection.candidates.slice(0, 6).map((item) =>
        `• Fatura ${item.id}, contrato ${item.contractId}, vencimento ${dateLabel(item.dueDate)}`),
        ...(selection.candidates.length > 6 ? ['Há outras faturas. Informe o contrato ou o mês desejado.'] : [])].join('\n')
      : 'Não localizei uma fatura que corresponda ao que você pediu. Pode informar o contrato, o número da fatura ou o mês de vencimento?';
  } else if (invoice.isPaid || invoice.isCancelled || !invoice.isOpen) {
    response = `${summary(invoice)}\n\n${invoice.isPaid ? 'Esta fatura já está paga.' : 'Esta fatura não está disponível para pagamento.'}`;
  } else {
    const wantsPix = /\bpix\b/.test(text) && !/\b(?:sem pix|nao (?:quero |preciso |mande |envie )?(?:o )?pix)\b/.test(text);
    const wantsBoleto = /\b(?:boleto|linha digitavel|codigo de barras|link)\b/.test(text)
      && !/\b(?:sem boleto|nao (?:quero |preciso |mande |envie )?(?:o )?boleto)\b/.test(text);
    const pixOnly = wantsPix && !wantsBoleto;
    const boletoOnly = !wantsPix && wantsBoleto;
    const generation = [...input.toolResults].reverse().find((result) => (
      result.toolName === 'sgp_generate_invoice_pix' && result.status === 'success'
      && result.input.type === 'sgp_generate_invoice_pix'
      && String(result.input.payload?.invoiceId) === String(invoice.id)
      && String(result.input.payload?.contractId) === String(invoice.contractId)
    ));
    const pix = invoice.pixCode || generatedPix(generation?.output);
    const sections = [summary(invoice)];
    if (!boletoOnly && pix) sections.push(`*PIX copia e cola:*\n${pix}`);
    if (!pixOnly && invoice.digitableLine) sections.push(`*Linha digitável:*\n${invoice.digitableLine}`);
    if (!pixOnly && invoice.paymentLink) sections.push(`*Boleto:*\n${invoice.paymentLink}`);
    if (pixOnly && !pix) sections.push('O SGP não retornou um PIX para esta fatura. Posso ajudar com o boleto.');
    if (sections.length === 1) sections.push('O SGP não retornou os dados de pagamento desta fatura.');
    response = sections.join('\n\n');
  }
  return { response, mode: 'verified_invoice', reason: selection.reason };
}
