import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { Client } from "pg";
import { randomUUID } from "node:crypto";
import type { PlanDraft } from "@/lib/plan-studio";

// Opt-in verification against the configured database. Every write stays in an
// outer transaction, invisible to the app, and is rolled back after each test.
const state = vi.hoisted(() => ({
  client: null as unknown as Client,
  userId: "",
  admin: true,
}));
vi.mock("@/lib/db", () => ({
  db: {
    query: (sql: string, values?: unknown[]) => state.client.query(sql, values),
    connect: async () => ({
      query: (sql: string, values?: unknown[]) =>
        state.client.query(
          sql === "BEGIN"
            ? "SAVEPOINT plan_action"
            : sql === "COMMIT"
              ? "RELEASE SAVEPOINT plan_action"
              : sql === "ROLLBACK"
                ? "ROLLBACK TO SAVEPOINT plan_action"
                : sql,
          values,
        ),
      release: () => {},
    }),
  },
}));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  unstable_cache: (fn: unknown) => fn,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: state.admin ? { id: state.userId } : null },
      }),
    },
  }),
}));
vi.mock("@/lib/integrations-catalog", () => ({
  getIntegrationsCatalog: async () => [
    { id: "verification-only-integration", name: "Verification integration" },
  ],
}));
import { savePlan } from "@/actions/plans";
import { readBillingCatalog } from "@/services/billing/catalog";
import { PLANS } from "@/lib/plans-types";
import { draftFromPlan, updatePlanLimit } from "@/lib/plan-studio";

describe.skipIf(process.env.DIALOGY_VERIFY_DB !== "1")(
  "Custom plans: real database transaction and access boundaries",
  () => {
    let workspaceIds: string[];
    const fresh = (patch: Partial<PlanDraft> = {}): PlanDraft => ({
      scope: "custom",
      workspace_ids: [workspaceIds[0]],
      slug: `verification-${randomUUID()}`,
      name: "Transactional verification",
      description: "Not committed",
      price: 789.9,
      is_active: true,
      is_default: false,
      limits: { ...PLANS.pro.limits },
      integrations: [],
      ...patch,
    });
    beforeAll(async () => {
      state.client = new Client({ connectionString: process.env.DATABASE_URL });
      await state.client.connect();
      state.userId = (
        await state.client.query(
          "SELECT id FROM users WHERE is_superadmin=true LIMIT 1",
        )
      ).rows[0]?.id;
      workspaceIds = (
        await state.client.query(
          "SELECT id FROM workspaces ORDER BY id LIMIT 2",
        )
      ).rows.map((r) => r.id);
      if (!state.userId || workspaceIds.length !== 2)
        throw new Error(
          "Verification needs an existing admin and two workspaces.",
        );
    });
    beforeEach(async () => {
      state.admin = true;
      await state.client.query("BEGIN");
      await state.client.query("SET LOCAL statement_timeout='10s'");
    });
    afterEach(async () => {
      await state.client.query("ROLLBACK");
    });
    afterAll(async () => {
      await state.client?.end();
    });

    it("persists custom price, quotas, integration and workspace assignment together", async () => {
      const draft = fresh({
        integrations: [
          {
            integrationId: "verification-only-integration",
            isEnabled: true,
            includedQuantity: 2,
            additionalCost: 19.9,
          },
        ],
      });
      const result = await savePlan(draft);
      expect(result).toMatchObject({ success: true });
      const row = (
        await state.client.query("SELECT * FROM plans WHERE id=$1", [
          result.planId,
        ])
      ).rows[0];
      expect(row).toMatchObject({
        scope: "custom",
        price: "789.90",
        is_default: false,
      });
      expect(row.limits).toMatchObject(draft.limits);
      expect(
        (
          await state.client.query(
            "SELECT workspace_id FROM plan_workspaces WHERE plan_id=$1",
            [result.planId],
          )
        ).rows.map((r) => r.workspace_id),
      ).toEqual(draft.workspace_ids);
      expect(
        (
          await state.client.query(
            "SELECT included_quantity,additional_cost FROM plan_integrations WHERE plan_id=$1",
            [result.planId],
          )
        ).rows[0],
      ).toEqual({ included_quantity: 2, additional_cost: "19.90" });
    });
    it("returns the custom offer only to its assigned workspace, never the public storefront", async () => {
      const draft = fresh();
      expect((await savePlan(draft)).success).toBe(true);
      expect(
        (await readBillingCatalog()).some((p) => p.id === draft.slug),
      ).toBe(false);
      expect(
        (await readBillingCatalog(false, workspaceIds[1])).some(
          (p) => p.id === draft.slug,
        ),
      ).toBe(false);
      const selected = (await readBillingCatalog(false, workspaceIds[0])).find(
        (p) => p.id === draft.slug,
      );
      expect(selected).toMatchObject({
        id: draft.slug,
        price: draft.price,
        scope: "custom",
        limits: draft.limits,
      });
    });
    it.each(["anon", "authenticated"])(
      "hides private plans and integrations from the %s Data API role",
      async (role) => {
        const draft = fresh({
          integrations: [
            {
              integrationId: "verification-only-integration",
              isEnabled: true,
              includedQuantity: 1,
              additionalCost: 0,
            },
          ],
        });
        const result = await savePlan(draft);
        expect(result.success).toBe(true);
        await state.client.query(
          role === "anon"
            ? "SET LOCAL ROLE anon"
            : "SET LOCAL ROLE authenticated",
        );
        expect(
          (
            await state.client.query("SELECT id FROM plans WHERE id=$1", [
              result.planId,
            ])
          ).rowCount,
        ).toBe(0);
        expect(
          (
            await state.client.query(
              "SELECT id FROM plan_integrations WHERE plan_id=$1",
              [result.planId],
            )
          ).rowCount,
        ).toBe(0);
        expect(
          (
            await state.client.query(
              "SELECT id FROM plans WHERE slug='starter'",
            )
          ).rowCount,
        ).toBe(1);
      },
    );
    it("keeps all unrelated limits when editing one category", async () => {
      const draft = fresh();
      const created = await savePlan(draft);
      expect(created.success).toBe(true);
      const row = (
        await state.client.query("SELECT * FROM plans WHERE id=$1", [
          created.planId,
        ])
      ).rows[0];
      const editing = draftFromPlan({
        ...row,
        integrations: [],
        workspace_ids: draft.workspace_ids,
      });
      editing.limits = updatePlanLimit(editing.limits, "whatsapp_cloud", 8);
      expect((await savePlan(editing)).success).toBe(true);
      const limits = (
        await state.client.query("SELECT limits FROM plans WHERE id=$1", [
          created.planId,
        ])
      ).rows[0].limits;
      expect(limits).toEqual({
        ...draft.limits,
        whatsapp_cloud: 8,
        whatsapp: draft.limits.whatsapp_baileys + 8,
      });
    });
    it("removes the offer from a workspace when its assignment is removed", async () => {
      const draft = fresh();
      const result = await savePlan(draft);
      expect(result.success).toBe(true);
      expect(
        (
          await savePlan({
            ...draft,
            id: result.planId,
            workspace_ids: [workspaceIds[1]],
          })
        ).success,
      ).toBe(true);
      expect(
        (await readBillingCatalog(false, workspaceIds[0])).some(
          (p) => p.id === draft.slug,
        ),
      ).toBe(false);
      expect(
        (await readBillingCatalog(false, workspaceIds[1])).some(
          (p) => p.id === draft.slug,
        ),
      ).toBe(true);
    });
    it("keeps an inactive custom draft unavailable even to its assigned workspace", async () => {
      const draft = fresh({ is_active: false });
      expect((await savePlan(draft)).success).toBe(true);
      expect(
        (await readBillingCatalog(false, workspaceIds[0])).some(
          (p) => p.id === draft.slug,
        ),
      ).toBe(false);
      expect(
        (await readBillingCatalog(true)).some((p) => p.id === draft.slug),
      ).toBe(true);
    });
    it("rejects publishing a custom plan without any workspace", async () => {
      expect(await savePlan(fresh({ workspace_ids: [] }))).toMatchObject({
        success: false,
      });
    });
    it("rejects public conversion and leaves the private plan unchanged", async () => {
      const draft = fresh();
      const result = await savePlan(draft);
      expect(result.success).toBe(true);
      expect(
        (await savePlan({ ...draft, id: result.planId, scope: "public" }))
          .success,
      ).toBe(false);
      expect(
        (
          await state.client.query("SELECT scope FROM plans WHERE id=$1", [
            result.planId,
          ])
        ).rows[0].scope,
      ).toBe("custom");
    });
    it("rolls back creation when a workspace no longer exists", async () => {
      const draft = fresh({ workspace_ids: [randomUUID()] });
      expect((await savePlan(draft)).success).toBe(false);
      expect(
        (
          await state.client.query("SELECT id FROM plans WHERE slug=$1", [
            draft.slug,
          ])
        ).rowCount,
      ).toBe(0);
    });
    it("rejects unauthenticated writes", async () => {
      state.admin = false;
      expect(await savePlan(fresh())).toEqual({
        success: false,
        error: "Acesso não autorizado.",
      });
    });
  },
);
