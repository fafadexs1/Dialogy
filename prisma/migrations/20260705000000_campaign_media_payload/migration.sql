ALTER TABLE "campaigns"
  ADD COLUMN IF NOT EXISTS "media_payload" JSONB;
