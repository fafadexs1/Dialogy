import { createQueueWorker } from '@/lib/queue/worker';
import { startPresenceReconciler, stopPresenceReconciler } from '@/services/presence/reconciler';
import {
  startEvolutionWebhookRetention,
  stopEvolutionWebhookRetention,
} from '@/services/whatsapp/webhook-inbox-retention';

async function loadEnvironment() {
  if (process.env.NODE_ENV === 'production') {
    return;
  }

  try {
    await import('dotenv/config');
  } catch {
    console.warn('[QUEUE_WORKER] dotenv/config not available. Skipping local .env loading.');
  }
}

async function main() {
  await loadEnvironment();
  const { worker, connection } = createQueueWorker();

  // Mantem user_workspace_presence fresca em lote. Sem efeito quando
  // PRESENCE_BACKEND != redis.
  startPresenceReconciler();

  // Poda a caixa de entrada durável de webhooks, que antes só crescia.
  startEvolutionWebhookRetention();

  const shutdown = async (signal: string) => {
    console.log(`[QUEUE_WORKER] Received ${signal}. Shutting down gracefully...`);

    try {
      stopPresenceReconciler();
      stopEvolutionWebhookRetention();
      await worker.close();
      await connection.quit();
      process.exit(0);
    } catch (error) {
      console.error('[QUEUE_WORKER] Graceful shutdown failed:', error);
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
