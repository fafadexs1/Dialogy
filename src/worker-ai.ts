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
  const explicitPrewarm = raw === 'true' || raw === '1' || raw === 'yes';
  const ragSetting = process.env.RAG_LOCAL_QUERY_EMBEDDINGS_ENABLED?.trim().toLowerCase();
  const semanticRagEnabled = ragSetting
    ? ragSetting === 'true' || ragSetting === '1' || ragSetting === 'yes'
    : true;

  if (!explicitPrewarm && !semanticRagEnabled) {
    return;
  }

  console.log('[AI_QUEUE_WORKER] Prewarming embedding models for semantic RAG...');
  try {
    await prewarmEmbeddingModels(['doc']);
    await prewarmBgeRerankerV2M3();
    console.log('[AI_QUEUE_WORKER] Embedding and BGE Reranker v2 M3 models ready.');
  } catch (error) {
    // Keep the AI queue alive even if a model download/cache is temporarily
    // unavailable. Retrieval will retain its keyword/static degradation path.
    console.warn('[AI_QUEUE_WORKER] Model prewarm failed; continuing without a warm cache:', error);
  }
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
