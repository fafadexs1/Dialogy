import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ query: vi.fn(), request: vi.fn(), config: vi.fn(), release: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { query: m.query, connect: async () => ({ query: m.query, release: m.release }) } }));
vi.mock('@/services/billing/catalog', () => ({ readBillingCatalog: vi.fn() }));
vi.mock('@/services/billing/asaas-client', async original => ({
  ...await original<typeof import('@/services/billing/asaas-client')>(), asaasRequest: m.request, readAsaasConfig: m.config,
}));
import { AsaasError } from '@/services/billing/asaas-client';
import { readCheckoutPayment, prepareCheckoutPayment, payCheckoutWithCard } from '@/services/billing/asaas-checkout';
import { cardPaymentSchema, type CardPayment } from '@/lib/asaas-checkout';

const card: CardPayment = {
  creditCard: { holderName: 'Teste Sandbox', number: '4111111111111111', expiryMonth: '12', expiryYear: '2099', ccv: '123' },
  creditCardHolderInfo: { name: 'Teste Sandbox', email: 'qa@example.test', cpfCnpj: '12345678901', postalCode: '01310100', addressNumber: '100', phone: '11999999999' },
};
let local: any;
let payment: any;
beforeEach(() => {
  vi.resetAllMocks();
  local = { id: 'local', workspace_id: 'workspace', subscription_id: 'sub_test', customer_id: 'cus_test', environment: 'sandbox', price: 499, plan_slug: 'pro', card_attempt_started_at: null };
  payment = { id: 'pay_test', subscription: 'sub_test', customer: 'cus_test', value: 499, dueDate: '2099-12-12', status: 'PENDING', billingType: 'UNDEFINED', bankSlipUrl: 'https://www.asaas.com/b/pdf' };
  m.config.mockResolvedValue({ environment: 'sandbox', apiKey: 'test', webhookToken: 'test' });
  m.query.mockImplementation(async (sql: string) => {
    if (sql.includes('pg_try_advisory_lock')) return { rows: [{ locked: true }] };
    if (sql.includes('SET card_attempt_started_at=now()')) local.card_attempt_started_at = new Date();
    if (sql.includes('SET card_attempt_started_at=NULL')) local.card_attempt_started_at = null;
    if (sql.includes('SELECT s.*') || sql.includes('SELECT * FROM asaas_subscriptions')) return { rows: local ? [local] : [] };
    if (sql.includes('SELECT plan_slug,amount')) return { rows: [{ amount: 499, plan_slug: 'pro' }] };
    return { rows: [], rowCount: 1 };
  });
  m.request.mockImplementation(async (_config, path: string, method = 'GET', body?: any) => {
    if (path.endsWith('/pixQrCode')) return { encodedImage: 'png', payload: 'pix-code', expirationDate: '2099-12-12 23:59:59' };
    if (path.endsWith('/identificationField')) return { identificationField: 'boleto-code' };
    if (method === 'PUT') { payment = { ...payment, billingType: body.billingType }; return payment; }
    if (path.endsWith('/payWithCreditCard')) { payment = { ...payment, billingType: 'CREDIT_CARD', status: 'CONFIRMED' }; return { ...payment, creditCard: { creditCardToken: 'must-not-leak' } }; }
    return payment;
  });
});

describe('transparent checkout boundaries', () => {
  it('rejects another workspace invoice before reading provider credentials', async () => {
    local = null;
    await expect(readCheckoutPayment('foreign', 'pay_test')).rejects.toThrow('Fatura não encontrada');
    expect(m.query.mock.calls.find(([sql]) => sql.includes('SELECT s.*'))?.[1]).toEqual(['foreign', 'pay_test']);
    expect(m.config).not.toHaveBeenCalled(); expect(m.request).not.toHaveBeenCalled();
  });
  it('rejects a mismatched environment without contacting the provider', async () => {
    local.environment = 'production';
    await expect(readCheckoutPayment('workspace', 'pay_test')).rejects.toThrow('ambiente');
    expect(m.request).not.toHaveBeenCalled();
  });
  it.each([{ customer: 'other' }, { subscription: 'other' }, { value: 1 }, { id: 'pay_other' }])('rejects provider association/value mismatch %j', async fields => {
    Object.assign(payment, fields);
    await expect(payCheckoutWithCard('workspace', 'pay_test', card)).rejects.toThrow();
    expect(m.request.mock.calls.some(([, path]) => path.endsWith('/payWithCreditCard'))).toBe(false);
  });
  it.each(['CONFIRMED', 'RECEIVED', 'REFUNDED', 'DELETED', 'AWAITING_RISK_ANALYSIS', 'CHARGEBACK_REQUESTED'])('does not charge or switch methods for %s', async status => {
    payment.status = status;
    const result = await payCheckoutWithCard('workspace', 'pay_test', card);
    expect(result.canPay).toBe(false);
    expect(m.request.mock.calls.some(([, , method]) => method === 'POST' || method === 'PUT')).toBe(false);
  });
  it('prepares Pix using the existing invoice and server-owned amount/date', async () => {
    const result = await prepareCheckoutPayment('workspace', 'pay_test', 'PIX');
    expect(result.pix?.code).toBe('pix-code');
    expect(m.request.mock.calls.find(([, , method]) => method === 'PUT')?.[3]).toEqual({ billingType: 'PIX', value: 499, dueDate: '2099-12-12' });
    expect(m.request.mock.calls.some(([, , method]) => method === 'POST')).toBe(false);
  });
  it('returns boleto code but rejects a foreign PDF URL', async () => {
    payment.bankSlipUrl = 'https://attacker.example/boleto';
    const result = await prepareCheckoutPayment('workspace', 'pay_test', 'BOLETO');
    expect(result.boleto).toEqual({ code: 'boleto-code', url: null });
  });
  it('commits the durable checkpoint before paying, uses a 65s timeout and never returns card data', async () => {
    const result = await payCheckoutWithCard('workspace', 'pay_test', card);
    expect(result.paid).toBe(true);
    const checkpoint = m.query.mock.calls.findIndex(([sql]) => sql.includes('card_attempt_started_at=now()'));
    const post = m.request.mock.calls.findIndex(([, path]) => path.endsWith('/payWithCreditCard'));
    expect(m.query.mock.invocationCallOrder[checkpoint]).toBeLessThan(m.request.mock.invocationCallOrder[post]);
    expect(m.request.mock.calls[post][4]).toBe(65000);
    expect(JSON.stringify(result)).not.toMatch(/411111|creditCard|must-not-leak|ccv/);
    expect(JSON.stringify(m.query.mock.calls)).not.toContain('4111111111111111');
  });
  it('survives a timeout and blocks another card attempt and alternate payment methods', async () => {
    const original = m.request.getMockImplementation()!;
    m.request.mockImplementation(async (...args) => {
      if (String(args[1]).endsWith('/payWithCreditCard')) throw new Error('timeout');
      return original(...args);
    });
    expect((await payCheckoutWithCard('workspace', 'pay_test', card)).awaitingConfirmation).toBe(true);
    await payCheckoutWithCard('workspace', 'pay_test', card);
    expect((await prepareCheckoutPayment('workspace', 'pay_test', 'PIX')).pix).toBeUndefined();
    expect(m.request.mock.calls.filter(([, path]) => path.endsWith('/payWithCreditCard'))).toHaveLength(1);
    payment.status = 'CONFIRMED';
    expect((await readCheckoutPayment('workspace', 'pay_test')).paid).toBe(true);
  });
  it('allows a deliberate retry only after a definitive card rejection', async () => {
    const original = m.request.getMockImplementation()!;
    m.request.mockImplementation(async (...args) => {
      if (String(args[1]).endsWith('/payWithCreditCard')) throw new AsaasError(400);
      return original(...args);
    });
    await expect(payCheckoutWithCard('workspace', 'pay_test', card)).rejects.toThrow('não foi autorizado');
    expect(local.card_attempt_started_at).toBeNull();
    expect((await readCheckoutPayment('workspace', 'pay_test')).canPay).toBe(true);
  });
  it.each(['REFUNDED', 'CHARGEBACK_REQUESTED', 'CHARGEBACK_DISPUTE', 'DELETED'])('shows terminal status %s after an uncertain attempt without allowing another charge', async status => {
    local.card_attempt_started_at = new Date();
    payment.status = status;
    const result = await readCheckoutPayment('workspace', 'pay_test');
    expect(result).toMatchObject({ status, canPay: false, awaitingConfirmation: false, paid: false });
    await payCheckoutWithCard('workspace', 'pay_test', card);
    expect(m.request.mock.calls.some(([, , method]) => method === 'POST' || method === 'PUT')).toBe(false);
  });
  it('keeps the checkpoint if persistence fails after the card was charged', async () => {
    const original = m.query.getMockImplementation()!;
    m.query.mockImplementation(async (...args) => {
      if (String(args[0]).includes('INSERT INTO asaas_payments') && payment.status === 'CONFIRMED') throw new Error('database unavailable');
      return original(...args);
    });
    await expect(payCheckoutWithCard('workspace', 'pay_test', card)).rejects.toThrow();
    expect(local.card_attempt_started_at).not.toBeNull();
  });
  it('rejects invalid card numbers and expired cards before submitting them', () => {
    expect(cardPaymentSchema.safeParse(card).success).toBe(true);
    expect(cardPaymentSchema.safeParse({ ...card, creditCard: { ...card.creditCard, number: '4111111111111112' } }).success).toBe(false);
    expect(cardPaymentSchema.safeParse({ ...card, creditCard: { ...card.creditCard, expiryYear: '2020' } }).success).toBe(false);
  });
});
