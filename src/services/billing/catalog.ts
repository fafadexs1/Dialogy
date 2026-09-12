import "server-only";
import { db } from "@/lib/db";
import { PLANS, normalizePlanLimits, type PlanType } from "@/lib/plans-types";
import type { OfferedPlan } from "@/lib/billing-catalog";

// One catalog for the storefront, checkout and administration. Never fall back
// to a different price if the database is unavailable.
export async function readBillingCatalog(
  includeInactive = false,
  workspaceId?: string,
): Promise<OfferedPlan[]> {
  const result = await db.query(
    `SELECT slug,name,description,price,limits,is_active,scope FROM plans p
     WHERE $1::boolean OR (p.is_active AND (p.scope='public' OR EXISTS (
       SELECT 1 FROM plan_workspaces pw WHERE pw.plan_id=p.id AND pw.workspace_id=$2::uuid
     ))) ORDER BY price`,
    [includeInactive, workspaceId || null],
  );
  return result.rows
    .filter((row) => row.slug && (includeInactive || row.is_active))
    .map((row) => {
      const id = row.slug as PlanType;
      const defaults = Object.hasOwn(PLANS, id) ? PLANS[id] : undefined;
      const description =
        !row.description ||
        /^plan(o)?\s+(Essencial|Profissional|Operacao|Operação|Enterprise)$/i.test(
          row.description,
        )
          ? defaults?.description || ""
          : row.description;
      return {
        ...defaults,
        id,
        label: row.name,
        description,
        price: Number(row.price),
        active: row.is_active,
        scope: row.scope,
        limits: normalizePlanLimits(row.limits, id),
        trialDays: defaults?.trialDays ?? 7,
      };
    })
    .sort(
      (a, b) =>
        (a.id === "enterprise" ? Infinity : a.price) -
        (b.id === "enterprise" ? Infinity : b.price),
    );
}
