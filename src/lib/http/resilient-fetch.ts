import 'server-only';

import { setTimeout as delay } from 'timers/promises';
import { logAction } from '@/lib/observability/logger';

const DEFAULT_TIMEOUT_MS = Number.parseInt(process.env.HTTP_TIMEOUT_MS ?? '8000', 10);
const DEFAULT_RETRY_COUNT = Number.parseInt(process.env.HTTP_RETRY_COUNT ?? '2', 10);
const DEFAULT_RETRY_BASE_DELAY_MS = Number.parseInt(process.env.HTTP_RETRY_BASE_DELAY_MS ?? '200', 10);
const DEFAULT_RETRY_MAX_DELAY_MS = Number.parseInt(process.env.HTTP_RETRY_MAX_DELAY_MS ?? '2000', 10);
const DEFAULT_RETRY_FACTOR = Number.parseFloat(process.env.HTTP_RETRY_FACTOR ?? '2');
const DEFAULT_RETRY_JITTER = Number.parseFloat(process.env.HTTP_RETRY_JITTER ?? '0.2');

const DEFAULT_BREAKER_FAILURE_THRESHOLD = Number.parseInt(
  process.env.HTTP_BREAKER_FAILURE_THRESHOLD ?? '5',
  10
);
const DEFAULT_BREAKER_SUCCESS_THRESHOLD = Number.parseInt(
  process.env.HTTP_BREAKER_SUCCESS_THRESHOLD ?? '2',
  10
);
const DEFAULT_BREAKER_OPEN_MS = Number.parseInt(process.env.HTTP_BREAKER_OPEN_MS ?? '15000', 10);

const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);

type BreakerState = {
  state: 'closed' | 'open' | 'half_open';
  failures: number;
  successes: number;
  nextAttemptAt: number;
  halfOpenInFlight: boolean;
};

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

export class CircuitOpenError extends Error {
  constructor(public serviceKey: string) {
    super(`Circuit breaker is open for ${serviceKey}`);
    this.name = 'CircuitOpenError';
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __dialogyCircuitBreakers: Map<string, BreakerState> | undefined;
}

const breakerStore = globalThis.__dialogyCircuitBreakers ?? new Map<string, BreakerState>();
if (!globalThis.__dialogyCircuitBreakers) {
  globalThis.__dialogyCircuitBreakers = breakerStore;
}

function resolveMethod(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) return init.method.toUpperCase();
  if (input instanceof Request) return input.method.toUpperCase();
  return 'GET';
}

function resolveUrl(input: RequestInfo | URL): string | null {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  if (input instanceof Request) return input.url;
  return null;
}

function deriveServiceKey(input: RequestInfo | URL): string | null {
  const urlValue = resolveUrl(input);
  if (!urlValue) return null;
  try {
    return new URL(urlValue).host;
  } catch {
    return null;
  }
}

function isIdempotentMethod(method: string): boolean {
  return method === 'GET' || method === 'HEAD' || method === 'OPTIONS';
}

function parseRetryAfterMs(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number.parseInt(value, 10);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000);
  }
  const dateMs = Date.parse(value);
  if (!Number.isNaN(dateMs)) {
    return Math.max(0, dateMs - Date.now());
  }
  return null;
}

function computeBackoffDelay(attempt: number, options: ResilientFetchOptions): number {
  const baseDelay = options.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS;
  const maxDelay = options.retryMaxDelayMs ?? DEFAULT_RETRY_MAX_DELAY_MS;
  const factor = options.retryFactor ?? DEFAULT_RETRY_FACTOR;
  const jitter = options.retryJitter ?? DEFAULT_RETRY_JITTER;

  const exponential = Math.min(maxDelay, baseDelay * Math.pow(factor, Math.max(0, attempt - 1)));
  const jitterRange = exponential * jitter;
  return Math.max(0, exponential + (Math.random() * 2 - 1) * jitterRange);
}

function shouldTripBreaker(status?: number, error?: unknown): boolean {
  if (error) return true;
  if (!status) return false;
  if (RETRYABLE_STATUS_CODES.has(status)) return true;
  return status >= 500;
}

function getBreakerState(serviceKey: string): BreakerState {
  const existing = breakerStore.get(serviceKey);
  if (existing) return existing;
  const created: BreakerState = {
    state: 'closed',
    failures: 0,
    successes: 0,
    nextAttemptAt: 0,
    halfOpenInFlight: false,
  };
  breakerStore.set(serviceKey, created);
  return created;
}

function shouldUseBreaker(breaker: BreakerConfig | undefined): boolean {
  if (breaker?.enabled === false) return false;
  return true;
}

export async function resilientFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
  options: ResilientFetchOptions = {}
): Promise<Response> {
  const method = resolveMethod(input, init);
  const idempotent = options.idempotent ?? isIdempotentMethod(method);
  const retries = options.retries ?? DEFAULT_RETRY_COUNT;
  const maxAttempts = idempotent ? Math.max(1, retries + 1) : 1;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retryableStatuses = new Set(options.retryOnStatuses ?? Array.from(RETRYABLE_STATUS_CODES));
  const serviceKey = options.serviceKey ?? deriveServiceKey(input) ?? 'unknown';
  const breakerConfig = options.breaker ?? {};
  const useBreaker = serviceKey !== 'unknown' && shouldUseBreaker(breakerConfig);
  const breakerState = useBreaker ? getBreakerState(serviceKey) : null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (breakerState) {
      const now = Date.now();
      if (breakerState.state === 'open') {
        if (now < breakerState.nextAttemptAt) {
          throw new CircuitOpenError(serviceKey);
        }
        breakerState.state = 'half_open';
        breakerState.failures = 0;
        breakerState.successes = 0;
        breakerState.halfOpenInFlight = false;
      }
      if (breakerState.state === 'half_open' && breakerState.halfOpenInFlight) {
        throw new CircuitOpenError(serviceKey);
      }
      if (breakerState.state === 'half_open') {
        breakerState.halfOpenInFlight = true;
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response | undefined;
    let caughtError: unknown;

    try {
      const combinedSignal =
        init.signal && typeof AbortSignal !== 'undefined' && typeof AbortSignal.any === 'function'
          ? AbortSignal.any([init.signal, controller.signal])
          : controller.signal;

      response = await fetch(input, { ...init, signal: combinedSignal });
    } catch (error) {
      caughtError = error;
    } finally {
      clearTimeout(timer);
    }

    if (!response) {
      const shouldRetry = idempotent && attempt < maxAttempts;
      if (!shouldRetry) {
        if (breakerState && shouldTripBreaker(undefined, caughtError)) {
          breakerState.failures += 1;
          const threshold =
            breakerConfig.failureThreshold ?? DEFAULT_BREAKER_FAILURE_THRESHOLD;
          if (breakerState.state === 'half_open' || breakerState.failures >= threshold) {
            breakerState.state = 'open';
            breakerState.nextAttemptAt =
              Date.now() + (breakerConfig.openDurationMs ?? DEFAULT_BREAKER_OPEN_MS);
            breakerState.halfOpenInFlight = false;
            void logAction({
              action: 'http_circuit_open',
              payload: { service: serviceKey },
            });
          }
        }
        throw caughtError;
      }

      if (breakerState?.state === 'half_open') {
        breakerState.halfOpenInFlight = false;
      }
      const waitMs = computeBackoffDelay(attempt, options);
      await delay(waitMs);
      continue;
    }

    if (response.ok) {
      if (breakerState) {
        breakerState.failures = 0;
        if (breakerState.state === 'half_open') {
          breakerState.successes += 1;
          breakerState.halfOpenInFlight = false;
          const successThreshold =
            breakerConfig.successThreshold ?? DEFAULT_BREAKER_SUCCESS_THRESHOLD;
          if (breakerState.successes >= successThreshold) {
            breakerState.state = 'closed';
            breakerState.successes = 0;
          }
        }
      }
      return response;
    }

    const retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'));
    const shouldRetry =
      idempotent && attempt < maxAttempts && retryableStatuses.has(response.status);

    const tripBreaker = shouldTripBreaker(response.status);
    if (breakerState && tripBreaker) {
      breakerState.failures += 1;
      const threshold = breakerConfig.failureThreshold ?? DEFAULT_BREAKER_FAILURE_THRESHOLD;
      if (breakerState.state === 'half_open' || breakerState.failures >= threshold) {
        breakerState.state = 'open';
        breakerState.nextAttemptAt =
          Date.now() + (breakerConfig.openDurationMs ?? DEFAULT_BREAKER_OPEN_MS);
        breakerState.halfOpenInFlight = false;
        void logAction({
          action: 'http_circuit_open',
          payload: { service: serviceKey },
        });
      }
    }
    if (breakerState?.state === 'half_open' && !tripBreaker) {
      breakerState.halfOpenInFlight = false;
      breakerState.state = 'closed';
      breakerState.failures = 0;
      breakerState.successes = 0;
    }

    if (!shouldRetry) {
      return response;
    }

    const baseDelay = computeBackoffDelay(attempt, options);
    const waitMs = retryAfterMs ? Math.max(baseDelay, retryAfterMs) : baseDelay;
    await delay(waitMs);
  }

  throw new Error('Resilient fetch exhausted retries unexpectedly.');
}
