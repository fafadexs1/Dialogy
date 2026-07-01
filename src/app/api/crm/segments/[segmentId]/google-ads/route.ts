import { NextResponse } from 'next/server';

import { db } from '@/lib/db';
import { buildSegmentAudienceQuery, type CriteriaGroup } from '@/lib/crm-query-builder';
import {
    buildGoogleAdsCustomerMatchCsv,
    sanitizeGoogleAdsCsvFilename,
} from '@/lib/google-ads-customer-match';
import { createClient } from '@/lib/supabase/server';

type RouteContext = {
    params: Promise<{ segmentId: string }>;
};

export async function GET(_request: Request, { params }: RouteContext) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        return NextResponse.json({ error: 'Usuário não autenticado.' }, { status: 401 });
    }

    const { segmentId } = await params;
    const segmentRes = await db.query(
        `SELECT s.workspace_id, s.name, s.criteria
         FROM crm_segments s
         WHERE s.id = $1
           AND EXISTS (
               SELECT 1
               FROM user_workspace_roles uwr
               WHERE uwr.workspace_id = s.workspace_id
                 AND uwr.user_id = $2
           )
         LIMIT 1`,
        [segmentId, user.id]
    );

    if ((segmentRes.rowCount ?? 0) === 0) {
        return NextResponse.json({ error: 'Lista não encontrada ou acesso não autorizado.' }, { status: 404 });
    }

    const segment = segmentRes.rows[0] as {
        workspace_id: string;
        name: string;
        criteria: CriteriaGroup;
    };
    const query = buildSegmentAudienceQuery(segment.workspace_id, segment.criteria);
    const contactsRes = await db.query(query.text, query.values);
    const result = buildGoogleAdsCustomerMatchCsv(contactsRes.rows);

    if (result.exportedCount === 0) {
        return NextResponse.json(
            { error: 'Esta lista não possui contatos com e-mail ou telefone válidos para o Google Ads.' },
            { status: 422 }
        );
    }

    const filename = sanitizeGoogleAdsCsvFilename(segment.name);

    return new Response(result.csv, {
        status: 200,
        headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="${filename}"`,
            'Cache-Control': 'private, no-store',
            'X-Exported-Contacts': String(result.exportedCount),
            'X-Skipped-Contacts': String(result.skippedCount),
        },
    });
}
