import type { QueueJobType } from './types';

export const DIALOGY_QUEUE_NAME = 'dialogy';
export const DIALOGY_AI_QUEUE_NAME = 'dialogy-ai';
export const DIALOGY_QUEUE_PREFIX = process.env.BULLMQ_PREFIX?.trim() || 'dialogy';

const QUEUE_MODE = (process.env.QUEUE_MODE || 'inline').trim().toLowerCase();
const ENABLED_QUEUE_JOBS = (process.env.QUEUE_ENABLED_JOBS || '')
  .split(',')
  .map((job) => job.trim())
  .filter(Boolean);

export function getQueueMode(): 'inline' | 'enqueue' {
  return QUEUE_MODE === 'enqueue' ? 'enqueue' : 'inline';
}

export function isQueueModeEnabled() {
  return getQueueMode() === 'enqueue';
}

export function shouldEnqueueJobType(type: QueueJobType) {
  if (!isQueueModeEnabled()) {
    return false;
  }

  if (ENABLED_QUEUE_JOBS.length === 0 || ENABLED_QUEUE_JOBS.includes('all')) {
    return true;
  }

  return ENABLED_QUEUE_JOBS.includes(type);
}

export function getQueueWorkerConcurrency() {
  const raw = Number.parseInt(process.env.QUEUE_WORKER_CONCURRENCY || '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 5;
}

export function getAiQueueWorkerConcurrency() {
  const raw = Number.parseInt(process.env.AI_QUEUE_WORKER_CONCURRENCY || '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 2;
}

export function getQueueMaxAttempts(defaultValue = 5) {
  const raw = Number.parseInt(process.env.QUEUE_MAX_ATTEMPTS || '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : defaultValue;
}

export function getQueueBackoffBaseMs() {
  const raw = Number.parseInt(process.env.QUEUE_BACKOFF_BASE_MS || '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 500;
}

export function getRedisUrl() {
  const redisUrl = process.env.REDIS_URL?.trim();
  if (!redisUrl) {
    throw new Error('REDIS_URL nao configurada.');
  }

  return redisUrl;
}
