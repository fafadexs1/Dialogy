# Performance & Scale

## Cache policy (event-driven)

Never cache:
- messages
- conversation state
- dynamic permissions

Cache (event-driven invalidation):
- configs (`system_settings`)
- plans + limits
- templates (close/transfer)
- metadata (integration catalog)

Implementation summary:
- `src/actions/system-settings.ts` uses tag `system-settings` for config cache.
- `src/lib/plans.ts` uses tag `plans` (no TTL).
- `src/lib/workspace-config.ts` uses tag `workspace-config` for timezone/templates.
- `src/lib/integrations-catalog.ts` uses tag `integration-catalog` for integration metadata.

Invalidation events:
- `saveSystemSettingAction` -> `revalidateTag('system-settings')`
- `savePlan` / `deletePlan` / `savePlanIntegration` -> `revalidateTag('plans')`
- `updateWorkspaceAction` -> `revalidateTag('workspace-config')`

## Queue & async processing

Queue storage: `queue_jobs` (Postgres). This is the primary async backbone for scale.

Current job types:
- `whatsapp_send`
- `webhook_outbound`
- `analytics_event`
- `notification_send`
- `ai_task`

Worker endpoint:
- `POST /api/queue/process`
- Auth: `QUEUE_WORKER_TOKEN` via header `x-queue-token` (or query `?token=...`)

Core env vars:
```
QUEUE_MODE=inline|enqueue
QUEUE_ENABLED_JOBS=whatsapp_send,webhook_outbound
QUEUE_WORKER_TOKEN=...
QUEUE_BATCH_SIZE=20
QUEUE_WORKER_CONCURRENCY=5
QUEUE_LOCK_TIMEOUT_MS=300000
QUEUE_BACKOFF_BASE_MS=500
QUEUE_BACKOFF_MAX_MS=30000
QUEUE_MAX_ATTEMPTS=5
```

Behavior:
- `inline`: execute synchronously (default for safety).
- `enqueue`: persist to `queue_jobs`, worker processes later.

Current wiring:
- WhatsApp sending (`internalSendMessage`) enqueues `whatsapp_send` when enabled.
- Outbound webhooks use `webhook_outbound` when enabled.
- `analytics_event`, `notification_send`, `ai_task` handlers are scaffolded for async processing.

## Domain boundaries (monolith, modular)

Domains:
- auth
- inbox/chat
- automations
- billing
- analytics

Guidelines:
- keep DB queries and actions inside their domain folder
- expose contracts via explicit functions (no cross-domain DB writes)
- add domain-specific metrics/logs via `logAction` payload `domain`
