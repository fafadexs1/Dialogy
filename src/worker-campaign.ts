import { db } from '@/lib/db';
import { startCampaignWorker } from '@/services/campaigns/worker';

async function loadEnvironment() {
  if (process.env.NODE_ENV === 'production') {
    return;
  }
  try {
    await import('dotenv/config');
  } catch {
    console.warn('[CAMPAIGN_WORKER] dotenv/config not available. Skipping local .env loading.');
  }
}

async function main() {
  await loadEnvironment();
  const worker = startCampaignWorker();

  const shutdown = async (signal: string) => {
    console.log(`[CAMPAIGN_WORKER] Received ${signal}. Shutting down gracefully...`);
    try {
      await worker.close();
      await db.end();
      process.exit(0);
    } catch (error) {
      console.error('[CAMPAIGN_WORKER] Graceful shutdown failed:', error);
      process.exit(1);
    }
  };

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
}

void main();
