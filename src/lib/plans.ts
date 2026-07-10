import 'server-only';

import { db } from '@/lib/db';
import { unstable_cache } from 'next/cache';
import { PlanType, PlanDetails, normalizePlanLimits } from './plans-types';

export * from './plans-types'; // Re-export for server-side consumers if needed, but client should use plans-types directly

// Helper to wrap unstable_cache to avoid throwing inside non-Next.js environments (like background workers)
function safe_unstable_cache<T extends (...args: any[]) => Promise<any>>(
    cb: T,
    keyParts?: string[],
    options?: {
        revalidate?: number | false;
        tags?: string[];
    }
): T {
    try {
        const cachedFn = unstable_cache(cb, keyParts, options);
        return (async (...args: Parameters<T>) => {
            try {
                return await cachedFn(...args);
            } catch (error: any) {
                if (error instanceof Error && error.message.includes('incrementalCache')) {
                    return await cb(...args);
                }
                throw error;
            }
        }) as unknown as T;
    } catch (error: any) {
        return cb;
    }
}

export const getPlan = safe_unstable_cache(
    async (slug: string) => {
        const res = await db.query('SELECT * FROM plans WHERE slug = $1', [slug]);
        if (res.rowCount === 0) return null;

        const plan = res.rows[0];
        const planType = plan.slug as PlanType;
        // Ensure limits match the interface structure
        return {
            id: planType,
            label: plan.name,
            price: plan.price,
            limits: normalizePlanLimits(plan.limits as any, planType),
            stripePriceId: plan.stripe_price_id
        } as PlanDetails;
    },
    ['get-plan-by-slug'],
    { tags: ['plans'], revalidate: false }
);

export const getAllPlans = safe_unstable_cache(
    async () => {
        const res = await db.query('SELECT * FROM plans WHERE is_active = true ORDER BY price ASC');
        return res.rows.map(plan => ({
            id: plan.slug as PlanType,
            label: plan.name,
            price: plan.price,
            limits: normalizePlanLimits(plan.limits as any, plan.slug as PlanType),
            stripePriceId: plan.stripe_price_id
        })) as PlanDetails[];
    },
    ['get-all-plans'],
    { tags: ['plans'], revalidate: false }
);

