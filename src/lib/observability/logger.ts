'use server';
import 'server-only';

import { supabaseAdmin } from '@/lib/supabase';

type LogActionInput = {
  workspaceId?: string | null;
  userId?: string | null;
  action: string;
  payload?: Record<string, unknown> | null;
};

const DEFAULT_TIMEOUT_MS = 8000;
const HEARTBEAT_INTERVAL_MS = 10_000;

const isRedirectError = (error: unknown) =>
  typeof (error as any)?.digest === 'string' &&
  (error as any)?.digest.startsWith('NEXT_REDIRECT');

export async function logAction(input: LogActionInput): Promise<void> {
  // Fail-open: never throw from telemetry.
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

    const payload = input.payload ?? {};
    const insertBuilder = supabaseAdmin
      .from('workspace_logs')
      .insert({
        workspace_id: input.workspaceId ?? null,
        user_id: input.userId ?? null,
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
      await logAction({
        ...(context ?? {}),
        action: `${actionName}_success`,
        payload: {
          ...(context?.payload ?? {}),
          duration: Date.now() - start,
        },
      });
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
      throw err;
    }
  }) as T;
}

let heartbeatStarted = false;

export function ensureServerHeartbeat() {
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
}
