ALTER TABLE "evolution_api_instances"
  ADD COLUMN IF NOT EXISTS "webhook_key" TEXT,
  ADD COLUMN IF NOT EXISTS "telegram_bot_id" TEXT,
  ADD COLUMN IF NOT EXISTS "telegram_bot_username" TEXT,
  ADD COLUMN IF NOT EXISTS "telegram_bot_name" TEXT,
  ADD COLUMN IF NOT EXISTS "telegram_bot_token" TEXT,
  ADD COLUMN IF NOT EXISTS "telegram_webhook_url" TEXT;

CREATE INDEX IF NOT EXISTS "idx_evo_instances_webhook_key"
  ON "evolution_api_instances"("webhook_key");
