import { NextRequest, NextResponse } from 'next/server';

import { db } from '@/lib/db';
import { verifyDialogyRequest } from '@/services/meta/dialogy-hmac';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const keyId = request.headers.get('x-dialogy-key-id');
  const timestamp = request.headers.get('x-dialogy-timestamp');
  const deliveryId = request.headers.get('x-dialogy-delivery-id');
  const signature = request.headers.get('x-dialogy-signature');
  if (!keyId || !timestamp || !deliveryId || !signature) {
    return NextResponse.json({ error: 'missing_auth_headers' }, { status: 401 });
  }
  const verification = verifyDialogyRequest({ keyId, timestamp, deliveryId, rawBody, signature });
  if (!verification.ok) {
    const status = verification.reason === 'unknown_key' ? 403 : 401;
    return NextResponse.json({ error: verification.reason }, { status });
  }

  let body: { deliveryId?: unknown; status?: unknown; error?: unknown };
  try {
    body = JSON.parse(rawBody) as typeof body;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  if (
    body.deliveryId !== deliveryId ||
    (body.status !== 'processed' && body.status !== 'failed') ||
    (body.error !== undefined && typeof body.error !== 'string')
  ) {
    return NextResponse.json({ error: 'invalid_payload' }, { status: 422 });
  }

  try {
    const result = await db.query(
      `UPDATE public.meta_whatsapp_deliveries
       SET status = CASE WHEN $2 = 'processed' THEN 'processed' ELSE 'dead_letter' END,
           processed_at = CASE WHEN $2 = 'processed' THEN clock_timestamp() ELSE processed_at END,
           errors = CASE WHEN $3::text IS NULL THEN errors ELSE jsonb_build_object('evolution_error', $3::text) END,
           lease_expires_at = NULL,
           locked_by = NULL
       WHERE id = $1 AND status <> 'processed'
       RETURNING id`,
      [deliveryId, body.status, body.error ?? null],
    );
    if (result.rowCount === 1) return NextResponse.json({ ok: true });
    const existing = await db.query('SELECT status FROM public.meta_whatsapp_deliveries WHERE id = $1', [deliveryId]);
    if (existing.rowCount === 0) return NextResponse.json({ error: 'delivery_not_found' }, { status: 404 });
    return NextResponse.json({ ok: true, duplicate: true });
  } catch (error) {
    console.error('[EVOLUTION_RESULT] durable update failed', error instanceof Error ? error.message : 'unknown_error');
    return NextResponse.json({ error: 'database_unavailable' }, { status: 503 });
  }
}
