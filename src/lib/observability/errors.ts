import { logAction } from './logger';

export async function reportServerError(action: string, error: unknown, payload?: Record<string, unknown>) {
  const message = error instanceof Error ? error.message : 'unknown_error';
  const stack = error instanceof Error ? error.stack : undefined;
  console.error(`[${action}]`, error);
  await logAction({
    action: `${action}_error`,
    payload: { message, stack, ...(payload || {}) },
  });
}
