CREATE TABLE IF NOT EXISTS "telegram_bot_instances" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "instance_name" TEXT NOT NULL,
  "webhook_key" TEXT NOT NULL,
  "display_name" TEXT,
  "webhook_url" TEXT,
  "bot_token" TEXT NOT NULL,
  "bot_id" TEXT,
  "bot_username" TEXT,
  "bot_name" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_telegram_instances_workspace_name"
  ON "telegram_bot_instances"("workspace_id", "instance_name");

CREATE UNIQUE INDEX IF NOT EXISTS "uq_telegram_instances_instance_name"
  ON "telegram_bot_instances"("instance_name");

CREATE UNIQUE INDEX IF NOT EXISTS "uq_telegram_instances_webhook_key"
  ON "telegram_bot_instances"("webhook_key");

CREATE TABLE IF NOT EXISTS "telegram_webhook_events" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "instance_id" UUID NOT NULL REFERENCES "telegram_bot_instances"("id") ON DELETE CASCADE,
  "workspace_id" UUID NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "update_id" BIGINT NOT NULL,
  "event_type" TEXT,
  "telegram_message_id" BIGINT,
  "telegram_chat_id" TEXT,
  "telegram_from_id" TEXT,
  "payload" JSONB,
  "processed_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_telegram_webhook_events_instance_update"
  ON "telegram_webhook_events"("instance_id", "update_id");

CREATE INDEX IF NOT EXISTS "idx_telegram_webhook_events_workspace"
  ON "telegram_webhook_events"("workspace_id", "created_at" DESC);

WITH "legacy_telegram_instances" AS (
  SELECT
    NULLIF(to_jsonb(src)->>'workspace_id', '')::uuid AS "workspace_id",
    COALESCE(
      NULLIF(to_jsonb(src)->>'instance_name', ''),
      NULLIF(to_jsonb(src)->>'name', '')
    ) AS "instance_name",
    COALESCE(NULLIF(to_jsonb(src)->>'webhook_key', ''), gen_random_uuid()::text) AS "webhook_key",
    COALESCE(
      NULLIF(to_jsonb(src)->>'display_name', ''),
      NULLIF(to_jsonb(src)->>'name', '')
    ) AS "display_name",
    COALESCE(
      NULLIF(to_jsonb(src)->>'telegram_webhook_url', ''),
      NULLIF(to_jsonb(src)->>'webhook_url', '')
    ) AS "webhook_url",
    NULLIF(to_jsonb(src)->>'telegram_bot_token', '') AS "bot_token",
    NULLIF(to_jsonb(src)->>'telegram_bot_id', '') AS "bot_id",
    NULLIF(to_jsonb(src)->>'telegram_bot_username', '') AS "bot_username",
    NULLIF(to_jsonb(src)->>'telegram_bot_name', '') AS "bot_name",
    COALESCE(
      NULLIF(to_jsonb(src)->>'created_at', '')::timestamptz,
      timezone('utc', now())
    ) AS "created_at",
    COALESCE(
      NULLIF(to_jsonb(src)->>'updated_at', '')::timestamptz,
      NULLIF(to_jsonb(src)->>'created_at', '')::timestamptz,
      timezone('utc', now())
    ) AS "updated_at",
    COALESCE(NULLIF(to_jsonb(src)->>'type', ''), '') AS "type"
  FROM "evolution_api_instances" src
)
INSERT INTO "telegram_bot_instances" (
  "workspace_id",
  "instance_name",
  "webhook_key",
  "display_name",
  "webhook_url",
  "bot_token",
  "bot_id",
  "bot_username",
  "bot_name",
  "created_at",
  "updated_at"
)
SELECT
  "workspace_id",
  "instance_name",
  "webhook_key",
  "display_name",
  "webhook_url",
  "bot_token",
  "bot_id",
  "bot_username",
  "bot_name",
  "created_at",
  "updated_at"
FROM "legacy_telegram_instances"
WHERE "type" = 'telegram'
  AND "workspace_id" IS NOT NULL
  AND "instance_name" IS NOT NULL
  AND "bot_token" IS NOT NULL
ON CONFLICT ("instance_name") DO NOTHING;

DELETE FROM "evolution_api_instances" src
WHERE COALESCE(NULLIF(to_jsonb(src)->>'type', ''), '') = 'telegram'
  AND EXISTS (
    SELECT 1
    FROM "telegram_bot_instances" t
    WHERE t."instance_name" = COALESCE(
      NULLIF(to_jsonb(src)->>'instance_name', ''),
      NULLIF(to_jsonb(src)->>'name', '')
    )
  );
