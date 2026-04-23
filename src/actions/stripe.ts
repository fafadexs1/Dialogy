'use server';

import Stripe from 'stripe';
import { headers } from 'next/headers';
import { db } from '@/lib/db';
import { applyReferralToUser, getReferralContextForUser } from '@/lib/referrals-server';
import {
    DEFAULT_TRIAL_DAYS,
    getPlanPrice,
    isSelfServePlanType,
    PLANS,
} from '@/lib/plans-types';
import { getStripe } from '@/lib/stripe';
import { createClient } from '@/lib/supabase/server';

export type BillingOverview = {
    customerId: string | null;
    subscriptionId: string | null;
    status: string | null;
    nextBillingDate: string | null;
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    canceledAt: string | null;
    portalAvailable: boolean;
    canManage: boolean;
    isOwner: boolean;
};

type WorkspaceBillingContext = {
    workspaceId: string;
    ownerId: string;
    stripeCustomerId: string | null;
    stripeSubscriptionId: string | null;
    billingStatus: string | null;
    isOwner: boolean;
    canManage: boolean;
};

function toIsoDate(timestamp?: number | null): string | null {
    return typeof timestamp === 'number' && timestamp > 0
        ? new Date(timestamp * 1000).toISOString()
        : null;
}

function getSubscriptionPeriodRange(subscription: Stripe.Subscription) {
    const itemStarts = subscription.items.data
        .map(item => item.current_period_start)
        .filter((value): value is number => typeof value === 'number' && value > 0);
    const itemEnds = subscription.items.data
        .map(item => item.current_period_end)
        .filter((value): value is number => typeof value === 'number' && value > 0);

    return {
        currentPeriodStart: itemStarts.length > 0 ? Math.min(...itemStarts) : null,
        currentPeriodEnd: itemEnds.length > 0 ? Math.max(...itemEnds) : null,
    };
}

function getSubscriptionNextBillingDate(subscription: Stripe.Subscription): string | null {
    const { currentPeriodEnd } = getSubscriptionPeriodRange(subscription);
    const currentPeriodEndIso = toIsoDate(currentPeriodEnd);

    if (subscription.cancel_at_period_end && currentPeriodEndIso) {
        return currentPeriodEndIso;
    }

    if (['active', 'trialing', 'past_due', 'unpaid', 'incomplete'].includes(subscription.status)) {
        return currentPeriodEndIso;
    }

    return toIsoDate(subscription.ended_at) || currentPeriodEndIso;
}

async function getRequestOrigin() {
    const requestHeaders = await headers();
    return requestHeaders.get('origin') || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
}

async function getWorkspaceBillingContext(workspaceId: string, userId: string): Promise<WorkspaceBillingContext | null> {
    const result = await db.query(
        `
            SELECT
                w.id AS workspace_id,
                w.owner_id,
                b.stripe_customer_id,
                b.stripe_subscription_id,
                b.status AS billing_status,
                EXISTS (
                    SELECT 1
                    FROM user_workspace_roles uwr
                    WHERE uwr.workspace_id = w.id
                      AND uwr.user_id = $2
                ) AS is_member
            FROM workspaces w
            LEFT JOIN billing_info b ON b.workspace_id = w.id
            WHERE w.id = $1
        `,
        [workspaceId, userId]
    );

    if (result.rowCount === 0) {
        return null;
    }

    const row = result.rows[0];
    const isOwner = row.owner_id === userId;
    const canView = isOwner || row.is_member === true;

    if (!canView) {
        return null;
    }

    return {
        workspaceId: row.workspace_id,
        ownerId: row.owner_id,
        stripeCustomerId: row.stripe_customer_id || null,
        stripeSubscriptionId: row.stripe_subscription_id || null,
        billingStatus: row.billing_status || null,
        isOwner,
        canManage: isOwner,
    };
}

export async function createCheckoutSessionAction(planId: string, requestedMonthlyChats: number) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        return { error: 'Voce precisa estar logado para assinar.' };
    }

    if (!isSelfServePlanType(planId)) {
        return { error: 'O plano para grandes empresas precisa ser tratado comercialmente.' };
    }

    try {
        await applyReferralToUser(user.id);
        const referralContext = await getReferralContextForUser(user.id);
        const stripe = await getStripe();
        const origin = await getRequestOrigin();
        const plan = PLANS[planId];
        const monthlyChats = plan.limits.monthly_chats;
        const planPrice = getPlanPrice(planId);
        const unitAmountInCents = Math.round(planPrice * 100);
        const planLabel = plan.label;

        const userResult = await db.query('SELECT last_active_workspace_id FROM users WHERE id = $1', [user.id]);
        const activeWorkspaceId = userResult.rows[0]?.last_active_workspace_id;

        let query = `
            SELECT
                w.id,
                b.stripe_customer_id,
                b.stripe_subscription_id,
                b.status
            FROM workspaces w
            LEFT JOIN billing_info b ON b.workspace_id = w.id
            WHERE w.owner_id = $1
        `;
        const params = [user.id];

        if (activeWorkspaceId) {
            query += ' AND w.id = $2';
            params.push(activeWorkspaceId);
        } else {
            query += ' LIMIT 1';
        }

        const workspaceResult = await db.query(query, params);

        if (workspaceResult.rowCount === 0) {
            return { error: 'Workspace nao encontrado.' };
        }

        const workspace = workspaceResult.rows[0];
        let customerId = workspace.stripe_customer_id;

        // ---- Existing subscription: UPDATE with proration ----
        if (workspace.stripe_subscription_id && customerId) {
            try {
                const subscription = await stripe.subscriptions.retrieve(workspace.stripe_subscription_id);

                // If the subscription is canceled or expired, allow creating a new one
                if (['canceled', 'incomplete_expired'].includes(subscription.status)) {
                    // Fall through to create new checkout below
                } else {
                    // Update the existing subscription item with new price & proration
                    const subscriptionItem = subscription.items.data[0];
                    if (!subscriptionItem) {
                        return { error: 'Assinatura invalida — nenhum item encontrado.' };
                    }

                    await stripe.subscriptions.update(workspace.stripe_subscription_id, {
                        items: [
                            {
                                id: subscriptionItem.id,
                                price_data: {
                                    currency: 'brl',
                                    product: subscriptionItem.price.product as string,
                                    recurring: { interval: 'month' },
                                    unit_amount: unitAmountInCents,
                                },
                            },
                        ],
                        proration_behavior: 'create_prorations',
                        metadata: {
                            planId,
                            monthlyChats: String(monthlyChats),
                            calculatedMonthlyAmount: planPrice.toFixed(2),
                        },
                    });

                    // Update the billing_info in our database
                    await db.query(
                        `UPDATE billing_info SET plan_id = $1 WHERE workspace_id = $2`,
                        [planId, workspace.id]
                    );

                    return { success: true, updated: true };
                }
            } catch (subError: any) {
                // If subscription retrieval fails (deleted, etc.), fall through to create new
                console.warn('Could not update existing subscription, creating new checkout:', subError.message);
            }
        }

        // ---- New subscription: create checkout session ----
        if (!customerId) {
            const customer = await stripe.customers.create({
                email: user.email,
                name: user.user_metadata?.full_name || user.email,
                metadata: {
                    userId: user.id,
                    workspaceId: workspace.id,
                },
            });
            customerId = customer.id;

            await db.query(
                `
                    INSERT INTO billing_info (workspace_id, stripe_customer_id)
                    VALUES ($1, $2)
                    ON CONFLICT (workspace_id) DO UPDATE
                    SET stripe_customer_id = $2
                `,
                [workspace.id, customerId]
            );
        }

        const session = await stripe.checkout.sessions.create({
            customer: customerId,
            line_items: [
                {
                    price_data: {
                        currency: 'brl',
                        product_data: {
                            name: `Dialogy ${planLabel}`,
                            description: `Plano ${planLabel} — ${monthlyChats.toLocaleString('pt-BR')} chats/mes, usuarios ilimitados.`,
                        },
                        recurring: {
                            interval: 'month',
                        },
                        unit_amount: unitAmountInCents,
                    },
                    quantity: 1,
                },
            ],
            mode: 'subscription',
            success_url: `${origin}/settings/billing?success=true&trial_days=${DEFAULT_TRIAL_DAYS}&monthly_chats=${monthlyChats}`,
            cancel_url: `${origin}/pricing?canceled=true`,
            metadata: {
                workspaceId: workspace.id,
                planId,
                userId: user.id,
                monthlyChats: String(monthlyChats),
                calculatedMonthlyAmount: planPrice.toFixed(2),
                ...(referralContext.referredByUserId
                    ? {
                        referredByUserId: referralContext.referredByUserId,
                        referralCode: referralContext.referrerCode || '',
                    }
                    : {}),
            },
            subscription_data: {
                trial_period_days: DEFAULT_TRIAL_DAYS,
                metadata: {
                    workspaceId: workspace.id,
                    planId,
                    monthlyChats: String(monthlyChats),
                    calculatedMonthlyAmount: planPrice.toFixed(2),
                    ...(referralContext.referredByUserId
                        ? {
                            referredByUserId: referralContext.referredByUserId,
                            referralCode: referralContext.referrerCode || '',
                        }
                        : {}),
                },
            },
            allow_promotion_codes: true,
        });

        if (session.url) {
            return { url: session.url };
        }

        return { error: 'Falha ao gerar link de pagamento.' };
    } catch (error: any) {
        console.error('Stripe Checkout Error:', error);
        return { error: error.message || 'Erro ao conectar com Stripe.' };
    }
}

export async function createBillingPortalSessionAction(workspaceId: string) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        return { error: 'Nao autenticado.' };
    }

    const context = await getWorkspaceBillingContext(workspaceId, user.id);
    if (!context) {
        return { error: 'Acesso negado ao workspace.' };
    }
    if (!context.canManage) {
        return { error: 'Somente o proprietario do workspace pode gerenciar a assinatura.' };
    }
    if (!context.stripeCustomerId) {
        return { error: 'Nenhum cliente Stripe vinculado a este workspace.' };
    }

    try {
        const stripe = await getStripe();
        const origin = await getRequestOrigin();
        const session = await stripe.billingPortal.sessions.create({
            customer: context.stripeCustomerId,
            return_url: `${origin}/settings/billing`,
        });

        return { url: session.url };
    } catch (error: any) {
        console.error('Stripe Portal Error:', error);
        return { error: error.message || 'Erro ao abrir o portal da assinatura.' };
    }
}

export async function getBillingOverviewAction(workspaceId: string): Promise<{ overview?: BillingOverview; error?: string }> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        return { error: 'Nao autenticado.' };
    }

    const context = await getWorkspaceBillingContext(workspaceId, user.id);
    if (!context) {
        return { error: 'Acesso negado ao workspace.' };
    }

    const overview: BillingOverview = {
        customerId: context.stripeCustomerId,
        subscriptionId: context.stripeSubscriptionId,
        status: context.billingStatus,
        nextBillingDate: null,
        currentPeriodStart: null,
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
        canceledAt: null,
        portalAvailable: Boolean(context.stripeCustomerId),
        canManage: context.canManage,
        isOwner: context.isOwner,
    };

    if (!context.stripeSubscriptionId) {
        return { overview };
    }

    try {
        const stripe = await getStripe();
        const subscription = await stripe.subscriptions.retrieve(context.stripeSubscriptionId);
        const { currentPeriodStart, currentPeriodEnd } = getSubscriptionPeriodRange(subscription);

        overview.status = subscription.status;
        overview.currentPeriodStart = toIsoDate(currentPeriodStart);
        overview.currentPeriodEnd = toIsoDate(currentPeriodEnd);
        overview.nextBillingDate = getSubscriptionNextBillingDate(subscription);
        overview.cancelAtPeriodEnd = Boolean(subscription.cancel_at_period_end);
        overview.canceledAt = toIsoDate(subscription.canceled_at) || toIsoDate(subscription.cancel_at) || toIsoDate(subscription.ended_at);

        return { overview };
    } catch (error: any) {
        console.error('Stripe Overview Error:', error);
        return { overview };
    }
}

export async function getBillingHistoryAction(workspaceId: string) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        return { error: 'Nao autenticado.' };
    }

    const context = await getWorkspaceBillingContext(workspaceId, user.id);
    if (!context) {
        return { error: 'Acesso negado ao workspace.' };
    }

    if (!context.stripeCustomerId) {
        return { invoices: [] };
    }

    try {
        const stripe = await getStripe();
        const invoices = await stripe.invoices.list({
            customer: context.stripeCustomerId,
            limit: 12,
        });

        const formattedInvoices = invoices.data
            .filter(invoice => invoice.status !== 'draft')
            .map(invoice => ({
                id: invoice.id,
                number: invoice.number,
                created: invoice.created,
                amount_paid: invoice.amount_paid,
                amount_due: invoice.amount_due,
                status: invoice.status,
                invoice_pdf: invoice.invoice_pdf,
                currency: invoice.currency,
                hosted_invoice_url: invoice.hosted_invoice_url,
            }));

        return { invoices: formattedInvoices };
    } catch (error: any) {
        console.error('Stripe History Error:', error);
        return { error: 'Erro ao buscar historico.' };
    }
}
