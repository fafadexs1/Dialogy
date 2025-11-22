
'use server';

import { db } from '@/lib/db';
import { createClient } from '@/lib/supabase/server';
import type { BillingData, InstanceCost } from '@/lib/types';
import { revalidatePath } from 'next/cache';

async function checkSuperAdmin(userId: string): Promise<boolean> {
    if (!userId) return false;
    const result = await db.query('SELECT is_superadmin FROM users WHERE id = $1', [userId]);
    if (result.rowCount === 0) return false;
    return result.rows[0].is_superadmin;
}

export async function getInstanceCosts(): Promise<InstanceCost[]> {
    const res = await db.query('SELECT type, cost FROM instance_costs');
    return res.rows;
}

export async function updateInstanceCosts(costs: { baileys: number, wa_cloud: number }): Promise<{ success: boolean, error?: string }> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || !await checkSuperAdmin(user.id)) {
        return { success: false, error: "Acesso não autorizado." };
    }

    try {
        await db.query('BEGIN');
        await db.query(
            `INSERT INTO instance_costs (type, cost) VALUES ('baileys', $1) 
             ON CONFLICT (type) DO UPDATE SET cost = $1`, [costs.baileys]
        );
        await db.query(
            `INSERT INTO instance_costs (type, cost) VALUES ('wa_cloud', $1)
             ON CONFLICT (type) DO UPDATE SET cost = $1`, [costs.wa_cloud]
        );
        await db.query('COMMIT');
        revalidatePath('/superadmin/billing');
        return { success: true };
    } catch (error: any) {
        await db.query('ROLLBACK');
        console.error('[UPDATE_INSTANCE_COSTS_ACTION]', error);
        return { success: false, error: 'Falha ao atualizar custos no banco de dados.' };
    }
}


export async function getBillingData(): Promise<{ data: BillingData | null, error?: string }> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user || !await checkSuperAdmin(user.id)) {
        return { data: null, error: "Acesso não autorizado." };
    }

    try {
        const costsRes = await db.query('SELECT type, cost FROM instance_costs');
        const costs = Object.fromEntries(costsRes.rows.map(row => [row.type, parseFloat(row.cost)]));
        const baileysCost = costs['baileys'] || 0;
        const cloudCost = costs['wa_cloud'] || 0;

        const query = `
            SELECT
                w.id as workspace_id,
                w.name as workspace_name,
                w.owner_id,
                u.full_name as owner_name,
                COUNT(eai.id) FILTER (WHERE eai.type = 'baileys') as baileys_count,
                COUNT(eai.id) FILTER (WHERE eai.type = 'wa_cloud') as cloud_count
            FROM
                workspaces w
            LEFT JOIN
                evolution_api_instances eai ON w.id = eai.workspace_id
            LEFT JOIN
                users u ON w.owner_id = u.id
            GROUP BY
                w.id, u.id
            ORDER BY
                w.name;
        `;
        
        const res = await db.query(query);
        
        let totalBaileysInstances = 0;
        let totalCloudInstances = 0;

        const workspacesData = res.rows.map(row => {
            const baileysCount = parseInt(row.baileys_count, 10);
            const cloudCount = parseInt(row.cloud_count, 10);

            totalBaileysInstances += baileysCount;
            totalCloudInstances += cloudCount;
            
            const subtotal = (baileysCount * baileysCost) + (cloudCount * cloudCost);

            return {
                id: row.workspace_id,
                name: row.workspace_name,
                owner_id: row.owner_id,
                owner_name: row.owner_name,
                baileys_count: baileysCount,
                cloud_count: cloudCount,
                subtotal,
            };
        });

        const totalBaileysCost = totalBaileysInstances * baileysCost;
        const totalCloudCost = totalCloudInstances * cloudCost;
        const totalCost = totalBaileysCost + totalCloudCost;

        return {
            data: {
                totalBaileysInstances,
                totalCloudInstances,
                totalBaileysCost,
                totalCloudCost,
                totalCost,
                workspaces: workspacesData,
            }
        };

    } catch (error: any) {
        console.error('[GET_BILLING_DATA_ACTION]', error);
        return { data: null, error: 'Falha ao buscar dados de faturamento do banco de dados.' };
    }
}

export async function getUserBillingData(workspaceId: string): Promise<any> {
  // Mock data for now. In a real app, this would fetch from a 'billing_info' or 'invoices' table.
  const now = new Date();
  const nextBillingDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  return {
    plan: 'Pro',
    nextBillingDate: nextBillingDate.toISOString(),
    invoices: [
      { id: 'inv_1', date: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(), amount: 85.00, status: 'paid' },
      { id: 'inv_2', date: new Date(now.getFullYear(), now.getMonth() -1, 1).toISOString(), amount: 50.00, status: 'paid' },
      { id: 'inv_3', date: new Date(now.getFullYear(), now.getMonth() -2, 1).toISOString(), amount: 50.00, status: 'paid' },
    ],
  };
}
