import "server-only";
import { db } from "@/lib/db";
import { type PoolClient } from "pg";
import {
  readAsaasConfig,
  asaasRequest,
  safeInvoiceUrl,
  AsaasError,
  type AsaasPayment,
  type AsaasSubscription,
} from "./asaas-client";
import { readBillingCatalog } from "./catalog";
import {
  ASAAS_PAID_STATUSES,
  billingDate,
  nextMonthlyDate,
} from "@/lib/asaas-billing";

// A session lock serializes provider calls and durable checkpoints. Unlike a
// transaction around HTTP, committed IDs survive a later provider timeout.
export async function withBillingLock<T>(
  workspaceId: string,
  operation: (client: PoolClient) => Promise<T>,
) {
  const client = await db.connect();
  let locked = false;
  try {
    locked = (
      await client.query(
        "SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked",
        [`asaas:${workspaceId}`],
      )
    ).rows[0].locked;
    if (!locked)
      throw new Error(
        "Uma operação de cobrança está em andamento. Tente novamente em instantes.",
      );
    return await operation(client);
  } finally {
    let destroy = false;
    try {
      if (locked) await client.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [`asaas:${workspaceId}`]);
    } catch { destroy = true; }
    finally { client.release(destroy); }
  }
}

export async function startAsaasSubscription(
  workspaceId: string,
  planId: string,
  payer: { name: string; cpfCnpj: string; email: string },
) {
  const config = await readAsaasConfig();
  if (!config.apiKey || !config.webhookToken)
    throw new Error(
      "A cobrança ASAAS ainda está em configuração. Entre em contato com o suporte.",
    );
  const plan = (await readBillingCatalog(false, workspaceId)).find(
    (p) => p.id === planId && p.id !== "enterprise" && p.price > 0,
  );
  if (!plan)
    throw new Error("Este plano não está disponível para contratação.");
  return withBillingLock(workspaceId, async (client) => {
    const billing = (
      await client.query("SELECT * FROM billing_info WHERE workspace_id=$1", [
        workspaceId,
      ])
    ).rows[0];
    if (
      billing?.stripe_subscription_id &&
      !["canceled", "inactive", "incomplete_expired"].includes(billing.status)
    )
      throw new Error(
        "Este workspace possui uma assinatura Stripe. Solicite a migração ao suporte para evitar cobrança dupla.",
      );
    await client.query(
      `INSERT INTO asaas_subscriptions(workspace_id,environment,plan_slug,price) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
      [workspaceId, config.environment, plan.id, plan.price],
    );
    let local = (
      await client.query(
        "SELECT * FROM asaas_subscriptions WHERE workspace_id=$1 AND status <> 'superseded'",
        [workspaceId],
      )
    ).rows[0];
    if (local.environment !== config.environment)
      throw new Error(
        "A assinatura pertence a outro ambiente ASAAS. Solicite a migração ao administrador.",
      );
    if (local.canceled_at) {
      // Confirm that the old recurring contract really ended before creating another.
      if (local.subscription_id) {
        try {
          const previous = await asaasRequest<AsaasSubscription>(config, `/subscriptions/${encodeURIComponent(local.subscription_id)}`);
          if (!previous.deleted) throw new Error('O cancelamento anterior ainda não foi concluído no Asaas. Atualize a assinatura antes de contratar novamente.');
          if (previous.id !== local.subscription_id || previous.customer !== local.customer_id) throw new Error('Vínculo da assinatura anterior divergente.');
        } catch (error) {
          if (!(error instanceof AsaasError && error.status === 404)) throw error;
        }
      } else if (local.create_started_at) {
        throw new Error('A contratação anterior ainda aguarda conciliação. Nenhuma assinatura adicional será criada.');
      }
      await client.query('BEGIN');
      try {
        await client.query("UPDATE asaas_subscriptions SET status='superseded',updated_at=now() WHERE id=$1", [local.id]);
        local = (await client.query(
          `INSERT INTO asaas_subscriptions(workspace_id,environment,plan_slug,price,customer_id)
           VALUES($1,$2,$3,$4,$5) RETURNING *`,
          [workspaceId, config.environment, plan.id, plan.price, local.customer_id],
        )).rows[0];
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        if ((error as { code?: string; constraint?: string }).code === '23505' && (error as { constraint?: string }).constraint === 'asaas_subscriptions_workspace_id_key') {
          throw new Error('A nova contratação ainda precisa ser habilitada no sistema. Seu plano anterior e suas faturas foram preservados; nenhuma nova assinatura foi criada.');
        }
        throw error;
      }
    }
    if (local.plan_slug !== plan.id)
      throw new Error(
        "Já existe uma assinatura ou contratação deste workspace. Cancele ou gerencie o plano atual antes de iniciar outra.",
      );
    const reference = `dialogy:${local.id}`;
    if (!local.customer_id) {
      const existing = await asaasRequest<{ data: { id: string }[] }>(
        config,
        `/customers?externalReference=${encodeURIComponent(reference)}`,
      );
      const customer =
        existing.data[0] ||
        (await asaasRequest<{ id: string }>(config, "/customers", "POST", {
          ...payer,
          externalReference: reference,
        }));
      await client.query(
        "UPDATE asaas_subscriptions SET customer_id=$2,updated_at=now() WHERE id=$1",
        [local.id, customer.id],
      );
      local.customer_id = customer.id;
    }
    if (!local.subscription_id) {
      const existing = await asaasRequest<{ data: AsaasSubscription[] }>(
        config,
        `/subscriptions?externalReference=${encodeURIComponent(reference)}`,
      );
      let subscription = existing.data[0];
      if (
        subscription &&
        (subscription.customer !== local.customer_id ||
          Number(subscription.value) !== Number(local.price))
      )
        throw new Error(
          "Assinatura divergente. Solicite a conciliação ao suporte.",
        );
      if (!subscription) {
        if (local.create_started_at)
          throw new Error(
            "A criação está aguardando conciliação com o ASAAS. Tente novamente em instantes; nenhuma cobrança será duplicada.",
          );
        const returning = !!(await client.query("SELECT 1 FROM asaas_subscriptions WHERE workspace_id=$1 AND status='superseded' LIMIT 1", [workspaceId])).rows[0];
        const due = new Date(`${billingDate()}T12:00:00Z`);
        if (returning && billing?.access_until && new Date(billing.access_until).getTime() > Date.now()) {
          const accessDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(billing.access_until));
          due.setTime(new Date(`${accessDay}T12:00:00Z`).getTime());
          due.setUTCDate(due.getUTCDate() + 1);
        } else if (!returning) {
          due.setUTCDate(due.getUTCDate() + (billing?.stripe_subscription_id ? 0 : plan.trialDays || 0));
        }
        const dueDate = due.toISOString().slice(0, 10);
        await client.query(
          "UPDATE asaas_subscriptions SET create_started_at=now(),trial_until=$2,updated_at=now() WHERE id=$1",
          [local.id, returning ? null : `${dueDate}T23:59:59-03:00`],
        );
        try {
          subscription = await asaasRequest<AsaasSubscription>(
            config,
            "/subscriptions",
            "POST",
            {
              customer: local.customer_id,
              billingType: "UNDEFINED",
              value: Number(local.price),
              nextDueDate: dueDate,
              cycle: "MONTHLY",
              description: `Dialogy · ${plan.label}`,
              externalReference: reference,
            },
          );
        } catch (error) {
          // Only a definitive validation rejection permits another create.
          if (
            error instanceof AsaasError &&
            [400, 401, 403, 422].includes(error.status)
          )
            await client.query(
              "UPDATE asaas_subscriptions SET create_started_at=NULL WHERE id=$1",
              [local.id],
            );
          throw error;
        }
      }
      await client.query(
        "UPDATE asaas_subscriptions SET subscription_id=$2,status='trialing',updated_at=now() WHERE id=$1",
        [local.id, subscription.id],
      );
      local = (
        await client.query("SELECT * FROM asaas_subscriptions WHERE id=$1", [
          local.id,
        ])
      ).rows[0];
    }
    await client.query(
      `INSERT INTO billing_info(workspace_id,plan,status,provider,access_until) VALUES($1,$2,'trialing','asaas',$3)
      ON CONFLICT(workspace_id) DO UPDATE SET plan=CASE WHEN billing_info.provider='asaas' THEN billing_info.plan ELSE $2 END,
      status=CASE WHEN billing_info.provider='asaas' THEN billing_info.status ELSE 'trialing' END,
      provider='asaas',access_until=COALESCE(billing_info.access_until,$3),updated_at=now()`,
      [workspaceId, plan.id, local.trial_until],
    );
    const payments = await asaasRequest<{ data: AsaasPayment[] }>(
      config,
      `/subscriptions/${encodeURIComponent(local.subscription_id)}/payments?limit=100`,
    );
    for (const payment of payments.data)
      await persistPayment(client, local, payment);
    await refreshAccess(client, local.id);
    return {
      paymentId: payments.data
        .filter((p) => !p.deleted && ["PENDING", "OVERDUE"].includes(p.status))
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0]?.id || null,
      url: safeInvoiceUrl(
        payments.data
          .filter((p) => !p.deleted && !ASAAS_PAID_STATUSES.includes(p.status))
          .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0]?.invoiceUrl,
      ),
    };
  });
}

export async function persistPayment(
  client: PoolClient,
  subscription: any,
  payment: AsaasPayment,
) {
  if (
    payment.subscription !== subscription.subscription_id ||
    payment.customer !== subscription.customer_id
  )
    throw new Error("Vínculo da cobrança divergente.");
  if (
    !Number.isFinite(Number(payment.value)) ||
    Number(payment.value) <= 0 ||
    !/^\d{4}-\d{2}-\d{2}$/.test(payment.dueDate)
  )
    throw new Error("Cobrança inválida.");
  const previous = (
    await client.query(
      "SELECT plan_slug,amount FROM asaas_payments WHERE id=$1",
      [payment.id],
    )
  ).rows[0];
  // Amount changes are never allowed to silently grant a different plan.
  if (Number(payment.value) !== Number(previous?.amount ?? subscription.price))
    throw new Error("Valor da cobrança divergente do plano contratado.");
  await client.query(
    `INSERT INTO asaas_payments(id,subscription_id,plan_slug,amount,status,billing_type,due_date,paid_at,invoice_url)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(id) DO UPDATE SET status=$5,billing_type=$6,paid_at=$8,invoice_url=$9,updated_at=now()`,
    [
      payment.id,
      subscription.id,
      previous?.plan_slug || subscription.plan_slug,
      payment.value,
      payment.deleted ? "DELETED" : payment.status,
      payment.billingType,
      payment.dueDate,
      payment.paymentDate || payment.confirmedDate || null,
      safeInvoiceUrl(payment.invoiceUrl),
    ],
  );
}

export async function refreshAccess(
  client: PoolClient,
  subscriptionId: string,
) {
  const subscription = (
    await client.query("SELECT * FROM asaas_subscriptions WHERE workspace_id=(SELECT workspace_id FROM asaas_subscriptions WHERE id=$1) AND status <> 'superseded'", [
      subscriptionId,
    ])
  ).rows[0];
  const paid = (
    await client.query(
      "SELECT plan_slug,due_date::text FROM asaas_payments WHERE subscription_id IN (SELECT id FROM asaas_subscriptions WHERE workspace_id=$1) AND status=ANY($2) ORDER BY due_date DESC,paid_at DESC NULLS LAST LIMIT 1",
      [subscription.workspace_id, ASAAS_PAID_STATUSES],
    )
  ).rows[0];
  const paidUntil = paid
    ? `${nextMonthlyDate(paid.due_date)}T23:59:59-03:00`
    : null;
  const trial = (await client.query('SELECT plan_slug,trial_until FROM asaas_subscriptions WHERE workspace_id=$1 AND trial_until IS NOT NULL ORDER BY trial_until DESC LIMIT 1', [subscription.workspace_id])).rows[0];
  const trialUntil = trial?.trial_until || subscription.trial_until;
  const usePaid = !!paidUntil && new Date(paidUntil).getTime() >= new Date(trialUntil || 0).getTime();
  const accessUntil = usePaid ? paidUntil : trialUntil;
  const current = accessUntil && new Date(accessUntil).getTime() > Date.now();
  const status = current
    ? usePaid
      ? "active"
      : "trialing"
    : subscription.canceled_at
      ? "canceled"
      : "past_due";
  await client.query(
    "UPDATE asaas_subscriptions SET status=$2,paid_until=$3,updated_at=now() WHERE id=$1",
    [subscription.id, status, paidUntil],
  );
  await client.query(
    "UPDATE billing_info SET status=$2,plan=$3,access_until=$4,updated_at=now() WHERE workspace_id=$1 AND provider='asaas'",
    [
      subscription.workspace_id,
      status,
      (usePaid ? paid?.plan_slug : trial?.plan_slug) || subscription.plan_slug,
      accessUntil,
    ],
  );
}

export async function reconcileAsaasSubscription(workspaceId: string) {
  const config = await readAsaasConfig();
  return withBillingLock(workspaceId, async (client) => {
    const local = (
      await client.query(
        "SELECT * FROM asaas_subscriptions WHERE workspace_id=$1 AND status <> 'superseded'",
        [workspaceId],
      )
    ).rows[0];
    if (!local?.subscription_id) return;
    if (local.environment !== config.environment)
      throw new Error("Ambiente ASAAS divergente.");
    // Paginate fully: old refunds/overdues must not be confused with current access.
    let offset = 0;
    do {
      const page = await asaasRequest<{
        data: AsaasPayment[];
        hasMore: boolean;
      }>(
        config,
        `/subscriptions/${encodeURIComponent(local.subscription_id)}/payments?limit=100&offset=${offset}`,
      );
      for (const payment of page.data)
        await persistPayment(client, local, payment);
      if (!page.hasMore) break;
      offset += 100;
    } while (offset < 10000);
    await refreshAccess(client, local.id);
  });
}

export async function cancelAsaasSubscription(workspaceId: string) {
  const config = await readAsaasConfig();
  return withBillingLock(workspaceId, async (client) => {
    const local = (
      await client.query(
        "SELECT * FROM asaas_subscriptions WHERE workspace_id=$1 AND status <> 'superseded'",
        [workspaceId],
      )
    ).rows[0];
    if (!local?.subscription_id || local.canceled_at) return;
    if (local.environment !== config.environment)
      throw new Error("Ambiente ASAAS divergente.");
    try {
      await asaasRequest(
        config,
        `/subscriptions/${encodeURIComponent(local.subscription_id)}`,
        "DELETE",
      );
    } catch (error) {
      if (!(error instanceof AsaasError && error.status === 404)) throw error;
    }
    await client.query(
      "UPDATE asaas_subscriptions SET canceled_at=now(),updated_at=now() WHERE id=$1",
      [local.id],
    );
    await client.query(
      "UPDATE asaas_payments SET status='DELETED',updated_at=now() WHERE subscription_id=$1 AND status IN ('PENDING','OVERDUE')",
      [local.id],
    );
    await refreshAccess(client, local.id);
  });
}
