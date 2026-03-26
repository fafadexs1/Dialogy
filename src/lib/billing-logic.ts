import { db } from '@/lib/db';
import { getPlan, PlanType, PlanLimits, normalizePlanLimits } from '@/lib/plans';

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

        const planDetails = await getPlan(planType);
        const baseLimits = normalizePlanLimits(planDetails?.limits, planType);

        // Merge custom limits if they exist
        const limits: PlanLimits = normalizePlanLimits({
            ...baseLimits,
            ...(custom_limits || {})
        }, planType);

        return { plan: planType, limits };
    } catch (error) {
        console.error('[getWorkspaceLimits] Error:', error);
        // Fallback to starter if something explodes, to be safe
        return {
            plan: 'starter',
            limits: normalizePlanLimits(null, 'starter')
        };
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

export async function getMonthlyChatLimitStatus(workspaceId: string): Promise<{ allowed: boolean, limit: number, plan: PlanType, current: number }> {
    const countRes = await db.query(
        `SELECT COUNT(*) as count
         FROM chats
         WHERE workspace_id = $1
           AND created_at >= date_trunc('month', CURRENT_TIMESTAMP)`,
        [workspaceId]
    );
    const current = parseInt(countRes.rows[0]?.count || '0', 10);
    const limitCheck = await checkLimit(workspaceId, 'monthly_chats', current);

    return {
        ...limitCheck,
        current,
    };
}
