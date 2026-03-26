import { NextResponse } from 'next/server';
import { db } from "@/lib/db";
import { getDangerousAdminAccess } from '@/lib/security/dangerous-admin';

export async function GET() {
    const access = await getDangerousAdminAccess();
    if (!access.ok) {
        return NextResponse.json({ error: access.message }, { status: access.status });
    }

    try {
        const res = await db.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'workspaces';
        `);
        return NextResponse.json(res.rows);
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
