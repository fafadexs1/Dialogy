try {
  require('dotenv').config();
} catch {
  // dotenv is not present in production docker images as env vars are injected by the environment
}

import { randomUUID } from 'crypto';

import { db } from '@/lib/db';
import {
  checkSubmittedGoogleAdsConversionRequests,
  processPendingGoogleAdsConversionExports,
} from '@/services/google-ads/conversion-upload';

const workerId = `google-ads-${randomUUID()}`;
const batchSize = Math.max(1, Number(process.env.GOOGLE_ADS_EXPORT_BATCH_SIZE || 25));
const batchIntervalMs = Math.max(5_000, Number(process.env.GOOGLE_ADS_EXPORT_INTERVAL_MS || 60_000));
const statusCheckIntervalMs = Math.max(10_000, Number(process.env.GOOGLE_ADS_STATUS_CHECK_INTERVAL_MS || 30_000));
const leaseMs = Math.max(30_000, Number(process.env.GOOGLE_ADS_EXPORT_LEASE_MS || 120_000));
const retentionIntervalMs = 6 * 60 * 60 * 1000;

let running = false;

async function runScheduledTask(label: string, task: () => Promise<void>) {
  if (running) return;
  running = true;
  try {
    await task();
  } catch (error) {
    console.error(`[GOOGLE_ADS_WORKER] ${label} falhou:`, error instanceof Error ? error.message : error);
  } finally {
    running = false;
  }
}

/**
 * Drena a fila ate nao sobrar nada pendente elegivel, enviando para a Data Manager API (events:ingest).
 */
async function drainConversionQueue() {
  for (let round = 0; round < 20; round += 1) {
    const result = await processPendingGoogleAdsConversionExports(batchSize, { workerId, leaseMs });
    if (result.processed === 0) return;

    console.log(
      `[GOOGLE_ADS_WORKER] lote processado=${result.processed} submetido=${result.submitted} ` +
        `falhou=${result.failed} descartado=${result.dead}`
    );

    if (result.processed < batchSize) return;
  }
}

/**
 * Consulta o status assincrono dos jobs em `submitted` via requestStatus:retrieve da Data Manager API.
 */
async function drainSubmittedCheckQueue() {
  for (let round = 0; round < 20; round += 1) {
    const result = await checkSubmittedGoogleAdsConversionRequests(batchSize, { workerId, leaseMs });
    if (result.checked === 0) return;

    console.log(
      `[GOOGLE_ADS_WORKER] diagnostico verificado=${result.checked} confirmados=${result.confirmed} ` +
        `processando=${result.processing} falhou=${result.failed} descartado=${result.dead}`
    );

    if (result.checked < batchSize) return;
  }
}

/**
 * Cliques que expiraram sem virar conversa nao tem mais serventia: nao podem
 * ser atribuidos nem exportados. Sem esse expurgo a tabela so cresce.
 */
async function purgeExpiredAdClicks() {
  const result = await db.query(
    `DELETE FROM ad_clicks
     WHERE matched_at IS NULL
       AND expires_at < clock_timestamp() - interval '30 days'`
  );

  if (result.rowCount) {
    console.log(`[GOOGLE_ADS_WORKER] cliques expirados removidos=${result.rowCount}`);
  }
}

async function daemon() {
  console.log(
    `[GOOGLE_ADS_WORKER] worker ${workerId} iniciado (ingestao=${batchIntervalMs}ms, diagnostico=${statusCheckIntervalMs}ms)`
  );

  const queueTimer = setInterval(
    () => void runScheduledTask('fila de ingestao (events:ingest)', drainConversionQueue),
    batchIntervalMs
  );
  const statusTimer = setInterval(
    () => void runScheduledTask('diagnostico assincrono (requestStatus:retrieve)', drainSubmittedCheckQueue),
    statusCheckIntervalMs
  );
  const retentionTimer = setInterval(
    () => void runScheduledTask('expurgo de cliques', purgeExpiredAdClicks),
    retentionIntervalMs
  );

  const shutdown = async () => {
    clearInterval(queueTimer);
    clearInterval(statusTimer);
    clearInterval(retentionTimer);
    const deadline = Date.now() + 30_000;
    while (running && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    await db.end();
    process.exit(0);
  };

  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());

  await runScheduledTask('fila de ingestao (events:ingest)', drainConversionQueue);
  await runScheduledTask('diagnostico assincrono (requestStatus:retrieve)', drainSubmittedCheckQueue);
  await runScheduledTask('expurgo de cliques', purgeExpiredAdClicks);
}

void daemon().catch((error) => {
  console.error('[GOOGLE_ADS_WORKER] fatal', error instanceof Error ? error.message : 'unknown_error');
  process.exit(1);
});
