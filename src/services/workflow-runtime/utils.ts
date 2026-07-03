import { createHash, randomUUID } from 'node:crypto';

export type RuntimeError = Error & {
  code?: string;
  retryable?: boolean;
  details?: Record<string, unknown>;
};

export function createId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function normalizeRuntimeError(error: unknown, fallbackCode = 'UNEXPECTED_ERROR') {
  const candidate = error as RuntimeError | null;
  return {
    code: candidate?.code || fallbackCode,
    message: error instanceof Error ? error.message : String(error || 'Unknown error'),
    retryable: candidate?.retryable === true,
    details: isRecord(candidate?.details) ? candidate.details : undefined,
  };
}

export function stableStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  const normalize = (candidate: unknown): unknown => {
    if (!candidate || typeof candidate !== 'object') return candidate;
    if (seen.has(candidate)) return '[Circular]';
    seen.add(candidate);
    if (Array.isArray(candidate)) return candidate.map(normalize);
    return Object.fromEntries(
      Object.entries(candidate as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, normalize(child)]),
    );
  };
  return JSON.stringify(normalize(value));
}

export function hashValue(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

export function sanitizeStatePatch(
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const blocked = new Set(['__proto__', 'prototype', 'constructor']);
  return Object.fromEntries(
    Object.entries(patch)
      .filter(([key]) => !blocked.has(key))
      .map(([key, value]) => [
        key,
        isRecord(value) ? sanitizeStatePatch(value) : value,
      ]),
  );
}

export function mergeStatePatch(
  state: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const sanitized = sanitizeStatePatch(patch);
  const next = structuredClone(state);
  for (const [key, value] of Object.entries(sanitized)) {
    if (isRecord(next[key]) && isRecord(value)) {
      next[key] = mergeStatePatch(next[key] as Record<string, unknown>, value);
    } else {
      next[key] = structuredClone(value);
    }
  }
  return next;
}

export function readPath(source: unknown, path: string): unknown {
  const normalized = path
    .replace(/^\{\{\s*|\s*\}\}$/g, '')
    .replace(/^\$\./, '')
    .trim();
  if (!normalized) return source;
  return normalized.split('.').reduce<unknown>((current, segment) => {
    if (!isRecord(current) && !Array.isArray(current)) return undefined;
    return (current as Record<string, unknown>)[segment];
  }, source);
}

export function renderTemplate(
  template: string,
  source: Record<string, unknown>,
): string {
  return template.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_.-]*)\s*\}\}/g, (_match, path: string) => {
    const value = readPath(source, path);
    if (value === undefined || value === null) return '';
    return typeof value === 'string' ? value : stableStringify(value);
  });
}

export function materializeValue(
  value: unknown,
  source: Record<string, unknown>,
): unknown {
  if (typeof value === 'string') {
    const exact = value.match(/^\{\{\s*([a-zA-Z_][a-zA-Z0-9_.-]*)\s*\}\}$/);
    if (exact?.[1]) return structuredClone(readPath(source, exact[1]));
    return renderTemplate(value, source);
  }
  if (Array.isArray(value)) return value.map((item) => materializeValue(item, source));
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, materializeValue(child, source)]),
    );
  }
  return value;
}

export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason || new Error('Operation aborted.'));
      return;
    }
    const cleanup = () => signal?.removeEventListener('abort', onAbort);
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      cleanup();
      reject(signal?.reason || new Error('Operation aborted.'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export async function withTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  parentSignal?: AbortSignal,
  timeoutCode = 'TIMEOUT',
): Promise<T> {
  const controller = new AbortController();
  const onParentAbort = () => controller.abort(parentSignal?.reason);
  if (parentSignal?.aborted) controller.abort(parentSignal.reason);
  else parentSignal?.addEventListener('abort', onParentAbort, { once: true });

  const timeout = setTimeout(() => {
    const error = new Error(`Operation timed out after ${timeoutMs}ms.`) as RuntimeError;
    error.code = timeoutCode;
    error.retryable = true;
    controller.abort(error);
  }, timeoutMs);

  try {
    return await Promise.race([
      operation(controller.signal),
      new Promise<never>((_resolve, reject) => {
        controller.signal.addEventListener('abort', () => {
          reject(controller.signal.reason || new Error('Operation aborted.'));
        }, { once: true });
      }),
    ]);
  } finally {
    clearTimeout(timeout);
    parentSignal?.removeEventListener('abort', onParentAbort);
  }
}
