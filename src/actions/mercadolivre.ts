'use server';

import { db } from '@/lib/db';
import { revalidatePath } from 'next/cache';
import { getCurrentUser } from './user';

export async function getMercadoLivreAccounts() {
    const user = await getCurrentUser();
    if (!user || !user.activeWorkspaceId) {
        return { success: false, error: 'Unauthorized' };
    }

    try {
        // Check if table exists first to avoid crashing if SQL not run
        const checkTable = await db.query(
            `SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'mercadolivre_accounts'
      );`
        );

        if (!checkTable.rows[0].exists) {
            return { success: true, accounts: [] }; // Return empty if table doesn't exist yet
        }

        const res = await db.query(
            'SELECT id, nickname, user_id, created_at FROM mercadolivre_accounts WHERE workspace_id = $1',
            [user.activeWorkspaceId]
        );

        return { success: true, accounts: res.rows };
    } catch (error) {
        console.error('Error fetching ML accounts:', error);
        return { success: false, error: 'Failed to fetch accounts' };
    }
}

export async function unlinkMercadoLivreAccount(id: string) {
    const user = await getCurrentUser();
    if (!user || !user.activeWorkspaceId) return;

    try {
        await db.query(
            'DELETE FROM mercadolivre_accounts WHERE id = $1 AND workspace_id = $2',
            [id, user.activeWorkspaceId]
        );
        revalidatePath('/integrations/mercadolivre');
    } catch (error) {
        console.error('Error unlinking account:', error);
        throw error;
    }
}
