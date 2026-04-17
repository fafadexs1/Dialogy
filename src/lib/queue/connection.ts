import IORedis from 'ioredis';
import { getRedisUrl } from './config';

declare global {
  // eslint-disable-next-line no-var
  var __dialogyQueueProducerConnection: IORedis | undefined;
}

export function getQueueProducerConnection() {
  if (!globalThis.__dialogyQueueProducerConnection) {
    globalThis.__dialogyQueueProducerConnection = new IORedis(getRedisUrl(), {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
  }

  return globalThis.__dialogyQueueProducerConnection;
}

export function createQueueWorkerConnection() {
  return new IORedis(getRedisUrl(), {
    maxRetriesPerRequest: null,
  });
}
