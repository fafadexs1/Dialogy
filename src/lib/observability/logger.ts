type LogActionInput = {
  workspaceId?: string | null;
  userId?: string | null;
  action: string;
  payload?: Record<string, unknown> | null;
};

const DEFAULT_TIMEOUT_MS = 8000;

export async function logAction(_input: LogActionInput): Promise<void> {
  void _input;
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
  void actionName;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return (async (...args: Parameters<T>) => {
    const task = Promise.resolve(fn(...args));
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      return (await task) as Awaited<ReturnType<T>>;
    }

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('TIMEOUT')), timeoutMs)
    );

    return (await Promise.race([task, timeoutPromise])) as Awaited<ReturnType<T>>;
  }) as T;
}

export function ensureServerHeartbeat() {}
