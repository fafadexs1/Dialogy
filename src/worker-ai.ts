import { createAiQueueWorker } from '@/lib/queue/ai-worker';
import { prewarmEmbeddingModels } from '@/lib/embeddings';
import { prewarmCrossEncoderReranker } from '@/services/rag/cross-encoder-reranker';

async function loadEnvironment() {
  if (process.env.NODE_ENV === 'production') {
    return;
  }

  try {
    await import('dotenv/config');
  } catch {
    console.warn('[AI_QUEUE_WORKER] dotenv/config not available. Skipping local .env loading.');
  }
}

async function maybePrewarmModels() {
  const raw = (process.env.AI_PREWARM_MODELS || 'true').trim().toLowerCase();
  if (raw === 'false' || raw === '0' || raw === 'no') {
    return;
  }

  console.log('[AI_QUEUE_WORKER] Prewarming embedding models...');
  await prewarmEmbeddingModels(['doc']);
  await prewarmCrossEncoderReranker();
  console.log('[AI_QUEUE_WORKER] Embedding models ready.');
}

async function main() {
  await loadEnvironment();
  await maybePrewarmModels();

  const { worker, connection } = createAiQueueWorker();

  const shutdown = async (signal: string) => {
    console.log(`[AI_QUEUE_WORKER] Received ${signal}. Shutting down gracefully...`);

    try {
      await worker.close();
      await connection.quit();
      process.exit(0);
    } catch (error) {
      console.error('[AI_QUEUE_WORKER] Graceful shutdown failed:', error);
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
