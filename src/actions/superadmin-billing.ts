'use server';

import { db } from '@/lib/db';
import { createClient } from '@/lib/supabase/server';
import { PlanType, PlanLimits } from '@/lib/plans';
import { revalidatePath } from 'next/cache';

async function checkSuperAdmin(userId: string): Promise<boolean> {
    const result = await db.query('SELECT is_superadmin FROM users WHERE id = $1', [userId]);
    return result.rows[0]?.is_superadmin === true;
}

export async function updateWorkspacePlanAction(
    workspaceId: string,
    plan: PlanType,
    customLimits: Partial<PlanLimits> | null
): Promise<{ success: boolean, error?: string }> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user || !await checkSuperAdmin(user.id)) {
        return { success: false, error: "Acesso não autorizado. Apenas Superadmins." };
    }

    try {
        await db.query(
            `UPDATE workspaces 
             SET plan = $1, custom_limits = $2, updated_at = NOW() 
             WHERE id = $3`,
            [plan, customLimits ? JSON.stringify(customLimits) : null, workspaceId]
        );

        revalidatePath('/superadmin/workspaces');
        return { success: true };
    } catch (error: any) {
        console.error('[UPDATE_WORKSPACE_PLAN] Error:', error);
        return { success: false, error: 'Falha ao atualizar o plano do workspace.' };
    }
}
