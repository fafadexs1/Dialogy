'use server';

import { revalidatePath } from 'next/cache';
import { globalSeoStore } from '@/services/global-seo-store';
import { GlobalSeoSettings, GlobalSeoSchema } from '@/types/seo-global';
import { getCurrentUser } from '@/actions/user';
import { db } from '@/lib/db';

async function ensureAdmin() {
    const user = await getCurrentUser();
    if (!user) throw new Error('Unauthorized');

    const res = await db.query('SELECT is_superadmin FROM users WHERE id = $1', [user.id]);
    if (!res.rows[0]?.is_superadmin) {
        throw new Error('Unauthorized: Admin only');
    }
    return user;
}

export async function getGlobalSeoSettings() {
    await ensureAdmin();
    return await globalSeoStore.get();
}

export async function updateGlobalSeoSettings(data: GlobalSeoSettings) {
    await ensureAdmin();

    // Validate
    const parsed = GlobalSeoSchema.parse(data);

    await globalSeoStore.save(parsed);
    revalidatePath('/', 'layout');
    revalidatePath('/superadmin/seo/settings');

    return { success: true };
}
