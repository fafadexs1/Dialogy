import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { createClient } from '@/lib/supabase/server';

export async function GET() {
    const supabase = await createClient();
    const { data: { session } } = await supabase.auth.getSession();

    if (!session) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = session.user.id;
    const diagnostics: any = {
        userId,
        checks: []
    };

    try {
        // 1. Check Replication
        const pubRes = await db.query("SELECT * FROM pg_publication_tables WHERE pubname = 'supabase_realtime'");
        const tables = pubRes.rows.map(r => r.tablename);
        diagnostics.checks.push({
            name: 'Replication Enabled',
            status: tables.includes('messages') ? 'PASS' : 'FAIL',
            details: tables
        });

        // 2. Check RLS on Messages
        // We can't easily check RLS logic via SQL without being superuser, but we can check if RLS is enabled
        const rlsRes = await db.query("SELECT relname, relrowsecurity FROM pg_class WHERE relname = 'messages'");
        diagnostics.checks.push({
            name: 'RLS Enabled on Messages',
            status: rlsRes.rows[0]?.relrowsecurity ? 'INFO (Enabled)' : 'WARN (Disabled)',
            details: rlsRes.rows[0]
        });

        // 3. Check User Permissions (Can they see the latest message?)
        // Fetch the last message inserted
        const lastMsgRes = await db.query('SELECT * FROM messages ORDER BY created_at DESC LIMIT 1');
        const lastMsg = lastMsgRes.rows[0];

        if (lastMsg) {
            // Now try to fetch it via Supabase Client (which respects RLS)
            const { data: sbMsg, error: sbError } = await supabase
                .from('messages')
                .select('*')
                .eq('id', lastMsg.id)
                .single();

            diagnostics.checks.push({
                name: 'RLS Visibility Check',
                status: sbMsg ? 'PASS' : 'FAIL',
                details: {
                    dbMessageId: lastMsg.id,
                    dbWorkspaceId: lastMsg.workspace_id,
                    supabaseResult: sbMsg ? 'Found' : 'Not Found',
                    supabaseError: sbError
                }
            });
        } else {
            diagnostics.checks.push({
                name: 'RLS Visibility Check',
                status: 'SKIPPED',
                details: 'No messages in DB'
            });
        }

        return NextResponse.json(diagnostics);

    } catch (error: any) {
        return NextResponse.json({
            error: error.message,
            stack: error.stack
        }, { status: 500 });
    }
}
