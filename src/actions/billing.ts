
'use server';

import { db } from '@/lib/db';
import { createClient } from '@/lib/supabase/server';

const BAILEYS_INSTANCE_COST = 35.00;
const WA_CLOUD_INSTANCE_COST = 50.00;

async function checkSuperAdmin(userId: string): Promise<boolean> {
    if (!userId) return false;
    const result = await db.query('SELECT is_superadmin FROM users WHERE id = $1', [userId]);
    if (result.rowCount === 0) return false;
    return result.rows[0].is_superadmin;
}

export type BillingData = {
    totalBaileysInstances: number;
    totalCloudInstances: number;
    totalBaileysCost: number;
    totalCloudCost: number;
    totalCost: number;
    workspaces: {
        id: string;
        name: string;
        owner_id: string;
        owner_name: string;
        baileys_count: number;
        cloud_count: number;
        subtotal: number;
    }[];
}

export async function getBillingData(): Promise<{ data: BillingData | null, error?: string }> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user || !await checkSuperAdmin(user.id)) {
        return { data: null, error: "Acesso não autorizado." };
    }

    try {
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
            
            const subtotal = (baileysCount * BAILEYS_INSTANCE_COST) + (cloudCount * WA_CLOUD_INSTANCE_COST);

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

        const totalBaileysCost = totalBaileysInstances * BAILEYS_INSTANCE_COST;
        const totalCloudCost = totalCloudInstances * WA_CLOUD_INSTANCE_COST;
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
