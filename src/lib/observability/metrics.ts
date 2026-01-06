import 'server-only';

export function recordActionMetrics(
  action: string,
  status: 'success' | 'fail' | 'redirect',
  durationMs: number
) {
  void action;
  void status;
  void durationMs;
}

export function recordWebhookMetrics(input: {
  source: string;
  status: 'success' | 'fail';
  event?: string;
  durationMs: number;
  queueWaitMs?: number;
}) {
  void input;
}

export function recordClientError(component?: string) {
  void component;
}

export function recordClientMetric(name: string, durationMs: number) {
  void name;
  void durationMs;
}
