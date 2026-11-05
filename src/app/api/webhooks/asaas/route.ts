import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  readAsaasConfig,
  asaasRequest,
  AsaasError,
  type AsaasPayment,
  type AsaasSubscription,
} from "@/services/billing/asaas-client";
import {
  persistPayment,
  refreshAccess,
  withBillingLock,
} from "@/services/billing/asaas";

export const runtime = "nodejs";
const eventSchema = z.object({
  id: z.string().min(1).max(200),
  event: z.string().min(1).max(100),
  payment: z
    .object({
      id: z.string().regex(/^pay_[\w-]+$/),
      subscription: z.string().optional(),
    })
    .optional(),
  subscription: z.object({ id: z.string().regex(/^sub_[\w-]+$/) }).optional(),
});

export async function POST(request: Request) {
  try {
    const config = await readAsaasConfig();
    const supplied = Buffer.from(
      request.headers.get("asaas-access-token") || "",
    );
    const expected = Buffer.from(config.webhookToken);
    if (
      !expected.length ||
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    )
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const raw = await request.text();
    if (raw.length > 128000)
      return NextResponse.json({ error: "Payload too large" }, { status: 413 });
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    const validated = eventSchema.safeParse(parsed);
    if (!validated.success)
      return NextResponse.json({ error: "Invalid event" }, { status: 400 });
    const event = validated.data;
    if (
      (
        await db.query("SELECT 1 FROM asaas_webhook_events WHERE id=$1", [
          event.id,
        ])
      ).rowCount
    )
      return NextResponse.json({ received: true });
    const providerId = event.payment?.subscription || event.subscription?.id;
    if (!providerId)
      return NextResponse.json({ received: true, ignored: true });
    const local = (
      await db.query(
        "SELECT * FROM asaas_subscriptions WHERE subscription_id=$1",
        [providerId],
      )
    ).rows[0];
    // A create response may not have been checkpointed yet. A retry is safe.
    if (!local) {
      // A shared ASAAS account may also have subscriptions from other products.
      let provider:AsaasSubscription;
      try { provider = await asaasRequest<AsaasSubscription>(config,`/subscriptions/${encodeURIComponent(providerId)}`); }
      catch(error) { if(error instanceof AsaasError && error.status===404) return NextResponse.json({received:true,ignored:true}); throw error; }
      if (!provider.externalReference?.startsWith("dialogy:"))
        return NextResponse.json({ received: true, ignored: true });
      return NextResponse.json(
        { error: "Subscription not linked yet" },
        { status: 503 },
      );
    }
    if (local.environment !== config.environment)
      return NextResponse.json(
        { error: "Environment mismatch" },
        { status: 409 },
      );
    await withBillingLock(local.workspace_id, async (client) => {
      // Fetch the current provider state INSIDE the workspace lock. Out-of-order
      // events cannot downgrade a later payment or revive a refunded invoice.
      let payment: AsaasPayment | null = null;
      let deletedId: string | null = null;
      let recurrenceEnded = false;
      if(event.subscription) {
        try { const current=await asaasRequest<AsaasSubscription>(config,`/subscriptions/${encodeURIComponent(providerId)}`); recurrenceEnded=current.status==='INACTIVE'; }
        catch(error) { if(error instanceof AsaasError && error.status===404 && event.event==='SUBSCRIPTION_DELETED') recurrenceEnded=true; else throw error; }
      }
      if (event.payment) {
        try {
          payment = await asaasRequest<AsaasPayment>(
            config,
            `/payments/${encodeURIComponent(event.payment.id)}`,
          );
        } catch (error) {
          if (
            error instanceof AsaasError &&
            error.status === 404 &&
            event.event === "PAYMENT_DELETED"
          )
            deletedId = event.payment.id;
          else throw error;
        }
      }
      await client.query("BEGIN");
      try {
        if (payment) await persistPayment(client, local, payment);
        if (deletedId)
          await client.query(
            "UPDATE asaas_payments SET status='DELETED',updated_at=now() WHERE id=$1 AND subscription_id=$2",
            [deletedId, local.id],
          );
        if (recurrenceEnded) {
          await client.query(
            "UPDATE asaas_subscriptions SET canceled_at=COALESCE(canceled_at,now()) WHERE id=$1",
            [local.id],
          );
        }
        await refreshAccess(client, local.id);
        await client.query(
          "INSERT INTO asaas_webhook_events(id,event,payment_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
          [event.id, event.event, event.payment?.id || null],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    });
    return NextResponse.json({ received: true });
  } catch {
    // Never log webhook payloads, payer information, keys or card tokens.
    console.error("[ASAAS_WEBHOOK] Processing failed; event will be retried.");
    return NextResponse.json({ error: "Processing failed" }, { status: 503 });
  }
}
