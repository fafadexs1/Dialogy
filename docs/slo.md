# Dialogy SLOs and SLIs

This document defines a small, measurable SLO set and shows how to query the
metrics from Postgres. It relies on `workspace_logs` entries (from `logAction`)
and the `messages` table.

## Log actions used
- webhook_received
- webhook_processed_success
- webhook_processed_fail
- get_initial_chats_success / get_initial_chats_fail (from withDebug)
- send_agent_message_success / send_agent_message_fail (from withDebug)

Note: `withDebug` stores latency in `payload.duration` (ms).
Webhook processing logs store latency in `payload.duration_ms` (ms).

If you want exact ratios, set `LOG_SAMPLE_RATE=1` and
`WEBHOOK_LOG_SAMPLE_RATE=1` in the environment for a period.

## SQL examples

### Webhook success rate (last 30 days)
```sql
SELECT
  payload->>'source' AS source,
  COUNT(*) FILTER (WHERE action = 'webhook_processed_success')::float
    / NULLIF(COUNT(*) FILTER (WHERE action IN ('webhook_processed_success','webhook_processed_fail')), 0)
    AS success_rate
FROM workspace_logs
WHERE created_at >= NOW() - INTERVAL '30 days'
  AND action IN ('webhook_processed_success','webhook_processed_fail')
GROUP BY 1
ORDER BY 1;
```

### Webhook p95 end-to-end latency (last 7 days)
```sql
SELECT
  payload->>'source' AS source,
  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY (payload->>'duration_ms')::numeric) AS p95_ms
FROM workspace_logs
WHERE action = 'webhook_processed_success'
  AND created_at >= NOW() - INTERVAL '7 days'
GROUP BY 1
ORDER BY 1;
```

### Evolution queue wait p95 (last 7 days)
```sql
SELECT
  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY (payload->>'queue_wait_ms')::numeric) AS p95_queue_wait_ms
FROM workspace_logs
WHERE action = 'webhook_processed_success'
  AND payload->>'source' = 'evolution'
  AND created_at >= NOW() - INTERVAL '7 days';
```

### Inbox initial load p95 (last 7 days)
```sql
SELECT
  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY (payload->>'duration')::numeric) AS p95_ms
FROM workspace_logs
WHERE action = 'get_initial_chats_success'
  AND created_at >= NOW() - INTERVAL '7 days';
```

### Agent send success rate (last 30 days)
```sql
SELECT
  COUNT(*) FILTER (WHERE action = 'send_agent_message_success')::float
    / NULLIF(COUNT(*) FILTER (WHERE action IN ('send_agent_message_success','send_agent_message_fail')), 0)
    AS success_rate
FROM workspace_logs
WHERE created_at >= NOW() - INTERVAL '30 days'
  AND action IN ('send_agent_message_success','send_agent_message_fail');
```
