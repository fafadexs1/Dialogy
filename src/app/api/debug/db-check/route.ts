
import { initializeDatabase } from '@/actions/database';
import { getDangerousAdminAccess } from '@/lib/security/dangerous-admin';
import { NextResponse } from 'next/server';

export async function GET() {
    const access = await getDangerousAdminAccess();
    if (!access.ok) {
        return NextResponse.json({ success: false, error: access.message }, { status: access.status });
    }

    try {
        const result = await initializeDatabase();
        return NextResponse.json({ ...result, migration: 'applied' });
    } catch (error: any) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
