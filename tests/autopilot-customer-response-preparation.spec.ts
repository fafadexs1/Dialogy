import { describe, expect, it } from 'vitest';
import { formatCustomerFacingAiResponse, splitIntoMessageBlocks } from '@/lib/ai-response-format';
import { prepareCustomerResponse, selectRequestedSgpInvoice } from '@/services/autopilot/customer-response-preparation';
import type { SGPContactPanelInvoice } from '@/plugins/sgp/types';
import type { AgentToolExecutionResult } from '@/services/agent-tools/types';

const pix = `000201${'1234567890'.repeat(36)}6304ABCD`;
const line = '12345.12345 12345.123456 12345.123456 1 12340000001000';
const link = 'https://billing.example.test/boleto/8002/?signature=abc.def&date=2026-11-10';
const now = new Date('2026-10-28T15:00:00Z');
const invoice = (overrides: Partial<SGPContactPanelInvoice> = {}): SGPContactPanelInvoice => ({
  id: '8002', contractId: '7001', status: 'aberto', amount: 10, correctedAmount: 10,
  dueDate: '2026-11-10', issueDate: '2026-10-10', daysLate: 0, paymentDate: null,
  cancellationDate: null, barcode: null, digitableLine: line, pixCode: pix, paymentLink: link,
  isOpen: true, isPaid: false, isCancelled: false, isOverdue: false, ...overrides,
});
const result = (invoices: SGPContactPanelInvoice[]): AgentToolExecutionResult => ({
  toolName: 'sgp_fetch_contact_panel_data', status: 'success',
  input: { type: 'sgp_fetch_contact_panel_data', payload: {} }, output: { invoices },
});
const prepare = (customerMessage: string, invoices = [invoice()]) => prepareCustomerResponse({
  draft: 'A fatura do mês atual é a de novembro. Código inventado.',
  customerMessage, toolResults: [result(invoices)], now,
});

describe('verified customer response preparation', () => {
  it('reconstructs the requested invoice from SGP facts and keeps all delivery artifacts intact', () => {
    const prepared = prepare('Quero minha fatura de novembro de 2026');
    expect(prepared.mode).toBe('verified_invoice');
    expect(prepared.response).toContain('8002 — contrato 7001');
    expect(prepared.response).toContain('10/11/2026');
    expect(prepared.response).not.toContain('mês atual');
    const delivered = splitIntoMessageBlocks(formatCustomerFacingAiResponse(prepared.response))
      .map((block) => formatCustomerFacingAiResponse(block)).join('\n\n');
    for (const artifact of [pix, line, link]) expect(delivered).toContain(artifact);
  });

  it('answers a PIX request using the verified code without unrelated boleto data', () => {
    const prepared = prepare('Me manda só o PIX');
    expect(prepared.response).toContain(pix);
    expect(prepared.response).not.toContain(line);
    expect(prepared.response).not.toContain(link);
  });

  it('answers a boleto request without adding PIX', () => {
    const prepared = prepare('Quero o boleto');
    expect(prepared.response).toContain(line);
    expect(prepared.response).toContain(link);
    expect(prepared.response).not.toContain(pix);
  });

  it('respects an explicit request to omit PIX', () => {
    const prepared = prepare('Não quero PIX, manda só o boleto');
    expect(prepared.response).toContain(line);
    expect(prepared.response).not.toContain(pix);
  });

  it('does not substitute the next open invoice for the paid current month', () => {
    const paid = invoice({ id: '8001', dueDate: '2026-10-10', isPaid: true, isOpen: false });
    const prepared = prepare('Quero minha fatura desse mês', [paid, invoice()]);
    expect(prepared.response).toContain('8001 — contrato 7001');
    expect(prepared.response).toContain('já está paga');
    for (const forbidden of ['8002', pix, line, link]) expect(prepared.response).not.toContain(forbidden);
  });

  it('honors the workspace timezone at the month boundary', () => {
    const prepared = prepareCustomerResponse({
      draft: 'Rascunho', customerMessage: 'Fatura deste mês', toolResults: [result([
        invoice({ id: '8001', dueDate: '2026-10-10', isPaid: true, isOpen: false }), invoice(),
      ])], now: new Date('2026-11-01T01:00:00Z'), timeZone: 'America/Sao_Paulo',
    });
    expect(prepared.response).toContain('8001 — contrato 7001');
    expect(prepared.response).not.toContain('8002');
  });

  it('asks which invoice when several remain eligible, without exposing payment codes', () => {
    const prepared = prepare('Quero o PIX', [invoice(), invoice({ id: '8003', contractId: '7002' })]);
    expect(prepared.reason).toBe('invoice_ambiguous');
    expect(prepared.response).toContain('Qual delas');
    expect(prepared.response).toContain('contrato 7002');
    expect(prepared.response).not.toContain(pix);
  });

  it('honors explicit invoice, contract and next-invoice requests', () => {
    const snapshot = { invoices: [invoice(), invoice({ id: '8003', dueDate: '2026-12-10' })] };
    expect(selectRequestedSgpInvoice({ snapshot, customerMessage: 'PIX fatura #8003', now }).invoice?.id).toBe('8003');
    expect(selectRequestedSgpInvoice({ snapshot, customerMessage: 'Próxima fatura', now }).invoice?.id).toBe('8002');
    expect(selectRequestedSgpInvoice({ snapshot, customerMessage: 'PIX contrato 7002', now }).invoice).toBeUndefined();
  });

  it('resolves relative months across the year boundary without substituting overdue invoices', () => {
    const snapshot = { invoices: [invoice({ id: '8001', dueDate: '2026-10-10' }), invoice({ dueDate: '2027-01-10' })] };
    expect(selectRequestedSgpInvoice({ snapshot, customerMessage: 'Fatura do próximo mês', now: new Date('2026-12-15T12:00:00Z') }).invoice?.id).toBe('8002');
    expect(selectRequestedSgpInvoice({ snapshot, customerMessage: 'Fatura do mês passado', now }).invoice).toBeUndefined();
  });

  it('does not reuse an older successful consultation after the latest one failed', () => {
    const prepared = prepareCustomerResponse({ draft: `Seu PIX é ${pix}`, customerMessage: 'Quero o PIX', now,
      toolResults: [result([invoice()]), { toolName: 'sgp_fetch_contact_panel_data', status: 'error',
        input: { type: 'sgp_fetch_contact_panel_data' }, error: 'SGP indisponível' }],
    });
    expect(prepared.reason).toBe('sgp_lookup_unavailable');
    expect(prepared.response).not.toContain(pix);
  });

  it('does not fabricate a missing PIX or leak a code from a different generation result', () => {
    const prepared = prepareCustomerResponse({
      draft: `Segue PIX ${pix}`, customerMessage: 'Quero o PIX', now,
      toolResults: [result([invoice({ pixCode: null })]), {
        toolName: 'sgp_generate_invoice_pix', status: 'success',
        input: { type: 'sgp_generate_invoice_pix', payload: { invoiceId: '9999', contractId: '7001' } },
        output: { payload: { codigoPix: pix } },
      }],
    });
    expect(prepared.response).not.toContain(pix);
    expect(prepared.response).toContain('não retornou um PIX');
  });

  it('includes a generated code only for the verified invoice and contract', () => {
    const prepared = prepareCustomerResponse({
      draft: 'Pronto', customerMessage: 'Quero o PIX', now,
      toolResults: [result([invoice({ pixCode: null })]), {
        toolName: 'sgp_generate_invoice_pix', status: 'success',
        input: { type: 'sgp_generate_invoice_pix', payload: { invoiceId: '8002', contractId: '7001' } },
        output: { payload: { codigoPix: pix } },
      }],
    });
    expect(prepared.response).toContain(pix);
  });

  it('leaves unrelated support and payment-promise responses with their own workflows', () => {
    for (const customerMessage of ['Meu Wi-Fi caiu', 'Promessa para pagar minha fatura amanhã']) {
      expect(prepare(customerMessage).mode).toBe('draft');
    }
  });
});

describe('payment artifact formatting regression', () => {
  it('keeps codes, links and all sections past both the old paragraph and character limits', () => {
    const raw = ['Oi!', 'Localizei seu contrato.', '📄 Fatura de novembro/2026',
      `*Linha digitável:* ${line}`, `*PIX copia e cola:*\n${pix}`, `*Boleto:*\n${link}`,
      'Aguardo sua confirmação.', 'Última seção.'].join('\n\n');
    const formatted = formatCustomerFacingAiResponse(raw, 180);
    expect(formatted).toContain('Última seção.');
    for (const artifact of [line, pix, link]) expect(formatted).toContain(artifact);
    expect(formatCustomerFacingAiResponse(formatted)).toBe(formatted);
  });

  it('does not interpret punctuation, repeated spaces or dates inside an opaque code as prose', () => {
    const opaque = '000201ABC2026-11-10.TEST6304ABCD';
    const spacedLine = line.replace(' 12345.', '   12345.');
    const formatted = formatCustomerFacingAiResponse(`Vencimento: 2026-11-10\n\n${opaque}\n\n${spacedLine}`);
    expect(formatted).toContain('10/11/2026');
    expect(formatted).toContain(opaque);
    expect(formatted).toContain(spacedLine);
  });
});
