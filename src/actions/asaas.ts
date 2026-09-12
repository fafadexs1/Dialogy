"use server";

import { z } from "zod";
import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { createClient } from "@/lib/supabase/server";
import { encryptWithKey } from "@/lib/security/secret-box";
import { readBillingCatalog } from "@/services/billing/catalog";
import { readAsaasConfig, asaasRequest } from "@/services/billing/asaas-client";
import {
  startAsaasSubscription,
  cancelAsaasSubscription,
  reconcileAsaasSubscription,
} from "@/services/billing/asaas";

async function admin() {
  const {
    data: { user },
  } = await (await createClient()).auth.getUser();
  if (
    !user ||
    !(await db.query("SELECT is_superadmin FROM users WHERE id=$1", [user.id]))
      .rows[0]?.is_superadmin
  )
    throw new Error("Acesso restrito ao superadmin.");
  return user;
}
async function workspace(manage = false) {
  const {
    data: { user },
  } = await (await createClient()).auth.getUser();
  if (!user) throw new Error("Faça login para continuar.");
  const row = (
    await db.query(
      `SELECT w.id,w.name,w.owner_id FROM users u JOIN workspaces w ON w.id=u.last_active_workspace_id
    WHERE u.id=$1 AND (w.owner_id=$1 OR EXISTS(SELECT 1 FROM user_workspace_roles r WHERE r.user_id=$1 AND r.workspace_id=w.id))`,
      [user.id],
    )
  ).rows[0];
  if (!row || (manage && row.owner_id !== user.id))
    throw new Error(
      "Somente o proprietário pode gerenciar a assinatura do workspace ativo.",
    );
  return {
    id: row.id as string,
    name: row.name as string,
    canManage: row.owner_id === user.id,
    email: user.email || "",
  };
}
function message(error: unknown) {
  return error instanceof Error && !("code" in error)
    ? error.message
    : "Não foi possível concluir a operação de cobrança.";
}

export async function getAsaasBillingAction() {
  const w = await workspace();
  const [plans, subscription, invoices, config, billing] = await Promise.all([
    readBillingCatalog(false, w.id),
    db.query(
      "SELECT id,plan_slug,price::float8,status,trial_until,paid_until,canceled_at,subscription_id FROM asaas_subscriptions WHERE workspace_id=$1",
      [w.id],
    ),
    db.query(
      `SELECT p.id,p.amount::float8,p.status,p.billing_type,p.due_date::text,p.invoice_url FROM asaas_payments p JOIN asaas_subscriptions s ON s.id=p.subscription_id WHERE s.workspace_id=$1 ORDER BY p.due_date DESC LIMIT 100`,
      [w.id],
    ),
    readAsaasConfig(),
    db.query(
      "SELECT provider,status,stripe_subscription_id FROM billing_info WHERE workspace_id=$1",
      [w.id],
    ),
  ]);
  const s = subscription.rows[0];
  return {
    workspace: w,
    plans,
    ready: !!(config.apiKey && config.webhookToken),
    environment: config.environment,
    legacyStripe:
      !!billing.rows[0]?.stripe_subscription_id &&
      billing.rows[0]?.provider !== "asaas",
    subscription: s
      ? {
          plan: s.plan_slug,
          price: Number(s.price),
          status:
            s.subscription_id &&
            new Date(s.paid_until || s.trial_until || 0).getTime() < Date.now()
              ? "past_due"
              : s.status,
          canceled: !!s.canceled_at,
          accessUntil:
            s.paid_until?.toISOString() || s.trial_until?.toISOString() || null,
          linked: !!s.subscription_id,
        }
      : null,
    invoices: invoices.rows as {
      id: string;
      amount: number;
      status: string;
      billing_type: string;
      due_date: string;
      invoice_url: string | null;
    }[],
  };
}
export async function createAsaasCheckoutAction(input: {
  workspaceId: string;
  planId: string;
  name: string;
  cpfCnpj: string;
}) {
  try {
    const w = await workspace(true);
    if (input.workspaceId !== w.id)
      throw new Error(
        "O workspace ativo mudou. Atualize a página antes de contratar.",
      );
    const values = z
      .object({
        planId: z
          .string()
          .min(1)
          .max(70)
          .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
        name: z.string().trim().min(3).max(150),
        cpfCnpj: z
          .string()
          .transform((v) => v.replace(/\D/g, ""))
          .refine(
            (v) => /^\d{11}$|^\d{14}$/.test(v),
            "Informe um CPF ou CNPJ válido.",
          ),
      })
      .parse(input);
    const result = await startAsaasSubscription(w.id, values.planId, {
      name: values.name,
      cpfCnpj: values.cpfCnpj,
      email: w.email,
    });
    revalidatePath("/settings/billing");
    return { success: true, ...result };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof z.ZodError
          ? "Revise o nome e o CPF/CNPJ de cobrança."
          : message(error),
    };
  }
}
export async function cancelAsaasSubscriptionAction(workspaceId: string) {
  try {
    const w = await workspace(true);
    if (w.id !== workspaceId)
      throw new Error("O workspace ativo mudou. Atualize a página.");
    await cancelAsaasSubscription(w.id);
    revalidatePath("/settings/billing");
    return { success: true };
  } catch (error) {
    return { success: false, error: message(error) };
  }
}
export async function reconcileAsaasBillingAction() {
  try {
    const w = await workspace(true);
    await reconcileAsaasSubscription(w.id);
    revalidatePath("/settings/billing");
    return { success: true };
  } catch (error) {
    return { success: false, error: message(error) };
  }
}

export async function getAsaasSettingsAction() {
  await admin();
  const config = await readAsaasConfig();
  const event = await db.query(
    "SELECT processed_at FROM asaas_webhook_events ORDER BY processed_at DESC LIMIT 1",
  );
  return {
    environment: config.environment,
    apiKeyConfigured: !!config.apiKey,
    webhookConfigured: !!config.webhookToken,
    encryptionReady: (process.env.ASAAS_ENCRYPTION_KEY || "").length >= 32,
    webhookUrl: process.env.NEXT_PUBLIC_APP_URL
      ? `${process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "")}/api/webhooks/asaas`
      : null,
    lastEvent: event.rows[0]?.processed_at?.toISOString() || null,
  };
}
export async function saveAsaasSettingsAction(input: {
  environment: "sandbox" | "production";
  apiKey: string;
  webhookToken: string;
}) {
  try {
    await admin();
    const data = z
      .object({
        environment: z.enum(["sandbox", "production"]),
        apiKey: z.string().trim().max(4096),
        webhookToken: z.string().trim().max(200),
      })
      .parse(input);
    if (data.webhookToken && data.webhookToken.length < 32)
      throw new Error("Use ao menos 32 caracteres no token do webhook.");
    const existing = await readAsaasConfig();
    if (
      existing.environment !== data.environment &&
      (await db.query("SELECT 1 FROM asaas_subscriptions LIMIT 1")).rowCount
    )
      throw new Error(
        "Existem assinaturas neste ambiente. Use uma instalação separada para testes e produção.",
      );
    const entries = [["asaas_environment", data.environment]];
    for (const [key, value] of [
      ["asaas_api_key", data.apiKey],
      ["asaas_webhook_token", data.webhookToken],
    ])
      if (value)
        entries.push([
          key,
          encryptWithKey(
            value,
            process.env.ASAAS_ENCRYPTION_KEY,
            "ASAAS_ENCRYPTION_KEY",
          ),
        ]);
    if (!existing.webhookToken && !data.webhookToken)
      entries.push([
        "asaas_webhook_token",
        encryptWithKey(
          randomBytes(32).toString("hex"),
          process.env.ASAAS_ENCRYPTION_KEY,
          "ASAAS_ENCRYPTION_KEY",
        ),
      ]);
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      for (const [key, value] of entries)
        await client.query(
          "INSERT INTO system_settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=$2,updated_at=now()",
          [key, value],
        );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    revalidatePath("/superadmin/billing/settings");
    return { success: true };
  } catch (error) {
    return { success: false, error: message(error) };
  }
}
export async function connectAsaasWebhookAction() {
  try {
    const user = await admin();
    const config = await readAsaasConfig();
    const base = new URL(process.env.NEXT_PUBLIC_APP_URL || "http://localhost");
    if (
      base.protocol !== "https:" ||
      ["localhost", "127.0.0.1"].includes(base.hostname)
    )
      throw new Error(
        "Configure NEXT_PUBLIC_APP_URL com o endereço HTTPS público da Dialogy.",
      );
    const url = `${base.origin}/api/webhooks/asaas`;
    const list = await asaasRequest<{ data: { id: string; url: string }[] }>(
      config,
      "/webhooks?limit=100",
    );
    const found = list.data.find((w) => w.url === url);
    const body = {
      name: "Dialogy · assinaturas",
      url,
      email: user.email,
      enabled: true,
      interrupted: false,
      authToken: config.webhookToken,
      sendType: "SEQUENTIALLY",
      events: [
        "PAYMENT_CREATED",
        "PAYMENT_UPDATED",
        "PAYMENT_CONFIRMED",
        "PAYMENT_RECEIVED",
        "PAYMENT_OVERDUE",
        "PAYMENT_DELETED",
        "PAYMENT_RESTORED",
        "PAYMENT_REFUNDED",
        "PAYMENT_CHARGEBACK_REQUESTED",
        "PAYMENT_CHARGEBACK_DISPUTE",
        "PAYMENT_AWAITING_CHARGEBACK_REVERSAL",
        "SUBSCRIPTION_DELETED",
        "SUBSCRIPTION_INACTIVATED",
      ],
    };
    await asaasRequest(
      config,
      found ? `/webhooks/${encodeURIComponent(found.id)}` : "/webhooks",
      found ? "PUT" : "POST",
      body,
    );
    return { success: true };
  } catch (error) {
    return { success: false, error: message(error) };
  }
}

export async function getAsaasAdminAction() {
  await admin();
  const [plans, counts, totals, invoices, config] = await Promise.all([
    readBillingCatalog(true),
    db.query(
      `SELECT p.slug,COUNT(b.workspace_id)::int AS total,COUNT(b.workspace_id) FILTER(WHERE b.status='active')::int AS active,COUNT(b.workspace_id) FILTER(WHERE b.status='trialing')::int AS trials FROM plans p LEFT JOIN billing_info b ON b.plan=p.slug GROUP BY p.slug`,
    ),
    db.query(`SELECT COALESCE(SUM(amount) FILTER(WHERE status='RECEIVED' AND paid_at>=date_trunc('month',now())),0)::float8 AS received,
      COALESCE(SUM(amount) FILTER(WHERE status='CONFIRMED'),0)::float8 AS confirmed,
      COALESCE(SUM(amount) FILTER(WHERE status='OVERDUE'),0)::float8 AS overdue,
      COUNT(*) FILTER(WHERE status='PENDING')::int AS pending FROM asaas_payments`),
    db.query(
      `SELECT p.id,p.amount::float8,p.status,p.billing_type,p.due_date::text,p.invoice_url,w.name AS workspace,pl.name AS plan FROM asaas_payments p JOIN asaas_subscriptions s ON s.id=p.subscription_id JOIN workspaces w ON w.id=s.workspace_id LEFT JOIN plans pl ON pl.slug=p.plan_slug ORDER BY p.updated_at DESC LIMIT 100`,
    ),
    getAsaasSettingsAction(),
  ]);
  return {
    plans,
    counts: counts.rows as {
      slug: string;
      total: number;
      active: number;
      trials: number;
    }[],
    totals: totals.rows[0] as {
      received: number;
      confirmed: number;
      overdue: number;
      pending: number;
    },
    invoices: invoices.rows as {
      id: string;
      amount: number;
      status: string;
      billing_type: string;
      due_date: string;
      invoice_url: string | null;
      workspace: string;
      plan: string;
    }[],
    config,
  };
}
