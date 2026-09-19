try {
  require('dotenv').config();
} catch {
  // dotenv is not present in production docker images as env vars are injected by the environment
}

import { randomUUID } from 'crypto';

import { db } from '@/lib/db';
import { currentDialogySigningKey } from '@/services/meta/dialogy-hmac';
import { buildEvolutionRelayRequest } from '@/services/meta/evolution-relay-contract';
import { resolveEvolutionRelayInstanceId } from '@/services/meta/evolution-relay-instance';
import { decryptPayload } from '@/services/meta/meta-payload-crypto';
import { RelayCapacity } from '@/services/meta/relay-capacity';
import { processPersistedEvolutionWebhookEvent } from '@/services/whatsapp/evolution-webhook-handler';

const workerId = `meta-relay-${randomUUID()}`;
const leaseMs = Number(process.env.META_RELAY_LEASE_MS || 120_000);
const concurrency = Math.max(1, Number(process.env.META_RELAY_CONCURRENCY || 5));
const capacity = new RelayCapacity(concurrency);
let stopping = false;

function retryableStatus(status: number) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

async function claimDeliveries(limit: number) {
  return db.query(
    `UPDATE public.meta_whatsapp_deliveries
     SET status = 'delivering',
         lease_expires_at = clock_timestamp() + ($2 * interval '1 millisecond'),
         locked_by = $1
     WHERE id IN (
       SELECT id
       FROM public.meta_whatsapp_deliveries
       WHERE (
           status IN ('pending', 'retry') AND available_at <= clock_timestamp()
         ) OR (
           status = 'delivering' AND lease_expires_at <= clock_timestamp()
         )
       ORDER BY created_at
       LIMIT $3
       FOR UPDATE SKIP LOCKED
     )
     RETURNING *`,
    [workerId, leaseMs, limit],
  );
}

async function quarantine(deliveryId: string, detail: Record<string, unknown>) {
  await db.query(
    `UPDATE public.meta_whatsapp_deliveries
     SET status = 'quarantined', errors = $2::jsonb, lease_expires_at = NULL, locked_by = NULL
     WHERE id = $1 AND locked_by = $3`,
    [deliveryId, JSON.stringify(detail), workerId],
  );
}

async function scheduleRetry(delivery: Record<string, unknown>, detail: Record<string, unknown>) {
  const attempts = Number(delivery.attempts || 0) + 1;
  const createdAt = new Date(String(delivery.created_at)).getTime();
  const expired = Date.now() - createdAt >= 24 * 60 * 60 * 1000;
  const exhausted = attempts >= Number(delivery.max_attempts || 20) || expired;
  const backoffSeconds = Math.min(3600, 2 ** Math.min(attempts, 12) * 2) + Math.random() * 5;
  await db.query(
    `UPDATE public.meta_whatsapp_deliveries
     SET status = $2,
         attempts = $3,
         errors = $4::jsonb,
         available_at = CASE WHEN $2 = 'retry'
           THEN clock_timestamp() + ($5 * interval '1 second') ELSE available_at END,
         lease_expires_at = NULL,
         locked_by = NULL
     WHERE id = $1 AND locked_by = $6`,
    [delivery.id, exhausted ? 'dead_letter' : 'retry', attempts, JSON.stringify(detail), backoffSeconds, workerId],
  );
}

async function processDelivery(delivery: Record<string, unknown>) {
  const deliveryId = String(delivery.id);
  try {
    if (!delivery.cluster_id || !delivery.route_version) {
      await quarantine(deliveryId, { reason: 'missing_frozen_route' });
      return;
    }
    if (!delivery.encrypted_payload) {
      await quarantine(deliveryId, { reason: 'payload_retention_expired' });
      return;
    }
    const clusterResult = await db.query(
      'SELECT api_url, api_key FROM public.whatsapp_clusters WHERE id = $1',
      [delivery.cluster_id],
    );
    if (clusterResult.rowCount !== 1) {
      await quarantine(deliveryId, { reason: 'cluster_not_found' });
      return;
    }
    let instanceName: string | null = null;
    let providerInstanceId: string | null = null;
    if (delivery.instance_id) {
      const instanceResult = await db.query(
        `SELECT instance_name FROM public.evolution_api_instances
         WHERE id = $1 AND workspace_id = $2 AND cluster_id = $3
           AND phone_number_id = $4 AND waba_id = $5`,
        [delivery.instance_id, delivery.workspace_id, delivery.cluster_id, delivery.phone_number_id, delivery.waba_id],
      );
      if (instanceResult.rowCount !== 1) {
        await quarantine(deliveryId, { reason: 'instance_not_found' });
        return;
      }
      instanceName = instanceResult.rows[0].instance_name;
      providerInstanceId = await resolveEvolutionRelayInstanceId({
        apiUrl: String(clusterResult.rows[0].api_url),
        apiKey: String(clusterResult.rows[0].api_key || ''),
        instanceName: String(instanceName),
        phoneNumberId: String(delivery.phone_number_id || ''),
        wabaId: String(delivery.waba_id || ''),
      });
    }

    const payload = JSON.parse(decryptPayload(String(delivery.encrypted_payload))) as Record<string, unknown>;
    const timestamp = new Date().toISOString();
    const { keyId, secret } = currentDialogySigningKey();
    const relayRequest = buildEvolutionRelayRequest({ delivery, instanceName, providerInstanceId, payload, timestamp, keyId, secret });
    const response = await fetch(
      `${String(clusterResult.rows[0].api_url).replace(/\/$/, '')}/internal/webhooks/dialogy/meta`,
      {
        method: 'POST',
        headers: relayRequest.headers,
        body: relayRequest.rawBody,
        signal: AbortSignal.timeout(Number(process.env.META_RELAY_TIMEOUT_MS || 10_000)),
      },
    );

    if (response.status === 200 || response.status === 202) {
      await db.query(
        `UPDATE public.meta_whatsapp_deliveries
         SET status = 'accepted', accepted_at = clock_timestamp(), attempts = attempts + 1,
             errors = NULL, lease_expires_at = NULL, locked_by = NULL
         WHERE id = $1 AND locked_by = $2`,
        [deliveryId, workerId],
      );
      return;
    }
    const responseText = (await response.text().catch(() => '')).slice(0, 1000);
    if (retryableStatus(response.status)) {
      await scheduleRetry(delivery, { status: response.status, response: responseText });
    } else {
      await quarantine(deliveryId, { status: response.status, response: responseText });
    }
  } catch (error) {
    await scheduleRetry(delivery, {
      reason: 'transport_error',
      message: error instanceof Error ? error.message : 'unknown_error',
    });
  }
}

export async function runMetaRelayBatch() {
  if (stopping) return;
  const available = capacity.beginClaim();
  if (available === 0) return;
  try {
    const claimed = await claimDeliveries(available);
    for (const delivery of claimed.rows) {
      capacity.startDelivery();
      void processDelivery(delivery)
        .catch((error) => {
          console.error(
            '[META_RELAY] delivery processing failed',
            delivery.id,
            error instanceof Error ? error.message : 'unknown_error',
          );
        })
        .finally(() => capacity.finishDelivery());
    }
  } finally {
    capacity.finishClaim();
  }
}

function runScheduledTask(label: string, task: () => Promise<unknown>): void {
  void task().catch((error) => {
    console.error(`[META_RELAY] ${label} failed`, error instanceof Error ? error.message : 'unknown_error');
  });
}

export async function reconcileEvolutionInbox() {
  const rows = await db.query(
    `SELECT id FROM public.evolution_webhook_events
     WHERE (status IN ('pending', 'failed') AND available_at <= clock_timestamp())
        OR (status = 'processing' AND locked_at < clock_timestamp() - interval '5 minutes')
     ORDER BY created_at LIMIT 10`,
  );
  for (const row of rows.rows) {
    await processPersistedEvolutionWebhookEvent(row.id, workerId).catch((error) => {
      console.error('[META_RELAY] inbox reconciliation failed', row.id, error instanceof Error ? error.message : 'unknown_error');
    });
  }
}

export async function enforceMetaRetention() {
  await db.query(
    `UPDATE public.meta_whatsapp_deliveries
     SET encrypted_payload = NULL, payload_purged_at = clock_timestamp()
     WHERE status = 'processed' AND processed_at < clock_timestamp() - interval '30 days'
       AND encrypted_payload IS NOT NULL`,
  );
  await db.query(
    `UPDATE public.meta_whatsapp_receipts r
     SET encrypted_payload = NULL, payload_purged_at = clock_timestamp()
     WHERE r.received_at < clock_timestamp() - interval '30 days'
       AND r.encrypted_payload IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM public.meta_whatsapp_deliveries d
         WHERE d.receipt_id = r.id AND d.status <> 'processed'
       )`,
  );
  await db.query(
    `DELETE FROM public.meta_whatsapp_deliveries
     WHERE status = 'processed' AND processed_at < clock_timestamp() - interval '180 days'`,
  );
  await db.query(
    `DELETE FROM public.meta_whatsapp_receipts r
     WHERE r.received_at < clock_timestamp() - interval '180 days'
       AND NOT EXISTS (SELECT 1 FROM public.meta_whatsapp_deliveries d WHERE d.receipt_id = r.id)`,
  );
}

async function daemon() {
  currentDialogySigningKey();
  console.log(`[META_RELAY] worker ${workerId} started`);
  const relayTimer = setInterval(() => runScheduledTask('relay batch', runMetaRelayBatch), 1000);
  const inboxTimer = setInterval(() => runScheduledTask('inbox reconciliation', reconcileEvolutionInbox), 15_000);
  const retentionTimer = setInterval(() => runScheduledTask('retention enforcement', enforceMetaRetention), 6 * 60 * 60 * 1000);
  const shutdown = async () => {
    stopping = true;
    clearInterval(relayTimer);
    clearInterval(inboxTimer);
    clearInterval(retentionTimer);
    const deadline = Date.now() + 30_000;
    while (capacity.activeCount > 0 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 250));
    await db.end();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
  await runMetaRelayBatch();
  await reconcileEvolutionInbox();
  await enforceMetaRetention();
}

void daemon().catch((error) => {
  console.error('[META_RELAY] fatal', error instanceof Error ? error.message : 'unknown_error');
  process.exit(1);
});
