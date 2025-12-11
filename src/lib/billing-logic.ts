import { db } from '@/lib/db';
import { PLANS, PlanType, PlanLimits } from '@/lib/plans';

export async function getWorkspaceLimits(workspaceId: string): Promise<{ plan: PlanType, limits: PlanLimits }> {
    try {
        const res = await db.query(
            `SELECT 
                COALESCE(b.plan, 'starter') as plan, 
                w.custom_limits 
             FROM workspaces w
             LEFT JOIN billing_info b ON b.workspace_id = w.id
             WHERE w.id = $1`,
            [workspaceId]
        );

        if (res.rowCount === 0) {
            throw new Error('Workspace not found');
        }

        const { plan, custom_limits } = res.rows[0];
        const planType = (plan as PlanType) || 'starter';
        const baseLimits = PLANS[planType].limits;

        // Merge custom limits if they exist
        const limits: PlanLimits = {
            ...baseLimits,
            ...(custom_limits || {})
        };

        return { plan: planType, limits };
    } catch (error) {
        console.error('[getWorkspaceLimits] Error:', error);
        // Fallback to starter if something explodes, to be safe
        return { plan: 'starter', limits: PLANS['starter'].limits };
    }
}

export async function checkLimit(workspaceId: string, feature: keyof PlanLimits, currentCount: number = 0): Promise<{ allowed: boolean, limit: number, plan: PlanType }> {
    const { plan, limits } = await getWorkspaceLimits(workspaceId);
    const limit = limits[feature];

    if (typeof limit === 'boolean') {
        return { allowed: limit, limit: limit ? 1 : 0, plan };
    }

    if (typeof limit === 'string') {
        // For 'moderate'/'high' strings, we assume allowed if not false (logic handled by caller usually, but here just return true)
        return { allowed: true, limit: 0, plan };
    }

    return { allowed: currentCount < (limit as number), limit: limit as number, plan };
}
