import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getStripe } from "@/lib/stripe";
import { getSystemSettingsAction } from "@/actions/system-settings";
import { db } from "@/lib/db";
import { PLANS, PlanType } from "@/lib/plans";
import { logAction } from "@/lib/observability/logger";
import { recordWebhookMetrics } from "@/lib/observability/metrics";

// Force dynamic because we read headers/body
// export const dynamic = 'force-dynamic';

import * as fs from 'fs';
import * as path from 'path';

function logToFile(message: string) {
    const logPath = path.join(process.cwd(), 'webhook_debug.log');
    const timestamp = new Date().toISOString();
    fs.appendFileSync(logPath, `[${timestamp}] ${message}\n`);
}

export async function POST(req: NextRequest) {
    const body = await req.text();
    const requestId = randomUUID();
    const receivedAt = Date.now();
    const payloadBytes = Buffer.byteLength(body);
    logToFile(`Received webhook body length: ${body.length}`);
    const signature = req.headers.get("Stripe-Signature") as string;

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

    // Try asking DB for secret if not in env (server-to-server call simulation)
    // Note: getSystemSettingsAction checks for auth, so we might need direct DB query here for webhooks which are unauthenticated by default (verified by signature instead)
    if (!webhookSecret) {
        // Direct DB query solely for this system config
        const res = await db.query("SELECT value FROM system_settings WHERE key = 'stripe_webhook_secret'");
        if (res.rows.length > 0) webhookSecret = res.rows[0].value;
    }

    // DEBUG LOGS (Remove in production)
    console.log(`[Webhook Debug] Secret found: ${!!webhookSecret}, Signature present: ${!!signature}`);
    logToFile(`Secret found: ${!!webhookSecret}, Signature present: ${!!signature}`);
    if (webhookSecret) console.log(`[Webhook Debug] Secret starts with: ${webhookSecret.substring(0, 8)}...`);

    if (!webhookSecret || !signature) {
        console.error("[Webhook Error] Missing secret or signature");
        logToFile("[Webhook Error] Missing secret or signature");
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
        return NextResponse.json({ error: "Missing secret or signature" }, { status: 400 });
    }

    let event;
    const stripe = await getStripe();

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
            case "checkout.session.completed": {
                const session = event.data.object as any;
                console.log(`[Stripe Webhook] Checkout Session Completed:`, {
                    id: session.id,
                    metadata: session.metadata,
                    subscription: session.subscription
                });
                logToFile(`Checkout Session Completed: ID=${session.id}, Metadata=${JSON.stringify(session.metadata)}`);

                const workspaceId = session.metadata?.workspaceId;
                const planId = session.metadata?.planId;
                const subscriptionId = session.subscription;

                if (workspaceId && planId) {
                    resolvedWorkspaceId = workspaceId;
                    const planType = planId as PlanType;
                    const newLimits = PLANS[planType]?.limits;

                    logToFile(`Processing update for Workspace: ${workspaceId}, Plan: ${planId}`);

                    // 1. Describe subscription in billing_info
                    await db.query(`
                        INSERT INTO billing_info (workspace_id, plan, status, stripe_subscription_id, updated_at)
                        VALUES ($1, $2, 'active', $3, NOW())
                        ON CONFLICT (workspace_id) DO UPDATE
                        SET plan = $2, status = 'active', stripe_subscription_id = $3, updated_at = NOW()
                    `, [workspaceId, planId, subscriptionId]);

                    // 2. Update workspace limits directly to ensure immediate effect
                    if (newLimits) {
                        logToFile(`Updating custom_limits for workspace`);
                        await db.query(`
                            UPDATE workspaces 
                            SET custom_limits = $1, updated_at = NOW() 
                            WHERE id = $2
                        `, [JSON.stringify(newLimits), workspaceId]);
                    }

                    console.log(`[Stripe] Plan activated for workspace ${workspaceId}: ${planId}`);
                    logToFile(`Success: Plan activated for workspace ${workspaceId}`);
                } else {
                    logToFile(`Error: Missing workspaceId or planId in metadata`);
                }
                break;
            }

            case "customer.subscription.updated":
            case "customer.subscription.deleted": {
                const subscription = event.data.object as any;
                const status = subscription.status; // active, past_due, canceled, etc.
                const workspaceId = subscription.metadata?.workspaceId;
                logToFile(`Subscription updated/deleted: ${status}, Workspace=${workspaceId}`);

                // Map Stripe status to our status
                const validStatus = status === 'active' || status === 'trialling' ? 'active' : 'inactive';

                if (workspaceId) {
                    resolvedWorkspaceId = workspaceId;
                    await db.query(`
                        UPDATE billing_info 
                        SET status = $1, updated_at = NOW()
                        WHERE stripe_subscription_id = $2
                    `, [validStatus, subscription.id]);
                    console.log(`[Stripe] Subscription updated for workspace ${workspaceId}: ${status}`);
                    logToFile(`Updated billing_info status to ${validStatus}`);
                }
                break;
            }

            default:
            // Unhandled event type
        }
    } catch (error: any) {
        console.error("Webhook Handler Error:", error);
        logToFile(`Webhook Handler Error: ${error.message} \nStack: ${error.stack}`);
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
        return NextResponse.json({ error: "Webhook handler failed" }, { status: 500 });
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
