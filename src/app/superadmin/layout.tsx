
'use server';

import React, { ReactNode } from 'react';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { Sidebar } from './sidebar';

async function checkSuperAdmin(userId: string) {
    if (!userId) return false;
    const { data, error } = await db.query('SELECT is_superadmin FROM users WHERE id = $1', [userId]);
    if (error || !data.rows[0]) {
        return false;
    }
    return data.rows[0].is_superadmin;
}

export default async function SuperAdminLayout({ children }: { children: ReactNode }) {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user || !await checkSuperAdmin(user.id)) {
        redirect('/');
    }

    return (
        <div className="grid min-h-screen w-full md:grid-cols-[220px_1fr] lg:grid-cols-[280px_1fr]">
            <Sidebar />
            <div className="flex flex-col">
                <main className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
                    {children}
                </main>
            </div>
        </div>
    );
}

    