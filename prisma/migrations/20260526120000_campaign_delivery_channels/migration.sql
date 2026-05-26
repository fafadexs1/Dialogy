ALTER TABLE "campaigns"
  ADD COLUMN IF NOT EXISTS "delivery_channel" TEXT NOT NULL DEFAULT 'whatsapp_baileys',
  ADD COLUMN IF NOT EXISTS "destination_id" TEXT,
  ADD COLUMN IF NOT EXISTS "template_payload" JSONB;

UPDATE "campaigns" c
SET "delivery_channel" = CASE
  WHEN i."type" = 'wa_cloud' THEN 'whatsapp_cloud'
  ELSE 'whatsapp_baileys'
END,
"destination_id" = COALESCE(c."destination_id", c."instance_name")
FROM "evolution_api_instances" i
WHERE c."instance_name" = i."instance_name"
  AND c."destination_id" IS NULL;
