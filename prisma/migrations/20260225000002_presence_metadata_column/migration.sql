-- Ensure presence metadata column exists at schema level.
-- This replaces runtime DDL checks in application code.
ALTER TABLE IF EXISTS user_workspace_presence
ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;
