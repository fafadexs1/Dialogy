# Observability in Dialogy

This document describes the current observability stack and how to configure it.

## What is covered
- Structured logs via `workspace_logs` (and optional stdout JSON).
- Metrics for core workflows (webhooks, server actions, client error reports).
- Distributed traces via OpenTelemetry with auto-instrumentation.
- Correlation by `request_id` and `user_id`.

## Request correlation
- `x-request-id` is generated in middleware and attached to requests and responses.
- `x-user-id` is injected from the Supabase JWT (when available).
- `logAction` automatically adds `request_id`, `trace_id`, and `span_id` to the log payload.

## Traces (OpenTelemetry)
Enabled through `src/instrumentation.ts` using `NodeSDK` and auto-instrumentations.

Supported exporters:
- OTLP HTTP (recommended)
- Jaeger HTTP (fallback if OTLP is not configured)

Environment variables:
- `OTEL_SERVICE_NAME=dialogy`
- `OTEL_SERVICE_VERSION=...`
- `OTEL_ENVIRONMENT=production`
- `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318`
- `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://localhost:4318/v1/traces`
- `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT=http://localhost:4318/v1/metrics`
- `OTEL_METRICS_EXPORT_INTERVAL_MS=10000`
- `JAEGER_ENDPOINT=http://localhost:14268/api/traces`
- `OTEL_DIAG_LOG_LEVEL=INFO` (optional)

## Metrics emitted
- `dialogy_action_total` (counter)
- `dialogy_action_duration_ms` (histogram)
- `dialogy_webhook_total` (counter)
- `dialogy_webhook_duration_ms` (histogram)
- `dialogy_webhook_queue_wait_ms` (histogram)
- `dialogy_client_error_total` (counter)
- `dialogy_client_metric_duration_ms` (histogram)

## Logs
Stored in `workspace_logs` and optionally printed to stdout when:
- `LOG_TO_STDOUT=true`

These logs now include:
- `request_id`
- `trace_id`
- `span_id`
- `user_id` (when available)

## Notes
- To ensure exact ratios, set `LOG_SAMPLE_RATE=1` and `WEBHOOK_LOG_SAMPLE_RATE=1`.
- High-cardinality attributes (request id, user id) are **not** added to metrics.
