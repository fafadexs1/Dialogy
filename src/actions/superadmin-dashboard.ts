'use server';

import { db } from '@/lib/db';
import { createClient } from '@/lib/supabase/server';
import { PLANS } from '@/lib/plans';

export interface DashboardStats {
    totalUsers: number;
    totalWorkspaces: number;
    activeInstances: number;
    revenue: number; // Mocked for now, or calculated from invoices if available
    plansDistribution: Record<string, number>;
}

export async function getSuperAdminStatsAction(): Promise<DashboardStats | null> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    // Basic security check (ideally rely on middleware/layout, but good to have)
    if (!user) return null;

    try {
        const [
            usersRes,
            workspacesRes,
            instancesRes,
            plansRes
        ] = await Promise.all([
            db.query('SELECT COUNT(*) as count FROM users'),
            db.query('SELECT COUNT(*) as count FROM workspaces'),
            db.query('SELECT COUNT(*) as count FROM evolution_api_instances'),
            db.query('SELECT plan, COUNT(*) as count FROM workspaces GROUP BY plan')
        ]);

        const plansDist: Record<string, number> = {};
        plansRes.rows.forEach(row => {
            plansDist[row.plan] = parseInt(row.count, 10);
        });

        // Calculate revenue based on active plans * price (Simple Estimation)
        let revenue = 0;
        Object.entries(plansDist).forEach(([planId, count]) => {
            const price = PLANS[planId as keyof typeof PLANS]?.price || 0;
            revenue += price * count;
        });

        return {
            totalUsers: parseInt(usersRes.rows[0].count, 10),
            totalWorkspaces: parseInt(workspacesRes.rows[0].count, 10),
            activeInstances: parseInt(instancesRes.rows[0].count, 10),
            revenue,
            plansDistribution: plansDist
        };

    } catch (error) {
        console.error('[SUPERADMIN_STATS] Error:', error);
        return null;
    }
}
