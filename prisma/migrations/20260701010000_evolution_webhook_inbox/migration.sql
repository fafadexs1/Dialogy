CREATE TABLE IF NOT EXISTS "evolution_webhook_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "instance_name" TEXT NOT NULL,
  "event_name" TEXT NOT NULL,
  "dedup_key" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "max_attempts" INTEGER NOT NULL DEFAULT 5,
  "available_at" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  "locked_at" TIMESTAMPTZ,
  "locked_by" TEXT,
  "processed_at" TIMESTAMPTZ,
  "last_error" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),

  CONSTRAINT "evolution_webhook_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "evolution_webhook_events_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE,
  CONSTRAINT "evolution_webhook_events_status_check"
    CHECK ("status" IN ('pending', 'processing', 'processed', 'failed', 'dead_letter')),
  CONSTRAINT "evolution_webhook_events_attempts_check"
    CHECK ("attempt_count" >= 0 AND "max_attempts" > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_evolution_webhook_events_dedup"
  ON "evolution_webhook_events" ("instance_name", "event_name", "dedup_key");

CREATE INDEX IF NOT EXISTS "idx_evolution_webhook_events_pending"
  ON "evolution_webhook_events" ("available_at", "created_at")
  WHERE "status" IN ('pending', 'failed');

CREATE INDEX IF NOT EXISTS "idx_evolution_webhook_events_workspace"
  ON "evolution_webhook_events" ("workspace_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "idx_evolution_webhook_events_processing_lease"
  ON "evolution_webhook_events" ("locked_at")
  WHERE "status" = 'processing';
