
import { initializeDatabase } from '@/actions/database';
import { db } from '@/lib/db';
import { NextResponse } from 'next/server';

export async function GET() {
    try {
        await db.query(`ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS custom_limits jsonb;`);
        const result = await initializeDatabase();
        return NextResponse.json({ ...result, migration: 'applied' });
    } catch (error: any) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
