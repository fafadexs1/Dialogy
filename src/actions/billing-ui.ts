'use server';

import { db } from '@/lib/db';
import { createClient } from '@/lib/supabase/server';
import { PLANS, PlanType, PlanLimits } from '@/lib/plans';
import { getWorkspaceLimits } from '@/lib/billing-logic';

export async function getCurrentPlanAction(workspaceId: string): Promise<{
    plan: PlanType,
    limits: PlanLimits,
    details: any,
    usage: { users: number, whatsapp: number }
} | null> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    try {
        const { plan, limits } = await getWorkspaceLimits(workspaceId);

        // Parallel Usage Counts
        const [usersCountRes, whatsappCountRes] = await Promise.all([
            db.query('SELECT COUNT(*) as count FROM user_workspace_roles WHERE workspace_id = $1', [workspaceId]),
            db.query('SELECT COUNT(*) as count FROM evolution_api_instances WHERE workspace_id = $1', [workspaceId])
        ]);

        return {
            plan,
            limits,
            details: PLANS[plan],
            usage: {
                users: parseInt(usersCountRes.rows[0].count, 10),
                whatsapp: parseInt(whatsappCountRes.rows[0].count, 10)
            }
        };

    } catch (error) {
        console.error('[GET_CURRENT_PLAN] Error:', error);
        return null;
    }
}
