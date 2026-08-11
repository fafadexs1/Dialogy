try {
  require('dotenv').config();
} catch {
  // dotenv is not present in production docker images as env vars are injected by the environment
}

import { randomUUID } from 'crypto';

import { db } from '@/lib/db';
import { processPendingGoogleAdsConversionExports } from '@/services/google-ads/conversion-upload';

const workerId = `google-ads-${randomUUID()}`;
const batchSize = Math.max(1, Number(process.env.GOOGLE_ADS_EXPORT_BATCH_SIZE || 25));
const batchIntervalMs = Math.max(5_000, Number(process.env.GOOGLE_ADS_EXPORT_INTERVAL_MS || 60_000));
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
 * Drena a fila ate nao sobrar nada elegivel, para que um acumulo nao leve
 * varios ciclos para escoar.
 */
async function drainConversionQueue() {
  for (let round = 0; round < 20; round += 1) {
    const result = await processPendingGoogleAdsConversionExports(batchSize, { workerId, leaseMs });
    if (result.processed === 0) return;

    console.log(
      `[GOOGLE_ADS_WORKER] lote processado=${result.processed} enviado=${result.sent} ` +
        `falhou=${result.failed} descartado=${result.dead}`
    );

    if (result.processed < batchSize) return;
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
  console.log(`[GOOGLE_ADS_WORKER] worker ${workerId} iniciado (intervalo=${batchIntervalMs}ms)`);

  const queueTimer = setInterval(
    () => void runScheduledTask('fila de conversoes', drainConversionQueue),
    batchIntervalMs
  );
  const retentionTimer = setInterval(
    () => void runScheduledTask('expurgo de cliques', purgeExpiredAdClicks),
    retentionIntervalMs
  );

  const shutdown = async () => {
    clearInterval(queueTimer);
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

  await runScheduledTask('fila de conversoes', drainConversionQueue);
  await runScheduledTask('expurgo de cliques', purgeExpiredAdClicks);
}

void daemon().catch((error) => {
  console.error('[GOOGLE_ADS_WORKER] fatal', error instanceof Error ? error.message : 'unknown_error');
  process.exit(1);
});
