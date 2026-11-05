import { createHash, timingSafeEqual } from 'node:crypto';
import { db } from '@/lib/db';
import { encryptPayload } from '@/modules/nexus/services/credentials';
import { readWebhookBody, parseWebhookBody, webhookPublicHeaders } from '@/services/workflow-runtime/webhook-contract';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await context.params;
  if (!/^[a-f0-9-]{36}$/i.test(sessionId)) return Response.json({ error: 'Sessão inválida.' }, { status: 404 });
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const row = (await db.query(`SELECT token_hash FROM nexus_webhook_test_sessions WHERE id=$1 AND expires_at>clock_timestamp() AND encrypted_sample IS NULL`, [sessionId])).rows[0];
  if (!row || !timingSafeEqual(Buffer.from(row.token_hash, 'hex'), createHash('sha256').update(token).digest())) return Response.json({ error: 'Sessão expirada ou token inválido.' }, { status: 401 });
  try {
    const raw = await readWebhookBody(request);
    const sample = { body: parseWebhookBody(raw, request.headers.get('content-type') || ''), headers: webhookPublicHeaders(request.headers), query: Object.fromEntries(new URL(request.url).searchParams), method: request.method };
    const updated = await db.query(`UPDATE nexus_webhook_test_sessions SET encrypted_sample=$2 WHERE id=$1 AND encrypted_sample IS NULL AND expires_at>clock_timestamp() RETURNING id`, [sessionId, encryptPayload(sample)]);
    return Response.json({ captured: Boolean(updated.rowCount), executed: false }, { status: updated.rowCount ? 200 : 409 });
  } catch (error) { return Response.json({ error: error instanceof Error && error.message === 'PAYLOAD_TOO_LARGE' ? 'Payload excede 1 MB.' : 'Payload inválido.' }, { status: error instanceof Error && error.message === 'PAYLOAD_TOO_LARGE' ? 413 : 400 }); }
}
export const GET = POST;
export const PUT = POST;
export const PATCH = POST;
export const DELETE = POST;
