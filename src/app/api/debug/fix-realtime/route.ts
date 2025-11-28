import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function POST() {
    try {
        // 1. Check if publication exists
        const pubRes = await db.query("SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'");
        if (pubRes.rowCount === 0) {
            await db.query("CREATE PUBLICATION supabase_realtime FOR ALL TABLES");
        }

        // 2. Add tables to publication (idempotent-ish)
        // Note: 'ALTER PUBLICATION ... ADD TABLE' might fail if already added, 
        // but 'ALTER PUBLICATION ... SET TABLE' replaces the list.
        // Safer to just try adding and ignore specific error or check first.
        // Actually, Supabase usually has 'supabase_realtime' created.
        // We want to ensure 'messages', 'chats', 'contacts' are in it.

        // Let's try to add them one by one.
        const tables = ['messages', 'chats', 'contacts', 'message_status', 'chat_assignments'];
        const results = [];

        for (const table of tables) {
            try {
                // Check if table exists first
                const tableExists = await db.query(`SELECT 1 FROM information_schema.tables WHERE table_name = $1`, [table]);
                if (tableExists.rowCount === 0) {
                    results.push({ table, status: 'skipped (not found)' });
                    continue;
                }

                // Set REPLICA IDENTITY FULL
                await db.query(`ALTER TABLE ${table} REPLICA IDENTITY FULL`);

                // Try to add to publication
                await db.query(`ALTER PUBLICATION supabase_realtime ADD TABLE ${table}`);
                results.push({ table, status: 'added_and_replica_identity_set' });
            } catch (err: any) {
                if (err.message.includes('already is in publication')) {
                    results.push({ table, status: 'already_enabled_replica_identity_set' });
                } else {
                    results.push({ table, status: 'error', error: err.message });
                }
            }
        }

        // 3. Verify final state
        const finalState = await db.query(`
            SELECT tablename FROM pg_publication_tables 
            WHERE pubname = 'supabase_realtime';
        `);

        return NextResponse.json({
            success: true,
            actions: results,
            current_tables: finalState.rows.map(r => r.tablename)
        });

    } catch (error: any) {
        return NextResponse.json({
            success: false,
            error: error.message
        }, { status: 500 });
    }
}
