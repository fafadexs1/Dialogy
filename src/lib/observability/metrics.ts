import 'server-only';

import { metrics } from '@opentelemetry/api';

const meter = metrics.getMeter(
  'dialogy-observability',
  process.env.OTEL_SERVICE_VERSION || 'dev'
);

const actionDurationMs = meter.createHistogram('dialogy_action_duration_ms', {
  description: 'Duration of server actions wrapped by withDebug.',
  unit: 'ms',
});

const actionTotal = meter.createCounter('dialogy_action_total', {
  description: 'Total count of server actions wrapped by withDebug.',
});

const webhookDurationMs = meter.createHistogram('dialogy_webhook_duration_ms', {
  description: 'End-to-end webhook processing time.',
  unit: 'ms',
});

const webhookQueueWaitMs = meter.createHistogram('dialogy_webhook_queue_wait_ms', {
  description: 'Time spent waiting in the webhook queue before processing.',
  unit: 'ms',
});

const webhookTotal = meter.createCounter('dialogy_webhook_total', {
  description: 'Total count of processed webhooks by source and status.',
});

const clientErrorTotal = meter.createCounter('dialogy_client_error_total', {
  description: 'Total count of client errors reported to the server.',
});

const clientMetricDurationMs = meter.createHistogram('dialogy_client_metric_duration_ms', {
  description: 'Client-side metric durations reported by the UI.',
  unit: 'ms',
});

export function recordActionMetrics(
  action: string,
  status: 'success' | 'fail' | 'redirect',
  durationMs: number
) {
  actionTotal.add(1, { action, status });
  actionDurationMs.record(durationMs, { action, status });
}

export function recordWebhookMetrics(input: {
  source: string;
  status: 'success' | 'fail';
  event?: string;
  durationMs: number;
  queueWaitMs?: number;
}) {
  const attrs = {
    source: input.source,
    status: input.status,
    event: input.event || 'unknown',
  };
  webhookTotal.add(1, attrs);
  webhookDurationMs.record(input.durationMs, attrs);
  if (typeof input.queueWaitMs === 'number') {
    webhookQueueWaitMs.record(input.queueWaitMs, attrs);
  }
}

export function recordClientError(component?: string) {
  clientErrorTotal.add(1, component ? { component } : undefined);
}

export function recordClientMetric(name: string, durationMs: number) {
  clientMetricDurationMs.record(durationMs, { name });
}
