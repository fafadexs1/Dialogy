
'use server';

import { db } from '@/lib/db';
import { revalidatePath } from 'next/cache';
import type { Plan, Integration, PlanIntegration } from '@/lib/types';
import { createClient } from '@/lib/supabase/server';

async function checkSuperAdmin(userId: string): Promise<boolean> {
    if (!userId) return false;
    const result = await db.query('SELECT is_superadmin FROM users WHERE id = $1', [userId]);
    return result.rows[0]?.is_superadmin === true;
}

export async function getIntegrations(): Promise<{ integrations: Integration[] | null; error?: string }> {
    try {
        const result = await db.query('SELECT * FROM integrations ORDER BY name');
        return { integrations: result.rows };
    } catch (error: any) {
        console.error('[GET_INTEGRATIONS_ACTION]', error);
        return { integrations: null, error: 'Falha ao buscar integrações.' };
    }
}

export async function getPlans(): Promise<{ plans: Plan[] | null; error?: string }> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user || !await checkSuperAdmin(user.id)) {
        return { plans: null, error: "Acesso não autorizado." };
    }

    try {
        const plansRes = await db.query(`
            SELECT
                p.id,
                p.name,
                p.description,
                p.price,
                p.is_active,
                p.is_default,
                COALESCE(
                    (SELECT json_agg(
                        json_build_object(
                            'id', pi.id,
                            'integration_id', i.id,
                            'name', i.name,
                            'icon_url', i.icon_url,
                            'included_quantity', pi.included_quantity,
                            'additional_cost', pi.additional_cost,
                            'is_enabled', pi.is_enabled
                        )
                    )
                    FROM plan_integrations pi
                    JOIN integrations i ON pi.integration_id = i.id
                    WHERE pi.plan_id = p.id),
                    '[]'::json
                ) as integrations
            FROM plans p
            ORDER BY p.name;
        `);

        return { plans: plansRes.rows };
    } catch (error: any) {
        console.error('[GET_PLANS_ACTION]', error);
        return { plans: null, error: 'Falha ao buscar planos do banco de dados.' };
    }
}


export async function savePlan(plan: Omit<Plan, 'id' | 'integrations'> & { id?: string }): Promise<{ success: boolean, error?: string, planId?: string }> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user || !await checkSuperAdmin(user.id)) {
        return { success: false, error: "Acesso não autorizado." };
    }

    const { name, description, price, is_active, is_default, id } = plan;

    if (!name) {
        return { success: false, error: "O nome do plano é obrigatório." };
    }
    
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        
        let planId = id;
        
        // If is_default is true, set all other plans to false
        if (is_default) {
            await client.query('UPDATE plans SET is_default = FALSE WHERE id != $1', [id || null]);
        }

        if (id) { // Update
            await client.query(
                `UPDATE plans SET name = $1, description = $2, price = $3, is_active = $4, is_default = $5, updated_at = NOW()
                 WHERE id = $6`,
                [name, description, price, is_active, is_default, id]
            );
        } else { // Create
            const res = await client.query(
                `INSERT INTO plans (name, description, price, is_active, is_default)
                 VALUES ($1, $2, $3, $4, $5) RETURNING id`,
                [name, description, price, is_active, is_default]
            );
            planId = res.rows[0].id;
        }

        await client.query('COMMIT');
        revalidatePath('/superadmin/plans');
        return { success: true, planId };

    } catch (error: any) {
        await client.query('ROLLBACK');
        console.error('[SAVE_PLAN_ACTION]', error);
        return { success: false, error: 'Falha ao salvar plano no banco de dados.' };
    } finally {
        client.release();
    }
}

export async function deletePlan(planId: string): Promise<{ success: boolean, error?: string }> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user || !await checkSuperAdmin(user.id)) {
        return { success: false, error: "Acesso não autorizado." };
    }
    
    try {
        // We might want to check if any workspace is subscribed to this plan first.
        // For now, we'll allow deletion. Deleting a plan will cascade to plan_integrations.
        await db.query('DELETE FROM plans WHERE id = $1', [planId]);
        revalidatePath('/superadmin/plans');
        return { success: true };
    } catch(error: any) {
         console.error('[DELETE_PLAN_ACTION]', error);
         return { success: false, error: "Falha ao excluir o plano." };
    }
}

export async function savePlanIntegration(data: { planId: string, integrationId: string, includedQuantity: number, additionalCost: number, isEnabled: boolean }): Promise<{ success: boolean, error?: string }> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user || !await checkSuperAdmin(user.id)) {
        return { success: false, error: "Acesso não autorizado." };
    }

    const { planId, integrationId, includedQuantity, additionalCost, isEnabled } = data;
    
    try {
        await db.query(
            `INSERT INTO plan_integrations (plan_id, integration_id, included_quantity, additional_cost, is_enabled)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (plan_id, integration_id) DO UPDATE SET
                included_quantity = $3,
                additional_cost = $4,
                is_enabled = $5`,
            [planId, integrationId, includedQuantity, additionalCost, isEnabled]
        );
        revalidatePath('/superadmin/plans');
        return { success: true };
    } catch(error: any) {
        console.error('[SAVE_PLAN_INTEGRATION_ACTION]', error);
        return { success: false, error: 'Falha ao salvar configuração da integração.' };
    }
}
