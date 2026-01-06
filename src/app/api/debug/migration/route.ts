
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET() {
    try {
        await db.query(`
            ALTER TABLE chats 
            ADD COLUMN IF NOT EXISTS is_autopilot_active BOOLEAN DEFAULT FALSE;
            ALTER TABLE chats

            ADD COLUMN IF NOT EXISTS copilot_mode TEXT NOT NULL DEFAULT 'auto';
        `);
        return NextResponse.json({ success: true, message: "Column added" });
    } catch (error: any) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
