"use server";

import { db } from "@/lib/db";
import { revalidatePath, revalidateTag } from "next/cache";
import type { Plan, Integration } from "@/lib/types";
import { planSlug, type StudioIntegration } from "@/lib/plan-studio";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getIntegrationsCatalog } from "@/lib/integrations-catalog";
import { PLANS, normalizePlanLimits, type PlanType } from "@/lib/plans-types";
import { validPlanLimits } from "@/lib/billing-catalog";

async function checkSuperAdmin(userId: string): Promise<boolean> {
  if (!userId) return false;
  const result = await db.query(
    "SELECT is_superadmin FROM users WHERE id = $1",
    [userId],
  );
  return result.rows[0]?.is_superadmin === true;
}

export async function getPlans(): Promise<{
  plans: Plan[] | null;
  availableIntegrations?: Integration[];
  workspaces?: { id: string; name: string }[];
  error?: string;
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !(await checkSuperAdmin(user.id))) {
    return { plans: null, error: "Acesso não autorizado." };
  }

  try {
    const plansRes = await db.query(
      `SELECT p.*,ARRAY(SELECT workspace_id::text FROM plan_workspaces pw WHERE pw.plan_id=p.id ORDER BY workspace_id) AS workspace_ids FROM plans p ORDER BY name`,
    );
    const workspacesRes = await db.query(
      "SELECT id,name FROM workspaces ORDER BY name,id",
    );
    const planIntegrationsRes = await db.query(
      "SELECT * FROM plan_integrations",
    );
    const allIntegrations = await getIntegrationsCatalog();

    const plans = plansRes.rows.map((plan) => {
      const planIntegrations = planIntegrationsRes.rows
        .filter((pi) => pi.plan_id === plan.id)
        .map((pi) => {
          const integrationDetails = allIntegrations.find(
            (i) => i.id === pi.integration_id,
          );
          return { ...integrationDetails, ...pi };
        });

      return {
        ...plan,
        price: Number(plan.price),
        integrations: planIntegrations,
      };
    });

    return {
      plans,
      availableIntegrations: allIntegrations,
      workspaces: workspacesRes.rows,
    };
  } catch (error: any) {
    console.error("[GET_PLANS_ACTION]", error);
    return { plans: null, error: "Falha ao buscar planos do banco de dados." };
  }
}

export async function savePlan(
  plan: Omit<Plan, "id" | "integrations"> & {
    id?: string;
    slug?: string;
    limits?: any;
    integrations?: StudioIntegration[];
  },
): Promise<{ success: boolean; error?: string; planId?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !(await checkSuperAdmin(user.id))) {
    return { success: false, error: "Acesso não autorizado." };
  }

  const { name, description, price, is_active, is_default, id, slug, limits } =
    plan;

  if (typeof name !== "string" || !name.trim() || name.trim().length > 100) {
    return { success: false, error: "O nome do plano é obrigatório." };
  }

  // Generate slug if not provided or if creating new
  const finalSlug = slug || planSlug(name);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(finalSlug) || finalSlug.length > 70)
    return {
      success: false,
      error: "Escolha um nome com letras ou números para o plano.",
    };
  if (id && !z.string().uuid().safeParse(id).success)
    return { success: false, error: "Plano inválido." };
  if (
    typeof price !== "number" ||
    !Number.isFinite(price) ||
    price < 0 ||
    price > 999999.99 ||
    (finalSlug !== "enterprise" && price <= 0) ||
    Math.abs(price * 100 - Math.round(price * 100)) > 0.00001
  )
    return {
      success: false,
      error: "Informe uma mensalidade válida, com até duas casas decimais.",
    };
  if (
    typeof is_active !== "boolean" ||
    typeof is_default !== "boolean" ||
    (is_default && !is_active)
  )
    return {
      success: false,
      error: "O plano inicial precisa estar publicado.",
    };
  if (typeof description !== "string" || description.length > 500)
    return {
      success: false,
      error: "Use uma descrição com até 500 caracteres.",
    };
  if (plan.scope !== undefined && !["public", "custom"].includes(plan.scope))
    return { success: false, error: "Tipo de plano inválido." };
  if (
    plan.workspace_ids !== undefined &&
    (!z.array(z.string().uuid()).max(1000).safeParse(plan.workspace_ids)
      .success ||
      new Set(plan.workspace_ids).size !== plan.workspace_ids.length)
  )
    return { success: false, error: "Revise os workspaces selecionados." };
  if (
    plan.scope === "custom" &&
    (is_default || Object.hasOwn(PLANS, finalSlug))
  )
    return {
      success: false,
      error:
        "Planos customizados não podem ser o plano padrão nem substituir os planos públicos existentes.",
    };
  if (plan.scope === "custom" && is_active && !plan.workspace_ids?.length)
    return {
      success: false,
      error:
        "Selecione pelo menos um workspace para disponibilizar este plano customizado.",
    };
  if (limits && !validPlanLimits(limits))
    return {
      success: false,
      error: "Revise os limites: use números inteiros positivos ou zero.",
    };
  if (plan.integrations !== undefined) {
    const parsed = z
      .array(
        z.object({
          integrationId: z.string().min(1),
          isEnabled: z.boolean(),
          includedQuantity: z.number().int().min(0).max(999999),
          additionalCost: z
            .number()
            .finite()
            .min(0)
            .max(999999.99)
            .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 0.00001),
        }),
      )
      .max(500)
      .safeParse(plan.integrations);
    if (
      !parsed.success ||
      new Set(plan.integrations.map((i) => i.integrationId)).size !==
        plan.integrations.length
    )
      return {
        success: false,
        error: "Revise as quantidades e os preços das integrações.",
      };
    const catalog = await getIntegrationsCatalog();
    if (
      plan.integrations.some(
        (i) => !catalog.some((c) => c.id === i.integrationId),
      )
    )
      return {
        success: false,
        error: "Uma integração não está mais disponível. Atualize a página.",
      };
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('dialogy-plan-catalog'))",
    );
    const existing = id
      ? (
          await client.query(
            "SELECT slug,limits,scope FROM plans WHERE id=$1 FOR UPDATE",
            [id],
          )
        ).rows[0]
      : null;
    if (id && !existing) throw new Error("Plano não encontrado.");
    if (existing && existing.slug !== finalSlug)
      throw new Error(
        "O identificador de um plano existente não pode ser alterado.",
      );
    const scope = plan.scope || existing?.scope || "public";
    if (existing && existing.scope !== scope)
      throw new Error(
        "O tipo de um plano salvo não pode ser alterado. Duplique para criar outra oferta.",
      );
    if (scope === "custom" && is_default)
      throw new Error("Um plano customizado não pode ser o plano padrão.");
    if (scope === "custom" && is_active) {
      const assignments =
        plan.workspace_ids ??
        (
          await client.query(
            "SELECT workspace_id FROM plan_workspaces WHERE plan_id=$1",
            [id],
          )
        ).rows.map((row) => row.workspace_id);
      if (!assignments.length)
        throw new Error(
          "Selecione pelo menos um workspace para disponibilizar este plano customizado.",
        );
    }
    if (plan.workspace_ids?.length) {
      const found = await client.query(
        "SELECT id FROM workspaces WHERE id=ANY($1::uuid[]) FOR KEY SHARE",
        [plan.workspace_ids],
      );
      if (found.rowCount !== plan.workspace_ids.length)
        throw new Error(
          "Um dos workspaces selecionados não existe mais. Atualize a página.",
        );
    }
    const mergedLimits = normalizePlanLimits(
      { ...existing?.limits, ...limits },
      finalSlug as PlanType,
    );

    let planId = id;

    // If is_default is true, set all other plans to false
    if (is_default) {
      await client.query(
        "UPDATE plans SET is_default = FALSE WHERE id IS DISTINCT FROM $1::uuid",
        [id || null],
      );
    }

    if (id) {
      // Update
      await client.query(
        `UPDATE plans SET name = $1, description = $2, price = $3, is_active = $4, is_default = $5, slug = $6, limits = $7, updated_at = NOW()
                 WHERE id = $8`,
        [
          name.trim(),
          description.trim(),
          price,
          is_active,
          is_default,
          finalSlug,
          mergedLimits,
          id,
        ],
      );
    } else {
      // Create
      const res = await client.query(
        `INSERT INTO plans (name, description, price, is_active, is_default, slug, limits, scope)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [
          name.trim(),
          description.trim(),
          price,
          is_active,
          is_default,
          finalSlug,
          mergedLimits,
          scope,
        ],
      );
      planId = res.rows[0].id;
    }

    if (plan.workspace_ids !== undefined) {
      const assigned = scope === "custom" ? plan.workspace_ids : [];
      await client.query(
        "DELETE FROM plan_workspaces WHERE plan_id=$1 AND NOT (workspace_id=ANY($2::uuid[]))",
        [planId, assigned],
      );
      if (assigned.length)
        await client.query(
          "INSERT INTO plan_workspaces(plan_id,workspace_id) SELECT $1,unnest($2::uuid[]) ON CONFLICT DO NOTHING",
          [planId, assigned],
        );
    }
    if (plan.integrations !== undefined) {
      for (const integration of plan.integrations) {
        await client.query(
          `INSERT INTO plan_integrations (plan_id,integration_id,included_quantity,additional_cost,is_enabled)
                    VALUES ($1,$2,$3,$4,$5) ON CONFLICT (plan_id,integration_id) DO UPDATE SET
                    included_quantity=EXCLUDED.included_quantity,additional_cost=EXCLUDED.additional_cost,is_enabled=EXCLUDED.is_enabled`,
          [
            planId,
            integration.integrationId,
            integration.includedQuantity,
            integration.additionalCost,
            integration.isEnabled,
          ],
        );
      }
    }
    await client.query("COMMIT");
    revalidatePath("/superadmin/plans");
    revalidateTag("plans", { expire: 0 });
    revalidatePath("/");
    revalidatePath("/pricing");
    revalidatePath("/settings/billing");
    return { success: true, planId };
  } catch (error: any) {
    await client.query("ROLLBACK");
    console.error("[SAVE_PLAN_ACTION]", error);
    if (error.code === "23505") {
      // Unique constraint violation (likely slug)
      return {
        success: false,
        error:
          "Já existe um plano com esse nome. Escolha outro nome para a nova oferta.",
      };
    }
    return {
      success: false,
      error:
        error instanceof Error && !("code" in error)
          ? error.message
          : "Falha ao salvar plano no banco de dados.",
    };
  } finally {
    client.release();
  }
}

export async function deletePlan(
  planId: string,
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !(await checkSuperAdmin(user.id))) {
    return { success: false, error: "Acesso não autorizado." };
  }

  try {
    const used = await db.query(
      "SELECT 1 FROM billing_info b JOIN plans p ON p.slug=b.plan WHERE p.id=$1 LIMIT 1",
      [planId],
    );
    if (used.rowCount)
      return {
        success: false,
        error:
          "Este plano tem assinaturas vinculadas. Desative a oferta para novas contratações.",
      };
    const catalog = await db.query("SELECT slug FROM plans WHERE id=$1", [
      planId,
    ]);
    if (catalog.rows[0]?.slug in PLANS)
      return {
        success: false,
        error:
          "Os planos do catálogo podem ser desativados, mas não excluídos.",
      };
    await db.query("DELETE FROM plans WHERE id = $1", [planId]);
    revalidatePath("/superadmin/plans");
    revalidateTag("plans", "default");
    return { success: true };
  } catch (error: any) {
    console.error("[DELETE_PLAN_ACTION]", error);
    return { success: false, error: "Falha ao excluir o plano." };
  }
}

export async function savePlanIntegration(data: {
  planId: string;
  integrationId: string;
  includedQuantity: number;
  additionalCost: number;
  isEnabled: boolean;
}): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !(await checkSuperAdmin(user.id))) {
    return { success: false, error: "Acesso não autorizado." };
  }

  const { planId, integrationId, includedQuantity, additionalCost, isEnabled } =
    data;

  try {
    await db.query(
      `INSERT INTO plan_integrations (plan_id, integration_id, included_quantity, additional_cost, is_enabled)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (plan_id, integration_id) DO UPDATE SET
                included_quantity = $3,
                additional_cost = $4,
                is_enabled = $5`,
      [planId, integrationId, includedQuantity, additionalCost, isEnabled],
    );
    revalidatePath("/superadmin/plans");
    revalidateTag("plans", "default");
    return { success: true };
  } catch (error: any) {
    console.error("[SAVE_PLAN_INTEGRATION_ACTION]", error);
    return {
      success: false,
      error: "Falha ao salvar configuração da integração.",
    };
  }
}
