-- Add workspace-level message templates for closing and team transfer
ALTER TABLE "workspaces"
ADD COLUMN IF NOT EXISTS "close_message_template" TEXT DEFAULT '' NOT NULL,
ADD COLUMN IF NOT EXISTS "transfer_team_message_template" TEXT DEFAULT '' NOT NULL;
