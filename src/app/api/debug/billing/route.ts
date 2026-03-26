
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getDangerousAdminAccess } from '@/lib/security/dangerous-admin';

export async function GET() {
    const access = await getDangerousAdminAccess();
    if (!access.ok) {
        return NextResponse.json({ error: access.message }, { status: access.status });
    }

    try {
        const billingRes = await db.query('SELECT workspace_id, plan FROM billing_info LIMIT 20');
        const plansRes = await db.query('SELECT id, name FROM plans LIMIT 20');

        return NextResponse.json({
            billing_info: billingRes.rows,
            plans_table: plansRes.rows
        });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
