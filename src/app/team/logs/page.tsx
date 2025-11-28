'use server';

import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { redirect } from 'next/navigation';
import { LogsTable } from './logs-table';
import { getWorkspaceLogs } from '@/actions/logs';

export default async function LogsPage({
    searchParams,
}: {
    searchParams: Promise<{ page?: string }>;
}) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        redirect('/login');
    }

    // Verify superadmin status
    const userRes = await db.query('SELECT is_superadmin, last_active_workspace_id FROM users WHERE id = $1', [user.id]);
    const dbUser = userRes.rows[0];

    if (!dbUser?.is_superadmin) {
        redirect('/team');
    }

    const workspaceId = dbUser.last_active_workspace_id;
    if (!workspaceId) {
        redirect('/onboarding');
    }

    const params = await searchParams;
    const page = Number(params.page) || 1;
    const { logs, total, totalPages } = await getWorkspaceLogs({ workspaceId, page });

    return (
        <div className="flex-1 space-y-4 p-8 pt-6 bg-zinc-950 min-h-screen">
            <div className="flex items-center justify-between space-y-2">
                <h2 className="text-3xl font-bold tracking-tight text-white">Logs do Sistema</h2>
            </div>
            <div className="hidden h-full flex-1 flex-col space-y-8 md:flex">
                <LogsTable
                    data={logs}
                    currentPage={page}
                    totalPages={totalPages}
                />
            </div>
        </div>
    );
}
