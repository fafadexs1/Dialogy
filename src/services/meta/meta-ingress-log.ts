import 'server-only';

import { db } from '@/lib/db';

export async function recordMetaIngressLog(input: {
  requestId: string;
  event: string;
  statusCode: number;
  bodyHash?: string | null;
  contentLength?: number | null;
  signaturePresent?: boolean | null;
  appId?: string | null;
  duplicate?: boolean | null;
  atoms?: number | null;
  quarantined?: number | null;
}) {
  const metadata = {
    request_id: input.requestId,
    body_hash: input.bodyHash ?? null,
    content_length: input.contentLength ?? null,
    signature_present: input.signaturePresent ?? null,
    app_id: input.appId ?? null,
    duplicate: input.duplicate ?? null,
    atoms: input.atoms ?? null,
    quarantined: input.quarantined ?? null,
  };

  try {
    await db.query(
      `INSERT INTO public.webhook_logs
         (source, direction, event, status_code, payload, headers, response_body)
       VALUES ('meta-whatsapp', 'incoming', $1, $2, $3::jsonb, '{}'::jsonb, '{}'::jsonb)`,
      [input.event, input.statusCode, JSON.stringify(metadata)],
    );
  } catch (error) {
    console.error('[META_WHATSAPP_WEBHOOK] failed to persist ingress log', {
      requestId: input.requestId,
      event: input.event,
      error: error instanceof Error ? error.message : 'unknown_error',
    });
  }
}
