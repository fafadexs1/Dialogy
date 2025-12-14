type ClientLogPayload = {
  type: 'error' | 'metric';
  message?: string;
  stack?: string;
  component?: string;
  metric?: { name: string; durationMs: number };
  context?: Record<string, unknown>;
};

async function postClientLog(payload: ClientLogPayload) {
  try {
    await fetch('/api/observability/client-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    });
  } catch (err) {
    console.error('[CLIENT_LOG] Failed to report payload', err);
  }
}

export function reportClientError(input: { message: string; stack?: string; component?: string; context?: Record<string, unknown> }) {
  postClientLog({ type: 'error', ...input });
}

export function reportClientMetric(name: string, durationMs: number, context?: Record<string, unknown>) {
  postClientLog({ type: 'metric', metric: { name, durationMs }, context });
}
