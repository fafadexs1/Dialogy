'use server';

import { db } from '@/lib/db';
import { createClient } from '@/lib/supabase/server';
import { PLANS, PlanType, PlanLimits } from '@/lib/plans';
import { getWorkspaceLimits } from '@/lib/billing-logic';

export async function getCurrentPlanAction(workspaceId: string): Promise<{
    plan: PlanType,
    limits: PlanLimits,
    details: any,
    usage: { users: number, chats: number, whatsapp: number }
} | null> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const membership = await db.query(`SELECT 1 FROM workspaces w WHERE w.id=$1 AND (w.owner_id=$2 OR EXISTS(SELECT 1 FROM user_workspace_roles r WHERE r.workspace_id=w.id AND r.user_id=$2))`,[workspaceId,user.id]);
    if (!membership.rowCount) return null;

    try {
        const { plan, limits } = await getWorkspaceLimits(workspaceId);

        // Parallel Usage Counts
        const [usersCountRes, chatsCountRes, whatsappCountRes] = await Promise.all([
            db.query('SELECT COUNT(*) as count FROM user_workspace_roles WHERE workspace_id = $1', [workspaceId]),
            db.query(
                `SELECT COUNT(*) as count
                 FROM chats
                 WHERE workspace_id = $1
                   AND created_at >= date_trunc('month', CURRENT_TIMESTAMP)`,
                [workspaceId]
            ),
            db.query('SELECT COUNT(*) as count FROM evolution_api_instances WHERE workspace_id = $1', [workspaceId])
        ]);

        return {
            plan,
            limits,
            details: PLANS[plan],
            usage: {
                users: parseInt(usersCountRes.rows[0].count, 10),
                chats: parseInt(chatsCountRes.rows[0].count, 10),
                whatsapp: parseInt(whatsappCountRes.rows[0].count, 10)
            }
        };

    } catch (error) {
        console.error('[GET_CURRENT_PLAN] Error:', error);
        return null;
    }
}
