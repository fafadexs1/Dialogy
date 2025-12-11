'use server';

import { createClient } from '@supabase/supabase-js';

export async function getLandingStats() {
    try {
        const supabase = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!,
            {
                auth: {
                    persistSession: false,
                },
            }
        );

        // Run queries in parallel
        const [messagesCount, workspacesCount] = await Promise.all([
            supabase.from('messages').select('*', { count: 'exact', head: true }),
            supabase.from('workspaces').select('*', { count: 'exact', head: true }),
        ]);

        return {
            messages: messagesCount.count || 0,
            workspaces: workspacesCount.count || 0,
        };
    } catch (error) {
        console.error('Error fetching landing stats:', error);
        return {
            messages: 0,
            workspaces: 0,
        };
    }
}
