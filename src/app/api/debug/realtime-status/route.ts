import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET() {
    try {
        const result = await db.query(`
            SELECT * FROM pg_publication_tables 
            WHERE pubname = 'supabase_realtime';
        `);

        const tables = result.rows.map(row => row.tablename);

        return NextResponse.json({
            enabled: true,
            tables,
            message: tables.includes('messages')
                ? 'SUCCESS: Messages table is enabled for Realtime.'
                : 'ERROR: Messages table is NOT enabled for Realtime.'
        });
    } catch (error: any) {
        return NextResponse.json({
            enabled: false,
            error: error.message
        }, { status: 500 });
    }
}
