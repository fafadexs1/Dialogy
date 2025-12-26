'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { seoStore } from '@/services/seo-store';
import { CreateSeoEntrySchema, UpdateSeoEntrySchema } from '@/types/seo';
import { getCurrentUser } from '@/actions/user'; // Assuming this exists or similar auth check

import { db } from '@/lib/db';

// Helper to ensure admin access
async function ensureAdmin() {
    const user = await getCurrentUser();

    if (!user) {
        throw new Error('Unauthorized');
    }

    // Check superadmin status directly from DB since getCurrentUser might not expose it
    const res = await db.query('SELECT is_superadmin FROM users WHERE id = $1', [user.id]);
    const isSuperAdmin = res.rows[0]?.is_superadmin;

    if (!isSuperAdmin) {
        throw new Error('Unauthorized: Superadmin access only');
    }
    return user;
}

export async function createSeoEntry(data: z.infer<typeof CreateSeoEntrySchema>) {
    await ensureAdmin();

    const validation = CreateSeoEntrySchema.safeParse(data);
    if (!validation.success) {
        return { error: validation.error.flatten() };
    }

    await seoStore.upsert(data);
    revalidatePath('/superadmin/seo');
    revalidatePath(data.pathname); // clear cache for that page
    return { success: true };
}

export async function updateSeoEntry(data: z.infer<typeof UpdateSeoEntrySchema>) {
    await ensureAdmin();

    const validation = UpdateSeoEntrySchema.safeParse(data);
    if (!validation.success) {
        return { error: validation.error.flatten() };
    }

    // We need pathname to revalidate
    const existing = await seoStore.getById(data.id);

    // Combine existing pathname if not updating it (though schema might force it if we want)
    // Our schema partials id, but for upsert we need pathname.
    // Ideally update API should probably take full object or merge carefully.
    // seoStore.upsert expects { pathname: string } & Partial<SeoEntry>
    if (!existing) return { error: 'Entry not found' };

    const merged = { ...existing, ...data };

    await seoStore.upsert(merged);

    revalidatePath('/superadmin/seo');
    revalidatePath(merged.pathname);

    return { success: true };
}

export async function deleteSeoEntry(id: string) {
    await ensureAdmin();

    const existing = await seoStore.getById(id);
    if (existing) {
        await seoStore.delete(id);
        revalidatePath('/superadmin/seo');
        revalidatePath(existing.pathname);
    }

    return { success: true };
}
