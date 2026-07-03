import { createAiQueueWorker } from '@/lib/queue/ai-worker';
import { prewarmEmbeddingModels } from '@/lib/embeddings';
import { prewarmBgeRerankerV2M3 } from '@/services/rag/bge-reranker-v2-m3';
import { startAutopilotLearningCycleScheduler } from '@/services/autopilot/learning-cycle-scheduler';

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
  const raw = (process.env.AI_PREWARM_MODELS || 'false').trim().toLowerCase();
  if (raw === 'false' || raw === '0' || raw === 'no') {
    return;
  }

  console.log('[AI_QUEUE_WORKER] Prewarming embedding models...');
  await prewarmEmbeddingModels(['doc']);
  await prewarmBgeRerankerV2M3();
  console.log('[AI_QUEUE_WORKER] Embedding and BGE Reranker v2 M3 models ready.');
}

async function main() {
  await loadEnvironment();
  await maybePrewarmModels();

  const { worker, connection } = createAiQueueWorker();
  const learningCycleScheduler = startAutopilotLearningCycleScheduler();

  const shutdown = async (signal: string) => {
    console.log(`[AI_QUEUE_WORKER] Received ${signal}. Shutting down gracefully...`);

    try {
      learningCycleScheduler?.stop();
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
