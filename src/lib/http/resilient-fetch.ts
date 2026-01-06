import 'server-only';

type BreakerConfig = {
  enabled?: boolean;
  failureThreshold?: number;
  successThreshold?: number;
  openDurationMs?: number;
};

export type ResilientFetchOptions = {
  timeoutMs?: number;
  retries?: number;
  retryBaseDelayMs?: number;
  retryMaxDelayMs?: number;
  retryFactor?: number;
  retryJitter?: number;
  retryOnStatuses?: number[];
  idempotent?: boolean;
  serviceKey?: string;
  breaker?: BreakerConfig;
};

export async function resilientFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
  options: ResilientFetchOptions = {}
): Promise<Response> {
  const timeoutMs = options.timeoutMs;
  if (!Number.isFinite(timeoutMs) || !timeoutMs || timeoutMs <= 0) {
    return fetch(input, init);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const combinedSignal =
      init.signal && typeof AbortSignal !== 'undefined' && typeof AbortSignal.any === 'function'
        ? AbortSignal.any([init.signal, controller.signal])
        : controller.signal;

    return await fetch(input, { ...init, signal: combinedSignal });
  } finally {
    clearTimeout(timer);
  }
}
