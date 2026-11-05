import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ query: vi.fn(), request: vi.fn(), config: vi.fn(), catalog: vi.fn(), release: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { query: m.query, connect: async () => ({ query: m.query, release: m.release }) } }));
vi.mock('@/services/billing/catalog', () => ({ readBillingCatalog: m.catalog }));
vi.mock('@/services/billing/asaas-client', async original => ({ ...await original<typeof import('@/services/billing/asaas-client')>(), asaasRequest: m.request, readAsaasConfig: m.config }));
import { startAsaasSubscription, refreshAccess } from '@/services/billing/asaas';
import { AsaasError } from '@/services/billing/asaas-client';
import { PLANS } from '@/lib/plans-types';

let old: any;
let current: any;
const payer = { name: 'Teste', email: 'qa@example.test', cpfCnpj: '12345678901' };
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-13T15:00:00Z'));
  old = { id: 'old', workspace_id: 'workspace', environment: 'sandbox', plan_slug: 'pro', price: 499, customer_id: 'cus_test', subscription_id: 'sub_old', canceled_at: new Date(), trial_until: new Date('2026-09-20T02:59:59Z') };
  current = old;
  m.config.mockResolvedValue({ environment: 'sandbox', apiKey: 'test', webhookToken: 'test' });
  m.catalog.mockResolvedValue([PLANS.starter, PLANS.pro]);
  m.query.mockImplementation(async (sql: string, values: any[]) => {
    if (sql.includes('pg_try_advisory_lock')) return { rows: [{ locked: true }] };
    if (sql.includes('SELECT * FROM billing_info')) return { rows: [{ provider: 'asaas', plan: 'pro', status: 'trialing', access_until: old.trial_until }] };
    if (sql.includes('SELECT * FROM asaas_subscriptions')) return { rows: [current] };
    if (sql.includes("SET status='superseded'")) { old.status = 'superseded'; return { rows: [] }; }
    if (sql.includes('INSERT INTO asaas_subscriptions') && sql.includes('RETURNING')) {
      current = { id: 'new', workspace_id: values[0], environment: values[1], plan_slug: values[2], price: values[3], customer_id: values[4], canceled_at: null, trial_until: null };
      return { rows: [current] };
    }
    if (sql.includes("SELECT 1 FROM asaas_subscriptions") && sql.includes("status='superseded'")) return { rows: old.status === 'superseded' ? [{ exists: true }] : [] };
    if (sql.includes('SET create_started_at=now()')) { current.create_started_at = new Date(); current.trial_until = values[1]; }
    if (sql.includes('SET subscription_id=$2')) current.subscription_id = values[1];
    if (sql.includes('SELECT plan_slug,trial_until')) return { rows: [{ plan_slug: old.plan_slug, trial_until: old.trial_until }] };
    return { rows: [], rowCount: 1 };
  });
  m.request.mockImplementation(async (_config, path: string, method = 'GET', body?: any) => {
    if (path === '/subscriptions/sub_old') throw new AsaasError(404);
    if (path.startsWith('/subscriptions?')) return { data: [] };
    if (path === '/subscriptions' && method === 'POST') return { id: 'sub_new', customer: 'cus_test', value: body.value };
    if (path.endsWith('/payments?limit=100')) return { data: [] };
    throw new Error(`Unexpected provider operation: ${method}`);
  });
});
afterEach(() => vi.useRealTimers());

describe('new subscription after cancellation', () => {
  it('preserves the old contract and trial, creates a new reference, and accepts a different allowed plan', async () => {
    await startAsaasSubscription('workspace', 'starter', payer);
    expect(old.status).toBe('superseded');
    expect(current.id).toBe('new');
    expect(current.trial_until).toBeNull();
    const post = m.request.mock.calls.find(([, path, method]) => path === '/subscriptions' && method === 'POST');
    expect(post?.[3]).toMatchObject({ customer: 'cus_test', value: PLANS.starter.price, externalReference: 'dialogy:new', nextDueDate: '2026-09-20' });
    const access = m.query.mock.calls.find(([sql]) => sql.includes('UPDATE billing_info'));
    expect(access?.[1]).toEqual(['workspace', 'trialing', 'pro', old.trial_until]);
    expect(m.query.mock.calls.some(([sql]) => /DELETE FROM/.test(sql))).toBe(false);
  });
  it('does not grant another trial after the old access expires', async () => {
    old.trial_until = new Date('2026-08-01');
    await startAsaasSubscription('workspace', 'starter', payer);
    expect(current.trial_until).toBeNull();
    expect(m.request.mock.calls.find(([, path, method]) => path === '/subscriptions' && method === 'POST')?.[3].nextDueDate).toBe('2026-09-13');
    expect(m.query.mock.calls.find(([sql]) => sql.includes('UPDATE billing_info'))?.[1][1]).toBe('past_due');
  });
  it('refuses to create while the old provider contract is still active', async () => {
    m.request.mockResolvedValue({ id: 'sub_old', customer: 'cus_test', status: 'ACTIVE' });
    await expect(startAsaasSubscription('workspace', 'starter', payer)).rejects.toThrow('cancelamento anterior');
    expect(m.query.mock.calls.some(([sql]) => sql.includes("SET status='superseded'"))).toBe(false);
    expect(m.request.mock.calls.some(([, , method]) => method === 'POST')).toBe(false);
  });
  it('keeps the old contract if the provider cannot confirm its removal', async () => {
    m.request.mockRejectedValue(new AsaasError(503));
    await expect(startAsaasSubscription('workspace', 'starter', payer)).rejects.toThrow();
    expect(m.query.mock.calls.some(([sql]) => sql === 'BEGIN')).toBe(false);
  });
  it('rolls back replacement if inserting the new contract fails', async () => {
    const original = m.query.getMockImplementation()!;
    m.query.mockImplementation(async (...args) => {
      if (String(args[0]).includes('INSERT INTO asaas_subscriptions') && String(args[0]).includes('RETURNING')) throw new Error('constraint');
      return original(...args);
    });
    await expect(startAsaasSubscription('workspace', 'starter', payer)).rejects.toThrow('constraint');
    expect(m.query.mock.calls.some(([sql]) => sql === 'ROLLBACK')).toBe(true);
    expect(m.request.mock.calls.some(([, , method]) => method === 'POST')).toBe(false);
  });
  it('keeps uncertain creation blocked on retry rather than issuing another subscription', async () => {
    const original = m.request.getMockImplementation()!;
    m.request.mockImplementation(async (...args) => {
      if (args[1] === '/subscriptions' && args[2] === 'POST') throw new Error('timeout');
      return original(...args);
    });
    await expect(startAsaasSubscription('workspace', 'starter', payer)).rejects.toThrow('timeout');
    await expect(startAsaasSubscription('workspace', 'starter', payer)).rejects.toThrow('conciliação');
    expect(m.request.mock.calls.filter(([, path, method]) => path === '/subscriptions' && method === 'POST')).toHaveLength(1);
  });
  it('recalculates the current contract after an event from a historical contract', async () => {
    current = { ...old, id: 'new', plan_slug: 'starter', canceled_at: null, trial_until: null };
    await refreshAccess({ query: m.query } as any, 'old');
    const lookup = m.query.mock.calls.find(([sql]) => sql.includes('SELECT * FROM asaas_subscriptions'));
    expect(lookup?.[0]).toContain("status <> 'superseded'");
    expect(lookup?.[1]).toEqual(['old']);
    expect(m.query.mock.calls.find(([sql]) => sql.includes('UPDATE asaas_subscriptions SET status'))?.[1][0]).toBe('new');
    expect(m.query.mock.calls.find(([sql]) => sql.includes('UPDATE billing_info'))?.[1][2]).toBe('pro');
  });
});
