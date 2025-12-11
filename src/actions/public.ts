'use server';

import { db } from '@/lib/db';
import { PLANS } from '@/lib/plans';

export async function getPublicPlanPricesAction() {
    try {
        // Fetch only stripe_price keys from system_settings
        // This is safe to expose as they are just public price IDs (not secrets)
        const keys = Object.keys(PLANS).map(p => `stripe_price_${p}`);

        const res = await db.query(`SELECT key, value FROM system_settings WHERE key = ANY($1)`, [keys]);

        const prices: Record<string, string> = {};
        res.rows.forEach(row => {
            // Convert 'stripe_price_starter' -> 'starter'
            const planKey = row.key.replace('stripe_price_', '');
            prices[planKey] = row.value;
        });

        return { prices };
    } catch (error) {
        console.error("Failed to fetch public prices:", error);
        return { prices: {} };
    }
}
