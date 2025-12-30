import 'server-only';

import { db } from '@/lib/db';
import { unstable_cache } from 'next/cache';
import { PlanType, PlanLimits, PlanDetails, PLANS as DEFAULT_PLANS } from './plans-types';

export * from './plans-types'; // Re-export for server-side consumers if needed, but client should use plans-types directly

export const getPlan = unstable_cache(
    async (slug: string) => {
        const res = await db.query('SELECT * FROM plans WHERE slug = $1', [slug]);
        if (res.rowCount === 0) return null;

        const plan = res.rows[0];
        // Ensure limits match the interface structure
        return {
            id: plan.slug as PlanType,
            label: plan.name,
            price: plan.price,
            limits: plan.limits as any as PlanLimits,
            stripePriceId: plan.stripe_price_id
        } as PlanDetails;
    },
    ['get-plan-by-slug'],
    { tags: ['plans'], revalidate: false }
);

export const getAllPlans = unstable_cache(
    async () => {
        const res = await db.query('SELECT * FROM plans WHERE is_active = true ORDER BY price ASC');
        return res.rows.map(plan => ({
            id: plan.slug as PlanType,
            label: plan.name,
            price: plan.price,
            limits: plan.limits as any as PlanLimits,
            stripePriceId: plan.stripe_price_id
        })) as PlanDetails[];
    },
    ['get-all-plans'],
    { tags: ['plans'], revalidate: false }
);
