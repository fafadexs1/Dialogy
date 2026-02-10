-- Add workspace-level auto close settings
ALTER TABLE "workspaces"
ADD COLUMN IF NOT EXISTS "marketing_auto_close_seconds" INTEGER NOT NULL DEFAULT 300,
ADD COLUMN IF NOT EXISTS "queue_auto_close_seconds" INTEGER NOT NULL DEFAULT 0;
