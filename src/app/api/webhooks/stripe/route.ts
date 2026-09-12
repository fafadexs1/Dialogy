import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { recordReferralBonusForInvoice } from '@/lib/referrals-server';
import { buildPlanLimits } from '@/lib/plans-types';
import { getStripe } from '@/lib/stripe';
import { fulfillAiCreditCheckout } from '@/services/ai/credit-payments';
import { PlanType } from '@/lib/plans';
import { logAction } from '@/lib/observability/logger';
import { recordWebhookMetrics } from '@/lib/observability/metrics';
import { logToNamedDebugFile } from '@/lib/debug-file';

function logToFile(message: string) {
    logToNamedDebugFile('webhook_debug.log', message);
}

function normalizeStripeStatus(status?: string | null) {
    const normalized = (status || '').toLowerCase();

    if (normalized === 'trialling') {
        return 'trialing';
    }

    return normalized || 'inactive';
}

function getInvoiceSubscriptionId(invoice: any): string | null {
    const subscription =
        invoice?.subscription ??
        invoice?.parent?.subscription_details?.subscription ??
        null;
    return typeof subscription === 'string' ? subscription : subscription?.id || null;
}

async function updateBillingStatusBySubscriptionId(subscriptionId: string | null | undefined, status: string) {
    if (!subscriptionId) {
        return null;
    }

    const result = await db.query(
        `
            UPDATE billing_info
            SET status = $1, updated_at = NOW()
            WHERE stripe_subscription_id = $2 AND provider <> 'asaas'
            RETURNING workspace_id
        `,
        [normalizeStripeStatus(status), subscriptionId]
    );

    return result.rows[0]?.workspace_id || null;
}

async function resolveWorkspaceByStripeCustomer(
    customerId: string | null | undefined,
    status: string,
    subscriptionId?: string | null
) {
    if (!customerId) {
        return null;
    }

    const result = await db.query(
        `
            UPDATE billing_info
            SET status = $2,
                stripe_subscription_id = COALESCE($3, stripe_subscription_id),
                updated_at = NOW()
            WHERE stripe_customer_id = $1 AND provider <> 'asaas'
            RETURNING workspace_id
        `,
        [customerId, normalizeStripeStatus(status), subscriptionId || null]
    );

    return result.rows[0]?.workspace_id || null;
}

export async function POST(req: NextRequest) {
    const body = await req.text();
    const requestId = randomUUID();
    const receivedAt = Date.now();
    const payloadBytes = Buffer.byteLength(body);
    const signature = req.headers.get('Stripe-Signature') as string;

    logToFile(`Received webhook body length: ${body.length}`);

    await logAction({
        action: 'webhook_received',
        payload: {
            request_id: requestId,
            source: 'stripe',
            payload_bytes: payloadBytes,
            signature_present: Boolean(signature),
        },
    });

    let webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
        const res = await db.query("SELECT value FROM system_settings WHERE key = 'stripe_webhook_secret'");
        if (res.rows.length > 0) {
            webhookSecret = res.rows[0].value;
        }
    }

    console.log(`[Webhook Debug] Secret found: ${!!webhookSecret}, Signature present: ${!!signature}`);
    logToFile(`Secret found: ${!!webhookSecret}, Signature present: ${!!signature}`);

    if (!webhookSecret || !signature) {
        console.error('[Webhook Error] Missing secret or signature');
        logToFile('[Webhook Error] Missing secret or signature');
        await logAction({
            action: 'webhook_processed_fail',
            payload: {
                request_id: requestId,
                source: 'stripe',
                status_code: 400,
                error: 'missing_secret_or_signature',
                payload_bytes: payloadBytes,
                duration_ms: Date.now() - receivedAt,
            },
        });
        recordWebhookMetrics({
            source: 'stripe',
            status: 'fail',
            event: 'missing_secret_or_signature',
            durationMs: Date.now() - receivedAt,
        });
        return NextResponse.json({ error: 'Missing secret or signature' }, { status: 400 });
    }

    const stripe = await getStripe();
    let event;

    try {
        event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
        logToFile(`Event constructed: ${event.type}`);
    } catch (err: any) {
        console.error(`Webhook signature verification failed: ${err.message}`);
        logToFile(`Webhook signature verification failed: ${err.message}`);
        await logAction({
            action: 'webhook_processed_fail',
            payload: {
                request_id: requestId,
                source: 'stripe',
                status_code: 400,
                error: 'invalid_signature',
                payload_bytes: payloadBytes,
                duration_ms: Date.now() - receivedAt,
            },
        });
        recordWebhookMetrics({
            source: 'stripe',
            status: 'fail',
            event: 'invalid_signature',
            durationMs: Date.now() - receivedAt,
        });
        return NextResponse.json({ error: `Webhook Error: ${err.message}` }, { status: 400 });
    }

    let resolvedWorkspaceId: string | null = null;

    try {
        console.log(`[Stripe Webhook] Received event: ${event.type}`);

        switch (event.type) {
            case 'checkout.session.async_payment_succeeded':
            case 'checkout.session.completed': {
                if (await fulfillAiCreditCheckout(event.data.object)) break;
                const session = event.data.object as any;
                const workspaceId = session.metadata?.workspaceId;
                const planId = session.metadata?.planId;
                const subscriptionId = session.subscription as string | null;
                const customerId =
                    typeof session.customer === 'string'
                        ? session.customer
                        : session.customer?.id || null;

                logToFile(`Checkout Session Completed: ID=${session.id}, Metadata=${JSON.stringify(session.metadata)}`);

                if (workspaceId && planId) {
                    resolvedWorkspaceId = workspaceId;
                    const planType = planId as PlanType;
                    const monthlyChats = Number(session.metadata?.monthlyChats || 0) || undefined;
                    const newLimits = buildPlanLimits(planType, monthlyChats);
                    const subscription = subscriptionId
                        ? await stripe.subscriptions.retrieve(subscriptionId)
                        : null;
                    const billingStatus = normalizeStripeStatus(subscription?.status || 'active');

                    await db.query(
                        `
                            INSERT INTO billing_info (workspace_id, plan, status, stripe_customer_id, stripe_subscription_id, updated_at)
                            VALUES ($1, $2, $3, $4, $5, NOW())
                            ON CONFLICT (workspace_id) DO UPDATE
                            SET plan = $2,
                                status = $3,
                                stripe_customer_id = COALESCE($4, billing_info.stripe_customer_id),
                                stripe_subscription_id = $5,
                                updated_at = NOW()
                            WHERE billing_info.provider <> 'asaas'
                        `,
                        [workspaceId, planId, billingStatus, customerId, subscriptionId]
                    );

                    await db.query(
                        `
                            UPDATE workspaces
                            SET custom_limits = $1, updated_at = NOW()
                            WHERE id = $2 AND NOT EXISTS(SELECT 1 FROM billing_info b WHERE b.workspace_id=workspaces.id AND b.provider='asaas')
                        `,
                        [JSON.stringify(newLimits), workspaceId]
                    );

                    logToFile(`Plan activated for workspace ${workspaceId}`);
                } else {
                    logToFile('Checkout completed without workspaceId or planId metadata');
                }
                break;
            }

            case 'customer.subscription.updated':
            case 'customer.subscription.deleted': {
                const subscription = event.data.object as any;
                const workspaceId = subscription.metadata?.workspaceId || null;
                const mappedStatus = normalizeStripeStatus(subscription.status);

                resolvedWorkspaceId =
                    (await updateBillingStatusBySubscriptionId(subscription.id, mappedStatus)) ||
                    workspaceId;

                const planId = subscription.metadata?.planId;
                if (resolvedWorkspaceId && planId) {
                    const planType = planId as PlanType;
                    const monthlyChats = Number(subscription.metadata?.monthlyChats || 0) || undefined;
                    await db.query(
                        `UPDATE billing_info
                         SET plan = $1, status = $2, updated_at = NOW()
                         WHERE workspace_id = $3 AND provider <> 'asaas'`,
                        [planId, mappedStatus, resolvedWorkspaceId]
                    );
                    await db.query(
                        `UPDATE workspaces
                         SET custom_limits = $1, updated_at = NOW()
                         WHERE id = $2 AND NOT EXISTS(SELECT 1 FROM billing_info b WHERE b.workspace_id=workspaces.id AND b.provider='asaas')`,
                        [JSON.stringify(buildPlanLimits(planType, monthlyChats)), resolvedWorkspaceId]
                    );
                }

                logToFile(`Subscription ${subscription.id} updated to ${mappedStatus} for workspace ${resolvedWorkspaceId}`);
                break;
            }

            case 'invoice.paid':
            case 'invoice.payment_succeeded':
            case 'invoice.payment_failed':
            case 'invoice.marked_uncollectible': {
                const invoice = event.data.object as any;
                const subscriptionId = getInvoiceSubscriptionId(invoice);
                const customerId =
                    typeof invoice.customer === 'string'
                        ? invoice.customer
                        : invoice.customer?.id;
                const invoiceStatus =
                    event.type === 'invoice.payment_succeeded' || event.type === 'invoice.paid'
                        ? 'active'
                        : event.type === 'invoice.marked_uncollectible'
                            ? 'unpaid'
                            : 'past_due';

                resolvedWorkspaceId =
                    (await updateBillingStatusBySubscriptionId(subscriptionId, invoiceStatus)) ||
                    (await resolveWorkspaceByStripeCustomer(customerId, invoiceStatus, subscriptionId));
                if (event.type === 'invoice.payment_succeeded' || event.type === 'invoice.paid') {
                    const referralResult = await recordReferralBonusForInvoice(invoice, resolvedWorkspaceId);
                    logToFile(`Referral ledger result for invoice ${invoice.id}: ${JSON.stringify(referralResult)}`);
                }
                logToFile(`Invoice event ${event.type} applied to subscription ${subscriptionId}`);
                break;
            }

            default:
                logToFile(`Unhandled event type: ${event.type}`);
        }
    } catch (error: any) {
        console.error('Webhook Handler Error:', error);
        logToFile(`Webhook Handler Error: ${error.message}\nStack: ${error.stack}`);
        await logAction({
            action: 'webhook_processed_fail',
            workspaceId: resolvedWorkspaceId,
            payload: {
                request_id: requestId,
                source: 'stripe',
                status_code: 500,
                event: event?.type || 'unknown',
                duration_ms: Date.now() - receivedAt,
                error: error?.message || 'internal_error',
            },
        });
        recordWebhookMetrics({
            source: 'stripe',
            status: 'fail',
            event: event?.type || 'unknown',
            durationMs: Date.now() - receivedAt,
        });
        return NextResponse.json({ error: 'Webhook handler failed' }, { status: 500 });
    }

    await logAction({
        action: 'webhook_processed_success',
        workspaceId: resolvedWorkspaceId,
        payload: {
            request_id: requestId,
            source: 'stripe',
            status_code: 200,
            event: event?.type || 'unknown',
            duration_ms: Date.now() - receivedAt,
        },
    });
    recordWebhookMetrics({
        source: 'stripe',
        status: 'success',
        event: event?.type || 'unknown',
        durationMs: Date.now() - receivedAt,
    });

    return NextResponse.json({ received: true });
}
