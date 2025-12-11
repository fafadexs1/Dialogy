'use server';

import { getStripe } from "@/lib/stripe";
import { createClient } from "@/lib/supabase/server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";

export async function createCheckoutSessionAction(priceId: string, planId: string) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        return { error: "Você precisa estar logado para assinar." };
    }

    try {
        const stripe = await getStripe();
        const headersList = headers();
        const origin = (await headersList).get('origin') || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

        // Get or create customer
        // Specifically, we check if we already stored a stripe_customer_id for this user's workspace
        // For simplicity, we assume 1 User = 1 Workspace (or use last_active_workspace_id)

        // 1. Get Workspace
        const workspaceResult = await db.query(`
            SELECT w.id, b.stripe_customer_id 
            FROM workspaces w
            LEFT JOIN billing_info b ON b.workspace_id = w.id
            WHERE w.owner_id = $1
            LIMIT 1
        `, [user.id]);

        if (workspaceResult.rowCount === 0) {
            return { error: "Workspace não encontrado." };
        }

        const workspace = workspaceResult.rows[0];
        let customerId = workspace.stripe_customer_id;

        // If no customer ID, create one in Stripe
        if (!customerId) {
            const customer = await stripe.customers.create({
                email: user.email,
                name: user.user_metadata?.full_name || user.email,
                metadata: {
                    userId: user.id,
                    workspaceId: workspace.id,
                }
            });
            customerId = customer.id;

            // Save to DB
            await db.query(`
                INSERT INTO billing_info (workspace_id, stripe_customer_id)
                VALUES ($1, $2)
                ON CONFLICT (workspace_id) DO UPDATE SET stripe_customer_id = $2
            `, [workspace.id, customerId]);
        }

        // Create Checkout Session
        const session = await stripe.checkout.sessions.create({
            customer: customerId,
            line_items: [
                {
                    price: priceId,
                    quantity: 1,
                },
            ],
            mode: 'subscription',
            success_url: `${origin}/superadmin/billing/settings?success=true`,
            cancel_url: `${origin}/pricing?canceled=true`,
            metadata: {
                workspaceId: workspace.id,
                planId: planId,
                userId: user.id
            },
            subscription_data: {
                metadata: {
                    workspaceId: workspace.id,
                    planId: planId
                }
            },
            allow_promotion_codes: true,
        });

        if (session.url) {
            return { url: session.url };
        } else {
            return { error: "Falha ao gerar link de pagamento." };
        }

    } catch (error: any) {
        console.error("Stripe Checkout Error:", error);
        return { error: error.message || "Erro ao conectar com Stripe." };
    }
}
