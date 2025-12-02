
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET() {
    try {
        const columns = await db.query(`
            SELECT table_name, column_name, data_type 
            FROM information_schema.columns 
            WHERE table_schema = 'public' 
            AND table_name IN ('messages', 'chats', 'user_workspace_presence')
            AND column_name = 'workspace_id';
        `);

        const publications = await db.query(`
            SELECT pubname, schemaname, tablename 
            FROM pg_publication_tables 
            WHERE pubname = 'supabase_realtime' 
            AND tablename IN ('messages', 'chats', 'user_workspace_presence');
        `);

        return NextResponse.json({
            columns: columns.rows,
            publications: publications.rows
        });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
