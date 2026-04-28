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
- `dialogy_autopilot_run_duration_ms` (planned histogram)
- `dialogy_autopilot_stage_duration_ms` (planned histogram: `rag`, `llm`, `tool`, `send`)
- `dialogy_agent_tool_total` (planned counter)
- `dialogy_agent_tool_duration_ms` (planned histogram)

## Logs
Stored in `workspace_logs` and optionally printed to stdout when:
- `LOG_TO_STDOUT=true`

These logs now include:
- `request_id`
- `trace_id`
- `span_id`
- `user_id` (when available)

## AI orchestrator traces

Autopilot processing now writes a durable run trace when the orchestrator tables are present:

- `orchestrator_runs`: one row per AI processing run.
- `orchestrator_events`: timeline of stages such as RAG retrieval, LLM response, message send, and tool execution.
- `orchestrator_tool_calls`: normalized tool-call audit linked to the run when available.
- `agent_tools_catalog`: versioned contracts for internal tools.

The rollout is tolerant: if the migration has not been applied yet, autopilot continues to run and only skips the new trace persistence.

Key timing fields:

- `timings->>'rag_ms'`
- `timings->>'llm_ms'`
- `timings->>'tool_ms'`
- `timings->>'send_ms'`
- `timings->>'total_ms'`

Useful query for recent slow AI runs:

```sql
SELECT
  id,
  workspace_id,
  chat_id,
  status,
  timings,
  metadata,
  error,
  started_at,
  completed_at
FROM orchestrator_runs
WHERE created_at >= NOW() - INTERVAL '24 hours'
ORDER BY ((timings->>'total_ms')::numeric) DESC NULLS LAST
LIMIT 50;
```

Timeline for one run:

```sql
SELECT kind, status, duration_ms, payload, created_at
FROM orchestrator_events
WHERE run_id = '<run_id>'
ORDER BY created_at;
```

Tool calls for one run:

```sql
SELECT tool_name, status, duration_ms, input, output, error, created_at
FROM orchestrator_tool_calls
WHERE run_id = '<run_id>'
ORDER BY created_at;
```

Recommended production budget variables:

- `AI_ORCHESTRATOR_TOTAL_TIMEOUT_MS=30000`
- `AI_ORCHESTRATOR_LLM_TIMEOUT_MS=20000`
- `AI_ORCHESTRATOR_RAG_TIMEOUT_MS=3000`
- `AI_ORCHESTRATOR_TOOL_TIMEOUT_MS=8000`
- `AI_ORCHESTRATOR_MAX_TOOL_CALLS=2`
- `AGENT_TOOL_TRANSFER_TIMEOUT_MS=8000`
- `AGENT_TOOL_NOTE_TIMEOUT_MS=3000`

## Notes
- To ensure exact ratios, set `LOG_SAMPLE_RATE=1` and `WEBHOOK_LOG_SAMPLE_RATE=1`.
- High-cardinality attributes (request id, user id) are **not** added to metrics.
