import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  request: vi.fn(),
  config: vi.fn(),
  catalog: vi.fn(),
  release: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  db: {
    query: mocks.query,
    connect: async () => ({ query: mocks.query, release: mocks.release }),
  },
}));
vi.mock("@/services/billing/catalog", () => ({
  readBillingCatalog: mocks.catalog,
}));
vi.mock("@/services/billing/asaas-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/billing/asaas-client")>()),
  asaasRequest: mocks.request,
  readAsaasConfig: mocks.config,
}));
import { nextMonthlyDate } from "@/lib/asaas-billing";
import { planHighlights } from '@/lib/billing-catalog';
import { safeInvoiceUrl, AsaasError } from "@/services/billing/asaas-client";
import {
  persistPayment,
  refreshAccess,
  startAsaasSubscription,
  withBillingLock,
  cancelAsaasSubscription,
} from "@/services/billing/asaas";
import { PLANS } from "@/lib/plans-types";
import { POST } from "@/app/api/webhooks/asaas/route";
const local = {
  id: "local",
  workspace_id: "workspace",
  environment: "sandbox",
  customer_id: "cus_test",
  subscription_id: "sub_test",
  plan_slug: "pro",
  price: 499,
  trial_until: new Date("2020-01-01"),
  canceled_at: null,
};
const payment = {
  id: "pay_test",
  customer: "cus_test",
  subscription: "sub_test",
  value: 499,
  status: "RECEIVED",
  billingType: "PIX",
  dueDate: "2099-01-31",
  paymentDate: "2099-01-31",
  invoiceUrl: "https://www.asaas.com/i/test",
};
const client = { query: mocks.query, release: mocks.release } as any;
beforeEach(() => {
  vi.resetAllMocks();
  mocks.config.mockResolvedValue({
    environment: "sandbox",
    apiKey: "test-key",
    webhookToken: "test-token",
  });
  mocks.catalog.mockResolvedValue([PLANS.pro]);
  mocks.query.mockResolvedValue({ rows: [], rowCount: 0 });
});
describe("ASAAS billing boundaries", () => {
  it('rejects a guessed custom plan before creating any ASAAS customer or charge',async()=>{
    mocks.catalog.mockResolvedValue([]);
    await expect(startAsaasSubscription('workspace-other','exclusive-plan',{name:'Test payer',cpfCnpj:'12345678901',email:'test@example.com'})).rejects.toThrow('Este plano não está disponível');
    expect(mocks.catalog).toHaveBeenCalledWith(false,'workspace-other');
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it('does not advertise the 15000-conversation tier as unlimited',()=>{
    expect(planHighlights(PLANS.business.limits)).toContain('15.000 conversas por mês');
  });
  it.each([
    ["2024-01-31", "2024-02-29"],
    ["2025-01-31", "2025-02-28"],
    ["2025-12-31", "2026-01-31"],
  ])("renews %s at %s without date overflow", (input, expected) =>
    expect(nextMonthlyDate(input)).toBe(expected),
  );
  it("accepts only hosted HTTPS invoices", () => {
    expect(safeInvoiceUrl("https://www.asaas.com/i/abc")).toBeTruthy();
    for (const value of [
      "javascript:alert(1)",
      "https://asaas.com.evil.com/i/a",
      "http://www.asaas.com/i/a",
    ])
      expect(safeInvoiceUrl(value)).toBeNull();
  });
  it("rejects payment belonging to another customer before writing", async () => {
    await expect(
      persistPayment(client, local, { ...payment, customer: "cus_other" }),
    ).rejects.toThrow("Vínculo");
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it("rejects a changed payment amount", async () => {
    await expect(
      persistPayment(client, local, { ...payment, value: 49 }),
    ).rejects.toThrow("Valor");
    expect(mocks.query.mock.calls.some(([s]) => s.includes("INSERT"))).toBe(
      false,
    );
  });
  it("preserves the contracted plan snapshot when catalog changes", async () => {
    mocks.query.mockResolvedValueOnce({
      rows: [{ plan_slug: "starter", amount: 499 }],
    });
    await persistPayment(client, local, payment);
    expect(mocks.query.mock.calls[1][1][2]).toBe("starter");
  });
  it("does not block a paid period because an upcoming invoice is pending", async () => {
    mocks.query
      .mockResolvedValueOnce({ rows: [local] })
      .mockResolvedValueOnce({
        rows: [{ plan_slug: "pro", due_date: "2099-01-31" }],
      });
    await refreshAccess(client, "local");
    const update = mocks.query.mock.calls.find(([s]) =>
      s.includes("UPDATE billing_info"),
    );
    expect(update?.[1]).toEqual([
      "workspace",
      "active",
      "pro",
      "2099-02-28T23:59:59-03:00",
    ]);
  });
  it("revokes access after the last paid invoice is refunded and trial expired", async () => {
    mocks.query
      .mockResolvedValueOnce({ rows: [local] })
      .mockResolvedValueOnce({ rows: [] });
    await refreshAccess(client, "local");
    expect(
      mocks.query.mock.calls.find(([s]) =>
        s.includes("UPDATE billing_info"),
      )?.[1][1],
    ).toBe("past_due");
  });
  it("retains paid access after cancellation", async () => {
    mocks.query
      .mockResolvedValueOnce({ rows: [{ ...local, canceled_at: new Date() }] })
      .mockResolvedValueOnce({
        rows: [{ plan_slug: "pro", due_date: "2099-01-31" }],
      });
    await refreshAccess(client, "local");
    expect(
      mocks.query.mock.calls.find(([s]) =>
        s.includes("UPDATE billing_info"),
      )?.[1][1],
    ).toBe("active");
  });
  it("serializes concurrent checkout and releases the connection", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [{ locked: false }] });
    const operation = vi.fn();
    await expect(withBillingLock("workspace", operation)).rejects.toThrow(
      "andamento",
    );
    expect(operation).not.toHaveBeenCalled();
    expect(mocks.release).toHaveBeenCalledOnce();
  });
  it("does not issue a second subscription after an uncertain POST", async () => {
    mocks.query.mockImplementation(async (s: string) =>
      s.includes("pg_try_advisory_lock")
        ? { rows: [{ locked: true }] }
        : s.includes("SELECT * FROM asaas_subscriptions")
          ? {
              rows: [
                {
                  ...local,
                  subscription_id: null,
                  create_started_at: new Date(),
                },
              ],
            }
          : { rows: [] },
    );
    mocks.request.mockResolvedValue({ data: [] });
    await expect(
      startAsaasSubscription("workspace", "pro", {
        name: "Cliente teste",
        cpfCnpj: "00000000000",
        email: "test@example.test",
      }),
    ).rejects.toThrow("conciliação");
    expect(
      mocks.request.mock.calls.some(([, , method]) => method === "POST"),
    ).toBe(false);
  });
  it("does not change local cancellation when provider rejects it", async () => {
    mocks.query.mockImplementation(async (s: string) =>
      s.includes("pg_try_advisory_lock")
        ? { rows: [{ locked: true }] }
        : s.includes("SELECT * FROM asaas_subscriptions")
          ? { rows: [local] }
          : { rows: [] },
    );
    mocks.request.mockRejectedValue(new AsaasError(400));
    await expect(cancelAsaasSubscription("workspace")).rejects.toThrow();
    expect(
      mocks.query.mock.calls.some(([s]) => s.includes("SET canceled_at")),
    ).toBe(false);
  });
});
describe("ASAAS webhook", () => {
  function request(
    token = "test-token",
    body: unknown = {
      id: "evt_1",
      event: "PAYMENT_RECEIVED",
      payment: { id: "pay_test", subscription: "sub_test" },
    },
  ) {
    return new Request("https://example.test/api/webhooks/asaas", {
      method: "POST",
      headers: { "asaas-access-token": token },
      body: JSON.stringify(body),
    });
  }
  it("rejects missing or incorrect authentication before querying events", async () => {
    expect((await POST(request("bad"))).status).toBe(401);
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it("acknowledges duplicates without repeating provider calls", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [{ id: "evt_1" }], rowCount: 1 });
    expect((await POST(request())).status).toBe(200);
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it("ignores unrelated account subscriptions", async () => {
    mocks.request.mockResolvedValue({ externalReference: "other-product" });
    expect((await POST(request())).status).toBe(200);
    expect(mocks.query.mock.calls.some(([s]) => s === "BEGIN")).toBe(false);
  });
  it("uses current provider status rather than a stale received event", async () => {
    mocks.query.mockImplementation(async (s: string) =>
      s.includes("pg_try_advisory_lock")
        ? { rows: [{ locked: true }] }
        : s.includes("SELECT * FROM asaas_subscriptions")
          ? { rows: [local] }
          : { rows: [], rowCount: 0 },
    );
    mocks.request.mockResolvedValue({ ...payment, status: "REFUNDED" });
    expect((await POST(request())).status).toBe(200);
    expect(
      mocks.query.mock.calls.find(([s]) =>
        s.includes("INSERT INTO asaas_payments"),
      )?.[1][4],
    ).toBe("REFUNDED");
    const commit = mocks.query.mock.calls.findIndex(([s]) => s === "COMMIT");
    const event = mocks.query.mock.calls.findIndex(([s]) =>
      s.includes("INSERT INTO asaas_webhook_events"),
    );
    expect(commit).toBeGreaterThan(event);
  });
  it("leaves failed events retryable and rolls back", async () => {
    mocks.query.mockImplementation(async (s: string) => {
      if (s.includes("pg_try_advisory_lock"))
        return { rows: [{ locked: true }] };
      if (s.includes("SELECT * FROM asaas_subscriptions"))
        return { rows: [local] };
      if (s.includes("INSERT INTO asaas_payments"))
        throw new Error("DB failed");
      return { rows: [], rowCount: 0 };
    });
    mocks.request.mockResolvedValue(payment);
    expect((await POST(request())).status).toBe(503);
    expect(mocks.query.mock.calls.some(([s]) => s === "ROLLBACK")).toBe(true);
    expect(
      mocks.query.mock.calls.some(([s]) =>
        s.includes("INSERT INTO asaas_webhook_events"),
      ),
    ).toBe(false);
  });
});
