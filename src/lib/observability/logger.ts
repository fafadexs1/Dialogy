import 'server-only';

import { trace } from '@opentelemetry/api';
import { getSupabaseAdmin } from '@/lib/supabase';
import { getRequestContext } from '@/lib/observability/request-context';
import { recordActionMetrics } from '@/lib/observability/metrics';

type LogActionInput = {
  workspaceId?: string | null;
  userId?: string | null;
  action: string;
  payload?: Record<string, unknown> | null;
};

const DEFAULT_TIMEOUT_MS = 8000;
const HEARTBEAT_INTERVAL_MS = 10_000;
const DEFAULT_SAMPLE_RATE =
  Number(process.env.LOG_SAMPLE_RATE ?? '0.1') >= 0 &&
    Number(process.env.LOG_SAMPLE_RATE ?? '0.1') <= 1
    ? Number(process.env.LOG_SAMPLE_RATE ?? '0.1')
    : 0.1;

const WEBHOOK_SAMPLE_RATE =
  Number(process.env.WEBHOOK_LOG_SAMPLE_RATE ?? '0.02') >= 0 &&
    Number(process.env.WEBHOOK_LOG_SAMPLE_RATE ?? '0.02') <= 1
    ? Number(process.env.WEBHOOK_LOG_SAMPLE_RATE ?? '0.02')
    : 0.02;

// Per-action overrides to drastically reduce noisy logs.
const ACTION_SAMPLE_OVERRIDES: Record<string, number> = {
  webhook_received: WEBHOOK_SAMPLE_RATE,
  webhook_processed_success: WEBHOOK_SAMPLE_RATE,
  webhook_processed_fail: 1,
};

const DISABLED_ACTIONS = new Set<string>([
  // Disable logging for extremely chatty events.
  // Re-enable via code or env if you need to debug.
  // 'webhook_received',
]);

function shouldLog(action: string): boolean {
  if (DISABLED_ACTIONS.has(action)) return false;
  const sampleRate = ACTION_SAMPLE_OVERRIDES[action] ?? DEFAULT_SAMPLE_RATE;
  return Math.random() < sampleRate;
}

const isRedirectError = (error: unknown) =>
  typeof (error as any)?.digest === 'string' &&
  (error as any)?.digest.startsWith('NEXT_REDIRECT');

export async function logAction(input: LogActionInput): Promise<void> {
  if (!shouldLog(input.action)) {
    return;
  }

  // Fail-open: never throw from telemetry.
  try {
    const requestContext = await getRequestContext();
    const resolvedWorkspaceId = input.workspaceId ?? requestContext.workspaceId ?? null;
    const resolvedUserId = input.userId ?? requestContext.userId ?? null;
    const requestId = requestContext.requestId;
    const releaseChannel = requestContext.releaseChannel;
    const span = trace.getActiveSpan();
    const spanContext = span?.spanContext();
    const traceId = spanContext?.traceId;
    const spanId = spanContext?.spanId;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

    const payload = { ...(input.payload ?? {}) };
    if (!payload.request_id && requestId) {
      payload.request_id = requestId;
    }
    if (!payload.trace_id && traceId) {
      payload.trace_id = traceId;
    }
    if (!payload.span_id && spanId) {
      payload.span_id = spanId;
    }
    if (!payload.user_id && resolvedUserId) {
      payload.user_id = resolvedUserId;
    }
    if (!payload.workspace_id && resolvedWorkspaceId) {
      payload.workspace_id = resolvedWorkspaceId;
    }
    if (!payload.release_channel && releaseChannel) {
      payload.release_channel = releaseChannel;
    }

    if (span) {
      if (requestId) span.setAttribute('request.id', requestId);
      if (resolvedUserId) span.setAttribute('enduser.id', resolvedUserId);
      if (resolvedWorkspaceId) span.setAttribute('dialogy.workspace_id', resolvedWorkspaceId);
      if (releaseChannel) span.setAttribute('dialogy.release_channel', releaseChannel);
    }

    // Avoid storing huge webhook payloads; keep only a summary.
    if (input.action === 'webhook_received' && 'full_payload' in payload) {
      const fullPayload: any = (payload as any).full_payload;
      payload.full_payload = '[omitted_large_payload]';
      payload.payload_summary = {
        keys: fullPayload && typeof fullPayload === 'object'
          ? Object.keys(fullPayload)
          : undefined,
      };
    }

    if (process.env.LOG_TO_STDOUT === 'true') {
      const logEntry = {
        level: 'info',
        action: input.action,
        workspace_id: resolvedWorkspaceId,
        user_id: resolvedUserId,
        timestamp: new Date().toISOString(),
        payload,
      };
      console.log(JSON.stringify(logEntry));
    }

    const insertBuilder = getSupabaseAdmin()
      .from('workspace_logs')
      .insert({
        workspace_id: resolvedWorkspaceId,
        user_id: resolvedUserId,
        action: input.action,
        payload,
      });

    const { error } =
      typeof (insertBuilder as any).abortSignal === 'function'
        ? await (insertBuilder as any).abortSignal(controller.signal)
        : await insertBuilder;

    if (error) {
      console.error('[LOG ERROR] Failed to persist workspace_logs', error);
    }

    clearTimeout(timer);
  } catch (err) {
    console.error('[LOG ERROR] Unexpected failure while logging action', err);
  }
}

type WithDebugOptions<T extends (...args: any[]) => any> = {
  timeoutMs?: number;
  contextResolver?: (
    ...args: Parameters<T>
  ) => Pick<LogActionInput, 'workspaceId' | 'userId' | 'payload'>;
};

export function withDebug<T extends (...args: any[]) => any>(
  actionName: string,
  fn: T,
  options?: WithDebugOptions<T>
): T {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return (async (...args: Parameters<T>) => {
    const start = Date.now();
    const context = options?.contextResolver?.(...args);

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('TIMEOUT')), timeoutMs)
    );

    try {
      const result = await Promise.race([fn(...args), timeoutPromise]);
      const duration = Date.now() - start;
      await logAction({
        ...(context ?? {}),
        action: `${actionName}_success`,
        payload: {
          ...(context?.payload ?? {}),
          duration,
        },
      });
      recordActionMetrics(actionName, 'success', duration);
      return result as Awaited<ReturnType<T>>;
    } catch (err: any) {
      const duration = Date.now() - start;

      if (isRedirectError(err)) {
        await logAction({
          ...(context ?? {}),
          action: `${actionName}_redirect`,
          payload: {
            ...(context?.payload ?? {}),
            duration,
          },
        });
        recordActionMetrics(actionName, 'redirect', duration);
        throw err;
      }

      await logAction({
        ...(context ?? {}),
        action: `${actionName}_fail`,
        payload: {
          ...(context?.payload ?? {}),
          duration,
          error: err?.message ?? 'unknown_error',
        },
      });
      recordActionMetrics(actionName, 'fail', duration);
      throw err;
    }
  }) as T;
}

let heartbeatStarted = false;

export function ensureServerHeartbeat() {
  // Heartbeat disabled to reduce log noise
  /*
  if (heartbeatStarted || typeof globalThis === 'undefined') {
    return;
  }

  heartbeatStarted = true;
  const globalAny = globalThis as any;

  if (globalAny.__dialogyHeartbeatInterval) {
    return;
  }

  const sendBeat = async () => {
    await logAction({
      action: 'server_heartbeat',
      payload: {
        timestamp: Date.now(),
        memory: process.memoryUsage(),
        uptime: process.uptime(),
      },
    });
  };

  sendBeat().catch((err) => {
    console.error('[HEARTBEAT_LOGGER] initial heartbeat failed', err);
  });

  globalAny.__dialogyHeartbeatInterval = setInterval(() => {
    sendBeat().catch((err) => {
      console.error('[HEARTBEAT_LOGGER] heartbeat failed', err);
    });
  }, HEARTBEAT_INTERVAL_MS);
  */
}
