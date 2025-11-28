'use server';

import { db } from '@/lib/db';
import { createClient } from '@/lib/supabase/server';

export type LogEntry = {
    id: string;
    workspace_id: string;
    user_id: string | null;
    action: string;
    payload: any;
    created_at: string;
    user_name?: string;
    user_email?: string;
};

export async function getWorkspaceLogs({
    page = 1,
    limit = 50,
    workspaceId
}: {
    page?: number;
    limit?: number;
    workspaceId: string;
}): Promise<{ logs: LogEntry[]; total: number; totalPages: number }> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        throw new Error('Unauthorized');
    }

    // Verify if user is superadmin
    const userRes = await db.query('SELECT is_superadmin FROM users WHERE id = $1', [user.id]);
    const isSuperAdmin = userRes.rows[0]?.is_superadmin;

    if (!isSuperAdmin) {
        throw new Error('Unauthorized: Only superadmins can view logs');
    }

    const offset = (page - 1) * limit;

    try {
        // Get total count
        const countRes = await db.query(
            'SELECT COUNT(*) FROM workspace_logs'
        );
        const total = parseInt(countRes.rows[0].count, 10);
        const totalPages = Math.ceil(total / limit);

        // Get logs with user details
        const logsRes = await db.query(
            `
            SELECT 
                l.*,
                u.full_name as user_name,
                u.email as user_email
            FROM workspace_logs l
            LEFT JOIN users u ON l.user_id = u.id
            ORDER BY l.created_at DESC
            LIMIT $1 OFFSET $2
            `,
            [limit, offset]
        );

        return {
            logs: logsRes.rows,
            total,
            totalPages
        };
    } catch (error) {
        console.error('Error fetching logs:', error);
        return { logs: [], total: 0, totalPages: 0 };
    }
}
