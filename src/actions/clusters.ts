
'use server';

import { db } from '@/lib/db';
import { revalidatePath } from 'next/cache';
import type { WhatsappCluster } from '@/lib/types';
import { createClient } from '@/lib/supabase/server';

async function checkSuperAdmin(userId: string): Promise<boolean> {
    if (!userId) return false;
    const result = await db.query('SELECT is_superadmin FROM users WHERE id = $1', [userId]);
    if (result.rowCount === 0) return false;
    return result.rows[0].is_superadmin;
}

export async function getClusters(): Promise<{ clusters: WhatsappCluster[] | null, error?: string }> {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user || !await checkSuperAdmin(user.id)) {
        return { clusters: null, error: "Acesso não autorizado." };
    }

    try {
        const result = await db.query('SELECT * FROM whatsapp_clusters ORDER BY name');
        return { clusters: result.rows };
    } catch (error: any) {
        console.error('[GET_CLUSTERS_ACTION]', error);
        return { clusters: null, error: 'Falha ao buscar clusters do banco de dados.' };
    }
}

export async function createCluster(payload: { name: string, apiUrl: string, apiKey: string }): Promise<{ success: boolean, error?: string }> {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user || !await checkSuperAdmin(user.id)) {
        return { success: false, error: "Acesso não autorizado." };
    }

    const { name, apiUrl, apiKey } = payload;
    if (!name || !apiUrl || !apiKey) {
        return { success: false, error: "Todos os campos são obrigatórios." };
    }

    try {
        await db.query(
            'INSERT INTO whatsapp_clusters (name, api_url, api_key) VALUES ($1, $2, $3)',
            [name, apiUrl, apiKey]
        );
        revalidatePath('/superadmin/clusters/evolution');
        return { success: true };
    } catch (error: any) {
        console.error('[CREATE_CLUSTER_ACTION]', error);
        if (error.code === '23505') { // unique_violation
            return { success: false, error: 'Já existe um cluster com este nome.' };
        }
        return { success: false, error: 'Falha ao adicionar o cluster ao banco de dados.' };
    }
}
