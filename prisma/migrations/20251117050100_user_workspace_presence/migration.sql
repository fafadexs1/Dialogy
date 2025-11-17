-- Create table to persist workspace-level presence information
CREATE TABLE IF NOT EXISTS "user_workspace_presence" (
    "user_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "is_online" BOOLEAN NOT NULL DEFAULT FALSE,
    "online_since" TIMESTAMPTZ,
    "last_seen" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT "user_workspace_presence_pkey" PRIMARY KEY ("user_id", "workspace_id"),
    CONSTRAINT "user_workspace_presence_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "user_workspace_presence_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "idx_user_workspace_presence_workspace_online"
    ON "user_workspace_presence" ("workspace_id", "is_online");
