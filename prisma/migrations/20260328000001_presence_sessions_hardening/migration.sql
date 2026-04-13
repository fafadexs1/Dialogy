CREATE TABLE IF NOT EXISTS "presence_sessions" (
    "user_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "session_id" TEXT NOT NULL,
    "last_seen" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "last_event_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "last_event_source" TEXT NOT NULL DEFAULT 'unknown',
    "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
    CONSTRAINT "presence_sessions_pkey" PRIMARY KEY ("user_id", "workspace_id", "session_id"),
    CONSTRAINT "presence_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "presence_sessions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "idx_presence_sessions_workspace_last_seen"
    ON "presence_sessions" ("workspace_id", "last_seen" DESC);

CREATE INDEX IF NOT EXISTS "idx_presence_sessions_user_workspace"
    ON "presence_sessions" ("user_id", "workspace_id");

ALTER TABLE IF EXISTS "user_workspace_presence"
    ADD COLUMN IF NOT EXISTS "recent_activity_at" TIMESTAMPTZ;

ALTER TABLE IF EXISTS "user_workspace_presence"
    ADD COLUMN IF NOT EXISTS "last_event_at" TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE IF EXISTS "user_workspace_presence"
    ADD COLUMN IF NOT EXISTS "last_event_source" TEXT DEFAULT 'migration';

CREATE INDEX IF NOT EXISTS "idx_user_workspace_presence_workspace_recent_activity"
    ON "user_workspace_presence" ("workspace_id", "recent_activity_at" DESC);

INSERT INTO "presence_sessions" (
    "user_id",
    "workspace_id",
    "session_id",
    "last_seen",
    "last_event_at",
    "last_event_source",
    "metadata"
)
SELECT
    uwp."user_id",
    uwp."workspace_id",
    active_session.key,
    active_session.value::timestamptz,
    NOW(),
    'migration_backfill',
    '{}'::jsonb
FROM "user_workspace_presence" uwp
CROSS JOIN LATERAL jsonb_each_text(
    COALESCE(uwp."metadata"->'active_sessions', '{}'::jsonb)
) AS active_session(key, value)
ON CONFLICT ("user_id", "workspace_id", "session_id") DO NOTHING;

UPDATE "user_workspace_presence"
SET
    "recent_activity_at" = COALESCE("recent_activity_at", "last_seen"),
    "last_event_at" = COALESCE("last_event_at", NOW()),
    "last_event_source" = COALESCE("last_event_source", 'migration')
WHERE "is_online" = TRUE;
